import { MafiaGame, WebChatChannel } from "../game/game";
import { Phase, PlayerState } from "../game/model";
import { getRoleLabel, getRoleSummary, getTeamLabel } from "../game/rules";

const PHASE_LABELS: Record<Phase, string> = {
  lobby: "로비",
  night: "밤",
  discussion: "낮 토론",
  vote: "투표",
  defense: "최후의 반론",
  trial: "찬반 투표",
  ended: "종료",
};

const CHAT_TITLES: Record<WebChatChannel, string> = {
  public: "공개 채팅",
  mafia: "마피아 채팅",
  lover: "연인 채팅",
  graveyard: "망자 채팅",
};

export interface DashboardActionOption {
  label: string;
  value: string;
}

export interface DashboardActionButton {
  label: string;
  value: string;
}

export interface DashboardActionControl {
  id: string;
  type: "select" | "buttons" | "button" | "info";
  actionType: string;
  title: string;
  description: string;
  action?: string;
  options?: DashboardActionOption[];
  buttons?: DashboardActionButton[];
  currentValue?: string | null;
  currentLabel?: string | null;
}

export interface DashboardChatView {
  channel: WebChatChannel;
  title: string;
  canWrite: boolean;
  messages: Array<{
    id: string;
    authorName: string;
    authorId: string;
    content: string;
    createdAt: number;
  }>;
}

export interface DashboardStatePayload {
  version: number;
  viewer: {
    userId: string;
    displayName: string;
    roleLabel: string;
    teamLabel: string;
    roleSummary: string;
    alive: boolean;
    contacted: boolean;
    loverName: string | null;
    deadReason: string | null;
    ascended: boolean;
  };
  room: {
    gameId: string;
    rulesetLabel: string;
    phase: Phase;
    phaseLabel: string;
    dayNumber: number;
    nightNumber: number;
    deadlineAt: number | null;
    currentTrialTargetName: string | null;
    alivePlayers: Array<{ userId: string; displayName: string; bullied: boolean }>;
    deadPlayers: Array<{ userId: string; displayName: string; ascended: boolean }>;
  };
  publicLines: string[];
  publicChat: DashboardChatView;
  secretChats: DashboardChatView[];
  actions: {
    notices: string[];
    controls: DashboardActionControl[];
  };
  systemLog: {
    privateLines: Array<{ id: string; line: string; createdAt: number }>;
  };
}

export interface DashboardStateResponse {
  changed: boolean;
  version: number;
  state?: DashboardStatePayload;
}

export function buildDashboardState(
  game: MafiaGame,
  userId: string,
  sinceVersion?: number,
): DashboardStateResponse {
  if (sinceVersion && sinceVersion === game.stateVersion) {
    return {
      changed: false,
      version: game.stateVersion,
    };
  }

  const player = game.getPlayerOrThrow(userId);
  const state: DashboardStatePayload = {
    version: game.stateVersion,
    viewer: {
      userId,
      displayName: player.displayName,
      roleLabel: getRoleLabel(player.role),
      teamLabel: getTeamLabel(player.role),
      roleSummary: getRoleSummary(player.role, game.ruleset),
      alive: player.alive,
      contacted: player.isContacted,
      loverName: player.loverId ? game.getPlayer(player.loverId)?.displayName ?? null : null,
      deadReason: player.deadReason ?? null,
      ascended: player.ascended,
    },
    room: {
      gameId: game.id,
      rulesetLabel: game.ruleset === "balance" ? "시즌4 밸런스" : "시즌4 초기",
      phase: game.phase,
      phaseLabel: PHASE_LABELS[game.phase],
      dayNumber: game.dayNumber,
      nightNumber: game.nightNumber,
      deadlineAt: game.phaseContext?.deadlineAt ?? null,
      currentTrialTargetName: game.currentTrialTargetId ? game.getPlayer(game.currentTrialTargetId)?.displayName ?? null : null,
      alivePlayers: game.alivePlayers.map((alivePlayer) => ({
        userId: alivePlayer.userId,
        displayName: alivePlayer.displayName,
        bullied: game.bulliedToday.has(alivePlayer.userId),
      })),
      deadPlayers: game.deadPlayers.map((deadPlayer) => ({
        userId: deadPlayer.userId,
        displayName: deadPlayer.displayName,
        ascended: deadPlayer.ascended,
      })),
    },
    publicLines: [...game.lastPublicLines],
    publicChat: buildChatView(game, "public", userId),
    secretChats: (["mafia", "lover", "graveyard"] as const)
      .filter((channel) => game.canReadChat(userId, channel))
      .map((channel) => buildChatView(game, channel, userId)),
    actions: buildActionPanel(game, player),
    systemLog: {
      privateLines: game.getPrivateLog(userId),
    },
  };

  return {
    changed: true,
    version: game.stateVersion,
    state,
  };
}

function buildActionPanel(game: MafiaGame, player: PlayerState): DashboardStatePayload["actions"] {
  const notices: string[] = [];
  const controls: DashboardActionControl[] = [];

  if (!player.alive) {
    notices.push(player.ascended ? "성불 상태에서는 망자 채팅에 쓸 수 없습니다." : "사망 상태입니다.");
  }

  if (game.pendingAftermathChoice && game.pendingAftermathChoice.actorId === player.userId) {
    controls.push({
      id: `aftermath:${game.pendingAftermathChoice.action}`,
      type: "select",
      actionType: "aftermath_select",
      action: game.pendingAftermathChoice.action,
      title: game.pendingAftermathChoice.title,
      description: game.pendingAftermathChoice.description,
      options: game.pendingAftermathChoice.targetIds.map((targetId) => ({
        label: game.getPlayerOrThrow(targetId).displayName,
        value: targetId,
      })),
    });
    return { notices, controls };
  }

  switch (game.phase) {
    case "lobby":
      controls.push({
        id: "lobby-waiting",
        type: "info",
        actionType: "noop",
        title: "대기 중",
        description: "Discord 로비에서 참가 인원을 모은 뒤 게임이 시작되면 자동으로 대시보드가 갱신됩니다.",
      });
      break;
    case "night":
      buildNightControls(game, player, notices, controls);
      break;
    case "discussion":
      buildDiscussionControls(game, player, controls);
      break;
    case "vote":
      buildVoteControls(game, player, notices, controls);
      break;
    case "defense":
      buildDefenseControls(game, player, controls);
      break;
    case "trial":
      buildTrialControls(game, player, notices, controls);
      break;
    case "ended":
      controls.push({
        id: "ended",
        type: "info",
        actionType: "noop",
        title: "게임 종료",
        description: "이 게임은 종료되었습니다. Discord 로비에서 다음 게임을 열 수 있습니다.",
      });
      break;
    default:
      break;
  }

  if (controls.length === 0) {
    controls.push({
      id: "no-action",
      type: "info",
      actionType: "noop",
      title: "현재 행동 없음",
      description: "지금 제출할 수 있는 행동이 없습니다.",
    });
  }

  return { notices, controls };
}

function buildNightControls(
  game: MafiaGame,
  player: PlayerState,
  notices: string[],
  controls: DashboardActionControl[],
): void {
  if (!player.alive) {
    return;
  }

  if (game.spyBonusGrantedTonight.has(player.userId)) {
    const options = game.alivePlayers
      .filter((target) => target.userId !== player.userId)
      .map((target) => ({ label: target.displayName, value: target.userId }));
    controls.push({
      id: "spy-bonus",
      type: "select",
      actionType: "night_select",
      action: "spyInspectBonus",
      title: "스파이 추가 조사",
      description: "마피아를 찾아 같은 밤에 한 번 더 조사할 수 있습니다.",
      options,
      currentValue: game.bonusNightActions.get(player.userId)?.targetId ?? null,
      currentLabel: labelForTarget(game, game.bonusNightActions.get(player.userId)?.targetId),
    });
    return;
  }

  const prompt = game.getNightPromptForPlayer(player.userId);
  if (!prompt) {
    if (game.blockedTonightTargetId === player.userId && hasActiveNightAction(player.role)) {
      notices.push("오늘 밤에는 유혹 상태라 능력을 사용할 수 없습니다.");
    }
    return;
  }

  controls.push({
    id: `night:${prompt.action}`,
    type: "select",
    actionType: "night_select",
    action: prompt.action,
    title: prompt.title,
    description: prompt.description,
    options: prompt.targets.map((targetId) => ({
      label: game.getPlayerOrThrow(targetId).displayName,
      value: targetId,
    })),
    currentValue: game.nightActions.get(player.userId)?.targetId ?? null,
    currentLabel: labelForTarget(game, game.nightActions.get(player.userId)?.targetId),
  });
}

function buildDiscussionControls(game: MafiaGame, player: PlayerState, controls: DashboardActionControl[]): void {
  if (player.alive && player.timeAdjustUsedOnDay !== game.dayNumber) {
    controls.push({
      id: "time-adjust",
      type: "buttons",
      actionType: "time_adjust",
      title: "토론 시간 조절",
      description: "하루에 한 번만 토론 시간을 15초 늘리거나 줄일 수 있습니다.",
      buttons: [
        { label: "-15초", value: "cut" },
        { label: "+15초", value: "add" },
      ],
    });
  }

  if (
    game.pendingArticle &&
    game.pendingArticle.actorId === player.userId &&
    game.dayNumber >= game.pendingArticle.publishFromDay &&
    player.alive
  ) {
    controls.push({
      id: "reporter-publish",
      type: "button",
      actionType: "reporter_publish",
      title: "기자 기사 공개",
      description: "준비한 기사를 지금 공개합니다.",
    });
  }
}

function buildVoteControls(
  game: MafiaGame,
  player: PlayerState,
  notices: string[],
  controls: DashboardActionControl[],
): void {
  if (player.alive && !game.bulliedToday.has(player.userId)) {
    controls.push({
      id: "day-vote",
      type: "select",
      actionType: "vote",
      title: "낮 투표",
      description: "처형 대상으로 한 명을 선택합니다.",
      options: game.alivePlayers.map((target) => ({
        label: target.displayName,
        value: target.userId,
      })),
      currentValue: game.dayVotes.get(player.userId) ?? null,
      currentLabel: labelForTarget(game, game.dayVotes.get(player.userId)),
    });
  }

  if (game.bulliedToday.has(player.userId)) {
    notices.push("건달에게 협박당해 오늘은 투표할 수 없습니다.");
  }

  if (player.alive && player.role === "madam") {
    controls.push({
      id: "madam-select",
      type: "select",
      actionType: "madam_select",
      title: "마담 유혹",
      description: "오늘 투표 시간에 한 명을 유혹해 오늘 밤 능력을 막습니다.",
      options: game.alivePlayers
        .filter((target) => target.userId !== player.userId)
        .map((target) => ({ label: target.displayName, value: target.userId })),
      currentValue: game.pendingSeductionTargetId,
      currentLabel: labelForTarget(game, game.pendingSeductionTargetId),
    });
  }
}

function buildDefenseControls(game: MafiaGame, player: PlayerState, controls: DashboardActionControl[]): void {
  if (player.alive && game.currentTrialTargetId === player.userId && player.role === "terrorist") {
    controls.push({
      id: "terror-burn",
      type: "select",
      actionType: "terror_burn",
      title: "테러리스트 산화 대상",
      description: "처형될 경우 함께 끌고 갈 대상을 미리 고릅니다.",
      options: game.alivePlayers
        .filter((target) => target.userId !== player.userId)
        .map((target) => ({ label: target.displayName, value: target.userId })),
      currentValue: game.pendingTrialBurns.get(player.userId)?.targetId ?? null,
      currentLabel: labelForTarget(game, game.pendingTrialBurns.get(player.userId)?.targetId),
    });
  }
}

function buildTrialControls(
  game: MafiaGame,
  player: PlayerState,
  notices: string[],
  controls: DashboardActionControl[],
): void {
  if (!player.alive) {
    return;
  }

  if (game.bulliedToday.has(player.userId)) {
    notices.push("건달에게 협박당해 오늘은 찬반 투표도 할 수 없습니다.");
    return;
  }

  controls.push({
    id: "trial-vote",
    type: "buttons",
    actionType: "trial_vote",
    title: "찬반 투표",
    description: "현재 대상을 처형할지 선택합니다.",
    buttons: [
      { label: "찬성", value: "yes" },
      { label: "반대", value: "no" },
    ],
    currentValue: game.trialVotes.get(player.userId) ?? null,
    currentLabel:
      game.trialVotes.get(player.userId) === "yes" ? "찬성" : game.trialVotes.get(player.userId) === "no" ? "반대" : null,
  });
}

function buildChatView(game: MafiaGame, channel: WebChatChannel, userId?: string): DashboardChatView {
  return {
    channel,
    title: CHAT_TITLES[channel],
    canWrite: userId ? game.canWriteChat(userId, channel) : false,
    messages: game.webChats[channel].map((message) => ({
      id: message.id,
      authorId: message.authorId,
      authorName: message.authorName,
      content: message.content,
      createdAt: message.createdAt,
    })),
  };
}

function labelForTarget(game: MafiaGame, targetId?: string | null): string | null {
  if (!targetId) {
    return null;
  }

  return game.getPlayer(targetId)?.displayName ?? null;
}

function hasActiveNightAction(role: PlayerState["role"]): boolean {
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
