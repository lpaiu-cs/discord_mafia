import { Client } from "discord.js";
import { MafiaGame, NightSelectionRequest, TimeAdjust } from "../game/game";

export interface DashboardActionRequest {
  actionType: "vote" | "night_select" | "trial_vote" | "time_adjust" | "reporter_publish" | "madam_select" | "terror_burn" | "aftermath_select";
  action?: string;
  targetId?: string;
  value?: string;
}

export async function applyDashboardAction(
  client: Client,
  game: MafiaGame,
  userId: string,
  request: DashboardActionRequest,
): Promise<void> {
  const token = game.phaseContext?.token;

  switch (request.actionType) {
    case "vote":
      if (!request.targetId) {
        throw new Error("투표 대상이 필요합니다.");
      }
      await game.submitVote(client, userId, request.targetId, token);
      break;
    case "night_select":
      if (!request.action || !request.targetId) {
        throw new Error("밤 행동과 대상이 필요합니다.");
      }
      await game.submitNightSelection(client, {
        kind: "night",
        actorId: userId,
        action: request.action,
        targetId: request.targetId,
        token: token ?? 0,
      });
      break;
    case "madam_select":
      if (!request.targetId) {
        throw new Error("유혹 대상이 필요합니다.");
      }
      await game.submitNightSelection(client, makeSelectionRequest("madam", userId, request.targetId, token, "select"));
      break;
    case "terror_burn":
      if (!request.targetId) {
        throw new Error("산화 대상이 필요합니다.");
      }
      await game.submitNightSelection(client, makeSelectionRequest("terror", userId, request.targetId, token, "burn"));
      break;
    case "aftermath_select":
      if (!request.targetId) {
        throw new Error("후속 선택 대상이 필요합니다.");
      }
      await game.submitNightSelection(
        client,
        makeSelectionRequest("aftermath", userId, request.targetId, token, request.action ?? game.pendingAftermathChoice?.action ?? "mediumAscend"),
      );
      break;
    case "trial_vote":
      if (request.value !== "yes" && request.value !== "no") {
        throw new Error("찬반 투표 값이 올바르지 않습니다.");
      }
      await game.submitTrialVote(client, userId, request.value, token);
      break;
    case "time_adjust":
      if (request.value !== "add" && request.value !== "cut") {
        throw new Error("시간 조절 값이 올바르지 않습니다.");
      }
      await game.adjustDiscussionTime(client, userId, request.value as TimeAdjust, token);
      break;
    case "reporter_publish":
      await game.publishReporterArticle(client, userId);
      break;
    default:
      throw new Error("지원하지 않는 웹 행동입니다.");
  }
}

function makeSelectionRequest(
  kind: NightSelectionRequest["kind"],
  actorId: string,
  targetId: string,
  token: number | undefined,
  action?: string,
): NightSelectionRequest {
  return {
    kind,
    actorId,
    targetId,
    token: token ?? 0,
    action,
  };
}
