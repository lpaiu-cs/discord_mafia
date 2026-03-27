import { RouteContext } from "./context";
import { requireSession, ensureCsrf, sendJson, readJson } from "./utils";
import { applyDashboardAction, DashboardActionRequest } from "../game-actions";

export async function handleAction(ctx: RouteContext, gameId: string): Promise<void> {
  const session = requireSession(ctx, gameId, true);
  if (!session || !ensureCsrf(ctx, session)) {
    return;
  }

  if (!ctx.actionRateLimit.check(session.discordUserId)) {
    sendJson(ctx.response, 429, { error: "행동 제출 요청이 너무 많습니다." });
    return;
  }

  const body = await readJson<DashboardActionRequest>(ctx.request);
  const game = ctx.gameManager.findByGameId(gameId);
  if (!game || !game.hasParticipant(session.discordUserId)) {
    sendJson(ctx.response, 404, { error: "게임을 찾을 수 없습니다." });
    return;
  }

  try {
    if (!ctx.client) {
      throw new Error("Discord Client가 제공되지 않았습니다.");
    }
    await applyDashboardAction(ctx.client, game, session.discordUserId, body);
    sendJson(ctx.response, 200, { ok: true, version: game.stateVersion });
  } catch (error) {
    sendJson(ctx.response, 400, { error: error instanceof Error ? error.message : "행동 처리 실패" });
  }
}
