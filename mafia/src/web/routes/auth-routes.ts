import { RouteContext } from "./context";
import { ensureUserProfile } from "../../db/ensure-user-profile";
import { sendHtml, cookieNameFor } from "./utils";

export async function handleExchange(ctx: RouteContext): Promise<void> {
  const ticket = ctx.url.searchParams.get("ticket");
  if (!ticket) {
    sendHtml(ctx.response, 400, "<h1>잘못된 요청</h1><p>join ticket 이 필요합니다.</p>");
    return;
  }

  const clientKey = ctx.request.socket.remoteAddress ?? "unknown";
  if (!ctx.authRateLimit.check(clientKey)) {
    sendHtml(ctx.response, 429, "<h1>요청이 너무 많습니다.</h1><p>잠시 후 다시 시도해 주세요.</p>");
    return;
  }

  const ticketHash = ctx.joinTicketService.hash(ticket).slice(0, 12);

  try {
    const payload = await ctx.joinTicketService.consume(ticket);
    const game = ctx.gameManager.findByGameId(payload.gameId);
    if (!game) {
      throw new Error("현재 진행 중인 게임을 찾을 수 없습니다.");
    }

    if (!game.hasParticipant(payload.discordUserId)) {
      throw new Error("현재 게임 참가자만 입장할 수 있습니다.");
    }

    const player = game.getPlayer(payload.discordUserId);
    await ensureUserProfile(ctx.gameStatsStore, {
      discordUserId: payload.discordUserId,
      displayName: player?.displayName ?? payload.discordUserId,
      discordGuildId: game.guildId,
      guildName: game.guildName,
    });

    const session = ctx.sessionStore.create(payload.gameId, payload.discordUserId);
    const cookieValue = ctx.sessionStore.serializeCookieValue(session.id);
    const cookieName = cookieNameFor(ctx.cookieBaseName, payload.gameId);
    
    const secureFlag = ctx.secureCookies ? "Secure; " : "";
    
    ctx.response.setHeader(
      "Set-Cookie",
      `${cookieName}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; ${secureFlag}SameSite=Lax`,
    );
    ctx.response.statusCode = 302;
    ctx.response.setHeader("Location", `/game/${encodeURIComponent(payload.gameId)}`);
    ctx.response.end();
  } catch (error) {
    console.warn(`[auth/exchange] ticketHash=${ticketHash} error=${error instanceof Error ? error.message : "unknown"}`);
    sendHtml(ctx.response, 400, "<h1>입장 실패</h1><p>링크가 만료되었거나 이미 사용되었습니다. Discord에서 새 링크를 발급받아 주세요.</p>");
  }
}
