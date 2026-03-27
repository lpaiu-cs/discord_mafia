import { RouteContext } from "./context";
import { requireSession, ensureCsrf, sendJson, readJson, normalizeChatChannel } from "./utils";

export async function handleChat(ctx: RouteContext, gameId: string, rawChannel: string): Promise<void> {
  const session = requireSession(ctx, gameId, true);
  if (!session || !ensureCsrf(ctx, session)) {
    return;
  }

  if (!ctx.chatRateLimit.check(session.discordUserId)) {
    sendJson(ctx.response, 429, { error: "채팅 전송 요청이 너무 많습니다." });
    return;
  }

  const game = ctx.gameManager.findByGameId(gameId);
  if (!game || !game.hasParticipant(session.discordUserId)) {
    sendJson(ctx.response, 404, { error: "게임을 찾을 수 없습니다." });
    return;
  }

  const body = await readJson<{ content?: string }>(ctx.request);
  const channel = normalizeChatChannel(rawChannel);
  if (!channel) {
    sendJson(ctx.response, 400, { error: "지원하지 않는 채팅 채널입니다." });
    return;
  }

  try {
    const message = game.sendChat(session.discordUserId, channel, body.content ?? "");
    sendJson(ctx.response, 200, { ok: true, message });
  } catch (error) {
    sendJson(ctx.response, 400, { error: error instanceof Error ? error.message : "채팅 전송 실패" });
  }
}
