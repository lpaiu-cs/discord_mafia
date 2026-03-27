import { RouteContext } from "./context";
import { loadPlayerDashboardStats } from "../load-player-dashboard-stats";
import { requireSession, sendHtml } from "./utils";
import { buildDashboardState } from "../presenter";
import { renderDashboardPage } from "../html";

export async function handleGamePage(ctx: RouteContext, gameId: string): Promise<void> {
  const session = requireSession(ctx, gameId, false);
  if (!session) {
    return;
  }

  const game = ctx.gameManager.findByGameId(gameId);
  if (!game || !game.hasParticipant(session.discordUserId)) {
    sendHtml(ctx.response, 404, "<h1>게임을 찾을 수 없습니다.</h1><p>이미 종료되었거나 참가 정보가 없습니다.</p>");
    return;
  }

  const playerStats = await loadPlayerDashboardStats(ctx.gameStatsStore, session.discordUserId);
  const initial = buildDashboardState(game, session.discordUserId, undefined, {
    statsEnabled: ctx.gameStatsStore.enabled,
    playerStats,
  });
  sendHtml(ctx.response, 200, renderDashboardPage(initial.state!, session.csrfToken));
}
