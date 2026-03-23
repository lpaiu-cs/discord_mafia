import { Client } from "discord.js";
import { MafiaGame } from "../game/game";

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
  switch (request.actionType) {
    case "vote":
      if (!request.targetId) {
        throw new Error("투표 대상이 필요합니다.");
      }
      await game.handleVoteSelect(client, createSelectInteraction(`vote:${game.id}:${game.phaseContext?.token ?? 0}`, userId, request.targetId) as never);
      break;
    case "night_select":
      if (!request.action || !request.targetId) {
        throw new Error("밤 행동과 대상이 필요합니다.");
      }
      await game.handleNightSelect(
        client,
        createSelectInteraction(`night:${game.id}:${game.phaseContext?.token ?? 0}:${userId}:${request.action}`, userId, request.targetId) as never,
      );
      break;
    case "madam_select":
      if (!request.targetId) {
        throw new Error("유혹 대상이 필요합니다.");
      }
      await game.handleNightSelect(
        client,
        createSelectInteraction(`madam:${game.id}:${game.phaseContext?.token ?? 0}:${userId}:select`, userId, request.targetId) as never,
      );
      break;
    case "terror_burn":
      if (!request.targetId) {
        throw new Error("산화 대상이 필요합니다.");
      }
      await game.handleNightSelect(
        client,
        createSelectInteraction(`terror:${game.id}:${game.phaseContext?.token ?? 0}:${userId}:burn`, userId, request.targetId) as never,
      );
      break;
    case "aftermath_select":
      if (!request.targetId) {
        throw new Error("후속 선택 대상이 필요합니다.");
      }
      await game.handleNightSelect(
        client,
        createSelectInteraction(
          `aftermath:${game.id}:${game.phaseContext?.token ?? 0}:${userId}:${request.action ?? game.pendingAftermathChoice?.action ?? "mediumAscend"}`,
          userId,
          request.targetId,
        ) as never,
      );
      break;
    case "trial_vote":
      if (request.value !== "yes" && request.value !== "no") {
        throw new Error("찬반 투표 값이 올바르지 않습니다.");
      }
      await game.handleTrialVote(
        client,
        createButtonInteraction(`trial:${game.id}:${game.phaseContext?.token ?? 0}:${request.value}`, userId) as never,
        request.value,
      );
      break;
    case "time_adjust":
      if (request.value !== "add" && request.value !== "cut") {
        throw new Error("시간 조절 값이 올바르지 않습니다.");
      }
      await game.handleTimeAdjust(
        client,
        createButtonInteraction(`time:${game.id}:${game.phaseContext?.token ?? 0}:${request.value}`, userId) as never,
        request.value,
      );
      break;
    case "reporter_publish":
      await game.handleReporterPublish(
        client,
        createButtonInteraction(`reporter:${game.id}:${game.dayNumber}:${userId}:publish`, userId) as never,
      );
      break;
    default:
      throw new Error("지원하지 않는 웹 행동입니다.");
  }

  game.bumpStateVersion();
}

function createSelectInteraction(customId: string, userId: string, targetId: string) {
  return {
    customId,
    user: { id: userId },
    values: [targetId],
    async update(_payload: unknown) {
      return;
    },
    async reply(_payload: unknown) {
      return;
    },
  };
}

function createButtonInteraction(customId: string, userId: string) {
  return {
    customId,
    user: { id: userId },
    async reply(_payload: unknown) {
      return;
    },
    async update(_payload: unknown) {
      return;
    },
  };
}
