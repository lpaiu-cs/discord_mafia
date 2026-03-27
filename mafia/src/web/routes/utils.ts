import { ServerResponse, IncomingMessage } from "node:http";
import { parseCookies } from "../middleware/cookie";
import { RouteContext } from "./context";
import { WebSession } from "../session-store";

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(json);
}

export function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(html);
}

export function safeDecodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeChatChannel(value: string): "public" | "mafia" | "lover" | "graveyard" | null {
  if (value === "public" || value === "mafia" || value === "lover" || value === "graveyard") {
    return value;
  }
  return null;
}

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    if (Buffer.concat(chunks).byteLength > 16_384) {
      throw new Error("요청 본문이 너무 큽니다.");
    }
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function cookieNameFor(cookieBaseName: string, gameId: string): string {
  const safeGameId = gameId.replaceAll(/[^A-Za-z0-9_-]/g, "_");
  return `${cookieBaseName}_${safeGameId}`;
}

export function respondUnauthenticated(response: ServerResponse, apiMode: boolean): void {
  if (apiMode) {
    sendJson(response, 401, { error: "세션이 없거나 만료되었습니다." });
    return;
  }

  sendHtml(response, 401, "<h1>인증이 필요합니다.</h1><p>Discord에서 입장 링크를 다시 발급받아 주세요.</p>");
}

export function requireSession(
  ctx: RouteContext,
  gameId: string,
  apiMode: boolean,
): WebSession | null {
  const cookies = parseCookies(ctx.request.headers.cookie ?? "");
  const rawCookie = cookies[cookieNameFor(ctx.cookieBaseName, gameId)] ?? cookies[ctx.cookieBaseName];
  if (!rawCookie) {
    respondUnauthenticated(ctx.response, apiMode);
    return null;
  }

  const sessionId = ctx.sessionStore.parseCookieValue(rawCookie);
  if (!sessionId) {
    respondUnauthenticated(ctx.response, apiMode);
    return null;
  }

  const session = ctx.sessionStore.touch(sessionId);
  if (!session || session.gameId !== gameId) {
    respondUnauthenticated(ctx.response, apiMode);
    return null;
  }

  ctx.userSession = session;
  return session;
}

export function requireSessionForWs(
  request: IncomingMessage,
  gameId: string,
  cookieBaseName: string,
  sessionStore: any
): WebSession | null {
  const cookies = parseCookies(request.headers.cookie ?? "");
  const rawCookie = cookies[cookieNameFor(cookieBaseName, gameId)] ?? cookies[cookieBaseName];
  if (!rawCookie) {
    return null;
  }

  const sessionId = sessionStore.parseCookieValue(rawCookie);
  if (!sessionId) {
    return null;
  }

  const session = sessionStore.touch(sessionId);
  if (!session || session.gameId !== gameId) {
    return null;
  }

  return session;
}

export function ensureCsrf(ctx: RouteContext, session: WebSession): boolean {
  const token = ctx.request.headers["x-csrf-token"];
  if (typeof token !== "string" || token !== session.csrfToken) {
    sendJson(ctx.response, 403, { error: "CSRF 검증에 실패했습니다." });
    return false;
  }

  return true;
}
