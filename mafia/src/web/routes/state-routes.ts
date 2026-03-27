import { RouteContext } from "./context";
import { loadPlayerDashboardStats } from "../load-player-dashboard-stats";
import { requireSession, sendJson } from "./utils";
import { buildDashboardState } from "../presenter";

export async function handleGameState(ctx: RouteContext, gameId: string): Promise<void> {
  const session = requireSession(ctx, gameId, true);
  if (!session) {
    return;
  }

  const rateKey = `${session.discordUserId}:${ctx.request.socket.remoteAddress ?? "unknown"}`;
  if (!ctx.stateRateLimit.check(rateKey)) {
    sendJson(ctx.response, 429, { error: "상태 조회 요청이 너무 많습니다." });
    return;
  }

  const game = ctx.gameManager.findByGameId(gameId);
  if (!game || !game.hasParticipant(session.discordUserId)) {
    sendJson(ctx.response, 404, { error: "게임을 찾을 수 없습니다." });
    return;
  }

  const sinceVersion = Number.parseInt(ctx.url.searchParams.get("sinceVersion") ?? "", 10);
  if (!Number.isNaN(sinceVersion) && sinceVersion === game.stateVersion) {
    sendJson(ctx.response, 200, {
      changed: false,
      version: game.stateVersion,
      serverNow: Date.now(),
    });
    return;
  }

  const playerStats = await loadPlayerDashboardStats(ctx.gameStatsStore, session.discordUserId);
  const payload = buildDashboardState(game, session.discordUserId, undefined, {
    statsEnabled: ctx.gameStatsStore.enabled,
    playerStats,
  });
  sendJson(ctx.response, 200, payload);
}
