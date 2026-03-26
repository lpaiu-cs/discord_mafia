import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath, basename } from "node:path";
import { Client } from "discord.js";
import { GameManager } from "../game/game";
import { applyDashboardAction, DashboardActionRequest } from "./game-actions";
import { renderDashboardPage } from "./html";
import { JoinTicketService } from "./join-ticket";
import { buildDashboardState } from "./presenter";
import { InMemorySessionStore, WebSession } from "./session-store";

interface DashboardServerOptions {
  client: Client;
  gameManager: GameManager;
  joinTicketService: JoinTicketService;
  sessionStore: InMemorySessionStore;
  port: number;
  secureCookies: boolean;
}

export class DashboardServer {
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private readonly authRateLimit = new RateLimiter(20, 60_000);
  private readonly stateRateLimit = new RateLimiter(240, 60_000);
  private readonly actionRateLimit = new RateLimiter(120, 60_000);
  private readonly chatRateLimit = new RateLimiter(120, 60_000);
  private readonly cookieBaseName = "mafia_session";

  constructor(private readonly options: DashboardServerOptions) {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const match = url.pathname.match(/^\/api\/game\/([^/]+)\/ws$/u);
      if (!match) {
        socket.destroy();
        return;
      }
      
      const gameId = match[1];
      const session = this.requireSessionForWs(request, gameId);
      if (!session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).gameId = gameId;
        (ws as any).discordUserId = session.discordUserId;
        this.wss.emit("connection", ws, request);
      });
    });

    this.options.gameManager.onGameStateChange = (gameId: string) => {
      this.broadcastGameState(gameId);
    };
  }

  public broadcastGameState(gameId: string): void {
     const game = this.options.gameManager.findByGameId(gameId);
     if (!game) return;

     this.wss.clients.forEach((client) => {
       if (client.readyState === WebSocket.OPEN) {
         const clientGameId = (client as any).gameId;
         const userId = (client as any).discordUserId;
         if (clientGameId === gameId && userId) {
            try {
              const payload = buildDashboardState(game, userId);
              client.send(JSON.stringify({ type: "state", payload }));
            } catch (e) {
              // Ignore
            }
         }
       }
     });
  }

  async listen(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, () => {
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("웹 서버 포트를 확인할 수 없습니다."));
          return;
        }

        resolve(address.port);
      });
    });
  }

  async close(): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      const resourceMatch = pathname.match(/^\/resource\/(.+?\.(?:png|svg|wav))$/u);
      if (resourceMatch && method === "GET") {
        await this.handleResource(response, resourceMatch[1]);
        return;
      }

      const clientMatch = pathname.match(/^\/client\/(.+?\.(?:js|css))$/u);
      if (clientMatch && method === "GET") {
        await this.handleClientAsset(response, clientMatch[1]);
        return;
      }

      if ((pathname === "/auth/exchange" || pathname === "/join") && method === "GET") {
        await this.handleExchange(request, response, url);
        return;
      }

      const pageMatch = pathname.match(/^\/game\/([^/]+)$/u);
      if (pageMatch && method === "GET") {
        await this.handleGamePage(request, response, pageMatch[1]);
        return;
      }

      const stateMatch = pathname.match(/^\/api\/game\/([^/]+)\/state$/u);
      if (stateMatch && method === "GET") {
        await this.handleGameState(request, response, stateMatch[1], url);
        return;
      }

      const actionMatch = pathname.match(/^\/api\/game\/([^/]+)\/actions$/u);
      if (actionMatch && method === "POST") {
        await this.handleAction(request, response, actionMatch[1]);
        return;
      }

      const chatMatch = pathname.match(/^\/api\/game\/([^/]+)\/chats\/([^/]+)$/u);
      if (chatMatch && method === "POST") {
        await this.handleChat(request, response, chatMatch[1], chatMatch[2]);
        return;
      }

      this.sendJson(response, 404, { error: "경로를 찾을 수 없습니다." });
    } catch (error) {
      console.error(error);
      this.sendJson(response, 500, { error: error instanceof Error ? error.message : "서버 오류" });
    }
  }

  private async handleResource(response: ServerResponse, filename: string): Promise<void> {
    const resourceDir = resolvePath(__dirname, "../../resource");
    const filePath = resolvePath(resourceDir, filename);
    if (!filePath.startsWith(resourceDir)) {
      this.sendJson(response, 403, { error: "접근이 거부되었습니다." });
      return;
    }

    try {
      const data = await readFile(filePath);
      response.statusCode = 200;
      let contentType = "application/octet-stream";
      if (filename.endsWith(".svg")) contentType = "image/svg+xml";
      else if (filename.endsWith(".png")) contentType = "image/png";
      else if (filename.endsWith(".mp3")) contentType = "audio/mpeg";
      response.setHeader("content-type", contentType);
      response.setHeader("cache-control", "public, max-age=86400, immutable");
      response.end(data);
    } catch {
      this.sendJson(response, 404, { error: "리소스를 찾을 수 없습니다." });
    }

  }

  private async handleClientAsset(response: ServerResponse, filename: string): Promise<void> {
    const clientDir = resolvePath(__dirname, "client");
    const filePath = resolvePath(clientDir, filename);
    if (!filePath.startsWith(clientDir)) {
      this.sendJson(response, 403, { error: "접근이 거부되었습니다." });
      return;
    }

    try {
      const data = await readFile(filePath);
      response.statusCode = 200;
      let contentType = "application/octet-stream";
      if (filename.endsWith(".js")) contentType = "application/javascript";
      else if (filename.endsWith(".css")) contentType = "text/css";
      response.setHeader("content-type", contentType);
      response.setHeader("cache-control", "public, max-age=86400");
      response.end(data);
    } catch {
      this.sendJson(response, 404, { error: "클라이언트 자산을 찾을 수 없습니다." });
    }
  }

  private async handleExchange(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const ticket = url.searchParams.get("ticket");
    if (!ticket) {
      this.sendHtml(response, 400, "<h1>잘못된 요청</h1><p>join ticket 이 필요합니다.</p>");
      return;
    }

    const clientKey = request.socket.remoteAddress ?? "unknown";
    if (!this.authRateLimit.check(clientKey)) {
      this.sendHtml(response, 429, "<h1>요청이 너무 많습니다.</h1><p>잠시 후 다시 시도해 주세요.</p>");
      return;
    }

    const ticketHash = this.options.joinTicketService.hash(ticket).slice(0, 12);

    try {
      const payload = this.options.joinTicketService.consume(ticket);
      const game = this.options.gameManager.findByGameId(payload.gameId);
      if (!game) {
        throw new Error("현재 진행 중인 게임을 찾을 수 없습니다.");
      }

      if (!game.hasParticipant(payload.discordUserId)) {
        throw new Error("현재 게임 참가자만 입장할 수 있습니다.");
      }

      const session = this.options.sessionStore.create(payload.gameId, payload.discordUserId);
      const cookieValue = this.options.sessionStore.serializeCookieValue(session.id);
      const cookieName = this.cookieNameFor(payload.gameId);
      
      const secureFlag = this.options.secureCookies ? "Secure; " : "";
      
      response.setHeader(
        "Set-Cookie",
        `${cookieName}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; ${secureFlag}SameSite=Lax`,
      );
      response.statusCode = 302;
      response.setHeader("Location", `/game/${encodeURIComponent(payload.gameId)}`);
      response.end();
    } catch (error) {
      console.warn(`[auth/exchange] ticketHash=${ticketHash} error=${error instanceof Error ? error.message : "unknown"}`);
      this.sendHtml(response, 400, "<h1>입장 실패</h1><p>링크가 만료되었거나 이미 사용되었습니다. Discord에서 새 링크를 발급받아 주세요.</p>");
    }
  }

  private async handleGamePage(request: IncomingMessage, response: ServerResponse, gameId: string): Promise<void> {
    const session = this.requireSession(request, response, gameId, false);
    if (!session) {
      return;
    }

    const game = this.options.gameManager.findByGameId(gameId);
    if (!game || !game.hasParticipant(session.discordUserId)) {
      this.sendHtml(response, 404, "<h1>게임을 찾을 수 없습니다.</h1><p>이미 종료되었거나 참가 정보가 없습니다.</p>");
      return;
    }

    const initial = buildDashboardState(game, session.discordUserId);
    this.sendHtml(response, 200, renderDashboardPage(initial.state!, session.csrfToken));
  }

  private async handleGameState(request: IncomingMessage, response: ServerResponse, gameId: string, url: URL): Promise<void> {
    const session = this.requireSession(request, response, gameId, true);
    if (!session) {
      return;
    }

    const rateKey = `${session.discordUserId}:${request.socket.remoteAddress ?? "unknown"}`;
    if (!this.stateRateLimit.check(rateKey)) {
      this.sendJson(response, 429, { error: "상태 조회 요청이 너무 많습니다." });
      return;
    }

    const game = this.options.gameManager.findByGameId(gameId);
    if (!game || !game.hasParticipant(session.discordUserId)) {
      this.sendJson(response, 404, { error: "게임을 찾을 수 없습니다." });
      return;
    }

    const sinceVersion = Number.parseInt(url.searchParams.get("sinceVersion") ?? "", 10);
    const payload = buildDashboardState(game, session.discordUserId, Number.isNaN(sinceVersion) ? undefined : sinceVersion);
    this.sendJson(response, 200, payload);
  }

  private async handleAction(request: IncomingMessage, response: ServerResponse, gameId: string): Promise<void> {
    const session = this.requireSession(request, response, gameId, true);
    if (!session || !this.ensureCsrf(request, response, session)) {
      return;
    }

    if (!this.actionRateLimit.check(session.discordUserId)) {
      this.sendJson(response, 429, { error: "행동 제출 요청이 너무 많습니다." });
      return;
    }

    const body = await this.readJson<DashboardActionRequest>(request);
    const game = this.options.gameManager.findByGameId(gameId);
    if (!game || !game.hasParticipant(session.discordUserId)) {
      this.sendJson(response, 404, { error: "게임을 찾을 수 없습니다." });
      return;
    }

    try {
      await applyDashboardAction(this.options.client, game, session.discordUserId, body);
      this.sendJson(response, 200, { ok: true, version: game.stateVersion });
    } catch (error) {
      this.sendJson(response, 400, { error: error instanceof Error ? error.message : "행동 처리 실패" });
    }
  }

  private async handleChat(request: IncomingMessage, response: ServerResponse, gameId: string, rawChannel: string): Promise<void> {
    const session = this.requireSession(request, response, gameId, true);
    if (!session || !this.ensureCsrf(request, response, session)) {
      return;
    }

    if (!this.chatRateLimit.check(session.discordUserId)) {
      this.sendJson(response, 429, { error: "채팅 전송 요청이 너무 많습니다." });
      return;
    }

    const game = this.options.gameManager.findByGameId(gameId);
    if (!game || !game.hasParticipant(session.discordUserId)) {
      this.sendJson(response, 404, { error: "게임을 찾을 수 없습니다." });
      return;
    }

    const body = await this.readJson<{ content?: string }>(request);
    const channel = normalizeChatChannel(rawChannel);
    if (!channel) {
      this.sendJson(response, 400, { error: "지원하지 않는 채팅 채널입니다." });
      return;
    }

    try {
      const message = game.sendChat(session.discordUserId, channel, body.content ?? "");
      this.sendJson(response, 200, { ok: true, message });
    } catch (error) {
      this.sendJson(response, 400, { error: error instanceof Error ? error.message : "채팅 전송 실패" });
    }
  }

  private requireSession(
    request: IncomingMessage,
    response: ServerResponse,
    gameId: string,
    apiMode: boolean,
  ): WebSession | null {
    const cookies = parseCookies(request.headers.cookie ?? "");
    const rawCookie = cookies[this.cookieNameFor(gameId)] ?? cookies[this.cookieBaseName];
    if (!rawCookie) {
      this.respondUnauthenticated(response, apiMode);
      return null;
    }

    const sessionId = this.options.sessionStore.parseCookieValue(rawCookie);
    if (!sessionId) {
      this.respondUnauthenticated(response, apiMode);
      return null;
    }

    const session = this.options.sessionStore.touch(sessionId);
    if (!session || session.gameId !== gameId) {
      this.respondUnauthenticated(response, apiMode);
      return null;
    }

    return session;
  }

  private requireSessionForWs(request: IncomingMessage, gameId: string): WebSession | null {
    const cookies = parseCookies(request.headers.cookie ?? "");
    const rawCookie = cookies[this.cookieNameFor(gameId)] ?? cookies[this.cookieBaseName];
    if (!rawCookie) {
      return null;
    }

    const sessionId = this.options.sessionStore.parseCookieValue(rawCookie);
    if (!sessionId) {
      return null;
    }

    const session = this.options.sessionStore.touch(sessionId);
    if (!session || session.gameId !== gameId) {
      return null;
    }

    return session;
  }

  private cookieNameFor(gameId: string): string {
    const safeGameId = gameId.replaceAll(/[^A-Za-z0-9_-]/g, "_");
    return `${this.cookieBaseName}_${safeGameId}`;
  }

  private ensureCsrf(request: IncomingMessage, response: ServerResponse, session: WebSession): boolean {
    const token = request.headers["x-csrf-token"];
    if (typeof token !== "string" || token !== session.csrfToken) {
      this.sendJson(response, 403, { error: "CSRF 검증에 실패했습니다." });
      return false;
    }

    return true;
  }

  private respondUnauthenticated(response: ServerResponse, apiMode: boolean): void {
    if (apiMode) {
      this.sendJson(response, 401, { error: "세션이 없거나 만료되었습니다." });
      return;
    }

    this.sendHtml(response, 401, "<h1>인증이 필요합니다.</h1><p>Discord에서 입장 링크를 다시 발급받아 주세요.</p>");
  }

  private async readJson<T>(request: IncomingMessage): Promise<T> {
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

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify(payload));
  }

  private sendHtml(response: ServerResponse, statusCode: number, html: string): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(html);
  }
}

class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    this.cleanup(now);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (bucket.count >= this.limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  private cleanup(now: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

function parseCookies(header: string): Record<string, string> {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, entry) => {
      const [key, ...rest] = entry.split("=");
      if (!key || rest.length === 0) {
        return accumulator;
      }

      accumulator[key] = safeDecodeCookieValue(rest.join("="));
      return accumulator;
    }, {});
}

function safeDecodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeChatChannel(value: string): "public" | "mafia" | "lover" | "graveyard" | null {
  if (value === "public" || value === "mafia" || value === "lover" || value === "graveyard") {
    return value;
  }

  return null;
}
