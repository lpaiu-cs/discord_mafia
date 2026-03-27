import { NightActionType, PlayerState } from "./model";
import type { MafiaGame, WebChatChannel } from "./game";
import { isMafiaTeam } from "./model";

export interface PromptDefinition {
  action: NightActionType;
  title: string;
  description: string;
  targets: string[];
}

export function getSecretChatAccess(
  game: MafiaGame,
  channel: Exclude<WebChatChannel, "public">
): { readableIds: Set<string>; writableIds: Set<string> } {
  const readableIds = new Set<string>();
  const writableIds = new Set<string>();

  switch (channel) {
    case "mafia": {
      if (game.phase !== "night") {
        return { readableIds, writableIds };
      }

      for (const player of game.alivePlayers) {
        if (player.role === "mafia" || player.isContacted) {
          readableIds.add(player.userId);
          writableIds.add(player.userId);
        }
      }

      for (const player of game.deadPlayers) {
        readableIds.add(player.userId);
      }

      return { readableIds, writableIds };
    }
    case "lover": {
      if (game.phase !== "night" || !game.loverPair) {
        return { readableIds, writableIds };
      }

      for (const player of game.alivePlayers) {
        if (player.role === "lover" && player.loverId) {
          readableIds.add(player.userId);
          writableIds.add(player.userId);
        }
      }

      for (const player of game.deadPlayers) {
        readableIds.add(player.userId);
      }

      return { readableIds, writableIds };
    }
    case "graveyard": {
      if (game.phase !== "night") {
        return { readableIds, writableIds };
      }

      for (const player of game.deadPlayers) {
        readableIds.add(player.userId);
        if (!player.ascended) {
          writableIds.add(player.userId);
        }
      }

      const medium = game.alivePlayers.find((player) => player.role === "medium");
      if (medium) {
        readableIds.add(medium.userId);
        writableIds.add(medium.userId);
      }

      return { readableIds, writableIds };
    }
  }
}

export function canReadChat(game: MafiaGame, userId: string, channel: WebChatChannel): boolean {
  const player = game.getPlayer(userId);
  if (!player) {
    return false;
  }

  switch (channel) {
    case "public":
      return true;
    case "mafia":
    case "lover":
    case "graveyard":
      return getSecretChatAccess(game, channel).readableIds.has(userId);
    default:
      return false;
  }
}

export function canWriteChat(game: MafiaGame, userId: string, channel: WebChatChannel): boolean {
  const player = game.getPlayer(userId);
  if (!player || !canReadChat(game, userId, channel)) {
    return false;
  }

  switch (channel) {
    case "public":
      if (!player.alive) {
        return false;
      }
      if (game.phase === "discussion") {
        return true;
      }
      if (game.phase === "defense") {
        return game.currentTrialTargetId === userId;
      }
      return false;
    case "mafia":
    case "lover":
    case "graveyard":
      return getSecretChatAccess(game, channel).writableIds.has(userId);
    default:
      return false;
  }
}

export function isBlockedTonight(game: MafiaGame, userId: string): boolean {
  return game.blockedTonightTargetId === userId;
}

export function isPoliticianEffectBlocked(game: MafiaGame, userId: string): boolean {
  return game.pendingSeductionTargetId === userId;
}

export function hasOtherAliveMafiaTeam(game: MafiaGame, userId: string): boolean {
  const aliveMafia = game.alivePlayers.filter((player) => isMafiaTeam(player.role));
  return aliveMafia.some((player) => player.userId !== userId);
}

export function hasActiveNightAction(role: string): boolean {
  return [
    "mafia",
    "spy",
    "beastman",
    "police",
    "doctor",
    "medium",
    "thug",
    "reporter",
    "detective",
    "terrorist",
    "priest",
  ].includes(role);
}

export function getNightPrompt(game: MafiaGame, userId: string): PromptDefinition | null {
  const player = game.getPlayerOrThrow(userId);
  if (!player.alive) {
    return null;
  }

  if (isBlockedTonight(game, userId) && hasActiveNightAction(player.role)) {
    return null;
  }

  switch (player.role) {
    case "mafia":
      return {
        action: "mafiaKill",
        title: "마피아 처형 대상 선택",
        description: "마지막으로 제출한 마피아의 선택이 최종 대상이 됩니다.",
        targets: game.alivePlayers.map((target) => target.userId),
      };
    case "spy":
      return {
        action: "spyInspect",
        title: "스파이 조사",
        description: "조사할 플레이어 한 명을 선택하세요.",
        targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
      };
    case "beastman":
      if (player.isContacted && !hasOtherAliveMafiaTeam(game, userId)) {
        return {
          action: "beastKill",
          title: "짐승인간 처형 대상",
          description: "마피아가 전멸한 뒤에는 혼자 대상을 처형할 수 있습니다.",
          targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      }

      return {
        action: "beastMark",
        title: "짐승인간 표식",
        description: "표식을 남길 대상을 고르세요.",
        targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
      };
    case "police":
      return {
        action: "policeInspect",
        title: "경찰 조사",
        description: "마피아 여부를 확인할 대상을 고르세요.",
        targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
      };
    case "doctor":
      return {
        action: "doctorProtect",
        title: "의사 치료",
        description: "살릴 플레이어를 선택하세요. 자기 자신도 선택할 수 있습니다.",
        targets: game.alivePlayers.map((target) => target.userId),
      };
    case "medium":
      return null;
    case "thug":
      return {
        action: "thugThreaten",
        title: "건달 협박",
        description: "내일 투표권을 빼앗을 플레이어를 고르세요.",
        targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
      };
    case "reporter":
      if (player.reporterUsed) {
        return null;
      }
      return {
        action: "reporterArticle",
        title: "기자 취재",
        description: "취재할 플레이어를 선택하세요.",
        targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
      };
    case "detective":
      return {
        action: "detectiveTrack",
        title: "탐정 조사",
        description: "행동 대상을 추적할 플레이어를 선택하세요.",
        targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
      };
    case "terrorist":
      return {
        action: "terrorMark",
        title: "테러리스트 자폭 표식",
        description: "오늘 밤 당신을 쏠 것 같은 대상을 선택하세요.",
        targets: game.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
      };
    case "priest":
      return null;
    default:
      return null;
  }
}
