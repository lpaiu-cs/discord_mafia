import { Client, Guild, GuildMember } from "discord.js";
import { GameRegistry, MafiaGame, WebChatChannel } from "../game/game";
import { PlayerState, Role, Ruleset } from "../game/model";

type InternalGame = MafiaGame & Record<string, any>;

interface PracticePlayerSeed {
  userId: string;
  displayName: string;
  role: Role;
  alive?: boolean;
  deadReason?: string;
  isContacted?: boolean;
  loverId?: string;
  ascended?: boolean;
}

interface PracticeChatSeed {
  channel: WebChatChannel;
  authorId: string;
  content: string;
  kind?: "player" | "system";
}

interface PracticePrivateLogSeed {
  userId: string;
  line: string;
}

interface PracticeScenarioSetup {
  players: PracticePlayerSeed[];
  startPhase: "night" | "discussion";
  publicIntroLines: string[];
  initialChats?: PracticeChatSeed[];
  privateLogs?: PracticePrivateLogSeed[];
}

export interface PracticeScenarioDefinition {
  id: "practice1" | "practice2" | "practice3" | "practice4";
  title: string;
  summary: string;
  viewerRole: Role;
  setup: PracticeScenarioSetup;
}

export interface PracticeBootstrapOptions {
  enableTimers?: boolean;
}

export const PRACTICE_VIEWER_ID = "practice-viewer";
export const PRACTICE_VIEWER_NAME = "민우";

export function buildPracticeScenarioDefinitions(): PracticeScenarioDefinition[] {
  return [
    {
      id: "practice1",
      title: "practice1: 마피아 시점",
      summary: "마피아로 시작해 밤 행동과 낮 투표가 실제 결과에 반영되는 연습판이다.",
      viewerRole: "mafia",
      setup: {
        startPhase: "night",
        publicIntroLines: [
          "practice1: 마피아 시점 연습이 시작되었습니다.",
          "1번째 밤입니다. 마피아 채팅과 행동 패널을 확인하세요.",
        ],
        players: [
          makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "mafia", true),
          makePlayer("ally-spy", "하린지수", "spy", true, true),
          makePlayer("police", "서준도윤", "police", true),
          makePlayer("politician", "정치연", "politician", true),
          makePlayer("thug", "도윤", "thug", true),
          makePlayer("reporter", "지호", "reporter", true),
        ],
        initialChats: [
          { channel: "mafia", authorId: "ally-spy", content: "오늘은 수상한 사람 한 명을 정해서 움직여 봅시다." },
        ],
        privateLogs: [{ userId: PRACTICE_VIEWER_ID, line: "practice1: 내가 고른 마피아 대상이 실제 밤 결과를 바꿉니다." }],
      },
    },
    {
      id: "practice2",
      title: "practice2: 정치인 시점",
      summary: "정치인으로 시작하고 비밀 채팅이 숨겨진 상태에서 실제 낮 투표 흐름을 본다.",
      viewerRole: "politician",
      setup: {
        startPhase: "discussion",
        publicIntroLines: [
          "practice2: 정치인 시점 연습이 시작되었습니다.",
          "공개 채팅만 보이고 비밀 채팅은 숨겨져야 합니다.",
        ],
        players: [
          makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "politician", true),
          makePlayer("mafia", "하린지수", "mafia", true),
          makePlayer("doctor", "서준", "doctor", true),
          makePlayer("thug", "도윤서아", "thug", true),
          makePlayer("reporter", "지호민서", "reporter", true),
          makePlayer("dead-detective", "소연", "detective", false, false, undefined, false, "practice2 seeded dead"),
        ],
        initialChats: [
          { channel: "public", authorId: "doctor", content: "정치인은 공개 채팅과 투표 흐름을 중심으로 보면 됩니다." },
          { channel: "mafia", authorId: "mafia", content: "이 대화는 정치인 화면에 보이면 안 됩니다." },
        ],
        privateLogs: [{ userId: PRACTICE_VIEWER_ID, line: "practice2: 비밀 채팅 패널이 비어 있으면 정상입니다." }],
      },
    },
    {
      id: "practice3",
      title: "practice3: 영매 시점",
      summary: "영매로 시작해 밤의 망자 채팅과 후속 선택이 실제 규칙대로 반영되는 연습판이다.",
      viewerRole: "medium",
      setup: {
        startPhase: "night",
        publicIntroLines: [
          "practice3: 영매 시점 연습이 시작되었습니다.",
          "밤에는 망자 채팅이 열리고 영매도 읽고 쓸 수 있습니다.",
        ],
        players: [
          makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "medium", true),
          makePlayer("mafia", "하린", "mafia", true),
          makePlayer("priest", "예린지수", "priest", true),
          makePlayer("politician", "도윤", "politician", true),
          makePlayer("dead-reporter", "소연", "reporter", false, false, undefined, false, "practice3 seeded dead"),
          makePlayer("dead-doctor", "서준", "doctor", false, false, undefined, false, "practice3 seeded dead"),
        ],
        initialChats: [
          { channel: "graveyard", authorId: "dead-reporter", content: "영매님, 밤에는 저희 대화가 보여야 합니다." },
          { channel: "graveyard", authorId: "dead-doctor", content: "누가 새로 죽으면 후속 선택도 직접 확인해 보세요." },
        ],
        privateLogs: [{ userId: PRACTICE_VIEWER_ID, line: "practice3: 밤의 망자 채팅과 영매 후속 선택을 직접 시험할 수 있습니다." }],
      },
    },
    {
      id: "practice4",
      title: "practice4: 사망자 시점",
      summary: "이미 죽은 상태로 시작해 밤 망자 채팅과 낮 read-only 상태를 실제 흐름에서 본다.",
      viewerRole: "citizen",
      setup: {
        startPhase: "night",
        publicIntroLines: [
          "practice4: 사망자 시점 연습이 시작되었습니다.",
          "죽은 상태에서는 밤에 망자 채팅만 쓸 수 있습니다.",
        ],
        players: [
          makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "citizen", false, false, undefined, false, "practice4 seeded dead"),
          makePlayer("mafia", "하린", "mafia", true),
          makePlayer("doctor", "서준지수", "doctor", true),
          makePlayer("lover-a", "연서", "lover", true, false, "lover-b"),
          makePlayer("lover-b", "도윤", "lover", true, false, "lover-a"),
          makePlayer("dead-detective", "소연", "detective", false, false, undefined, false, "practice4 seeded dead"),
        ],
        initialChats: [{ channel: "graveyard", authorId: "dead-detective", content: "사망자는 밤에만 이 채널에 쓸 수 있습니다." }],
        privateLogs: [{ userId: PRACTICE_VIEWER_ID, line: "practice4: 낮에는 공개 채팅을 읽기만 할 수 있습니다." }],
      },
    },
  ];
}

export function createPracticeGame(
  manager: GameRegistry,
  definition: PracticeScenarioDefinition,
  ruleset: Ruleset,
): { game: InternalGame } {
  const guild = { id: `practice-guild-${definition.id}` } as Guild;
  const host = createMember(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME);
  const game = manager.create(guild, `practice-channel-${definition.id}`, host, ruleset) as InternalGame;
  seedPlayers(game, definition.setup.players);
  return { game };
}

export async function initializePracticeGame(
  game: InternalGame,
  definition: PracticeScenarioDefinition,
  client: Client,
  options: PracticeBootstrapOptions = {},
): Promise<void> {
  resetPracticeState(game);
  seedPlayers(game, definition.setup.players);

  if (definition.setup.startPhase === "discussion") {
    game.dayNumber = 1;
    game.nightNumber = 0;
    await (game as any).beginDiscussion(client, definition.setup.publicIntroLines);
  } else {
    game.dayNumber = 0;
    game.nightNumber = 0;
    for (const line of definition.setup.publicIntroLines) {
      appendSystemChat(game, "public", line);
    }
    await (game as any).beginNight(client);
  }

  for (const chat of definition.setup.initialChats ?? []) {
    if (chat.kind === "system") {
      appendSystemChat(game, chat.channel, chat.content);
      continue;
    }
    appendPlayerChat(game, chat.channel, chat.authorId, chat.content);
  }

  for (const log of definition.setup.privateLogs ?? []) {
    appendPrivateLog(game, log.userId, log.line);
  }

  game.bumpStateVersion();
  if (options.enableTimers === false) {
    (game as any).clearTimer();
  }
}

function resetPracticeState(game: InternalGame): void {
  if (game.pendingAftermathChoice) {
    clearTimeout(game.pendingAftermathChoice.timeout);
    game.pendingAftermathChoice = null;
  }

  (game as any).clearTimer();
  game.phase = "lobby";
  game.phaseContext = null;
  game.dayNumber = 0;
  game.nightNumber = 0;
  game.currentTrialTargetId = null;
  game.pendingSeductionTargetId = null;
  game.blockedTonightTargetId = null;
  game.pendingArticle = null;
  game.endedWinner = null;
  game.endedReason = null;
  game.lastPublicLines = [];
  game.bulliedToday = new Set<string>();
  game.bulliedNextDay = new Set<string>();
  game.dayVotes.clear();
  game.trialVotes.clear();
  game.nightActions.clear();
  game.bonusNightActions.clear();
  game.spyBonusGrantedTonight.clear();
  game.pendingTrialBurns.clear();
}

function seedPlayers(game: InternalGame, seeds: PracticePlayerSeed[]): void {
  game.players.clear();
  game.contactedIds.clear();
  game.privateLogs.clear();
  game.deadOrder.length = 0;
  game.loverPair = null;
  game.webChats.public.length = 0;
  game.webChats.mafia.length = 0;
  game.webChats.lover.length = 0;
  game.webChats.graveyard.length = 0;

  for (const seed of seeds) {
    const playerState: PlayerState = {
      userId: seed.userId,
      displayName: seed.displayName,
      role: seed.role,
      originalRole: seed.role,
      alive: seed.alive ?? true,
      deadReason: seed.alive === false ? seed.deadReason ?? "연습 시나리오 사망" : undefined,
      isContacted: seed.isContacted ?? seed.role === "mafia",
      loverId: seed.loverId,
      ascended: seed.ascended ?? false,
      soldierUsed: false,
      reporterUsed: false,
      priestUsed: false,
      terrorMarkId: undefined,
      voteLockedToday: false,
      timeAdjustUsedOnDay: null,
    };

    game.players.set(seed.userId, playerState);
    if (playerState.isContacted) {
      game.contactedIds.add(seed.userId);
    }
    if (!playerState.alive) {
      game.deadOrder.push(seed.userId);
    }
  }

  const lovers = seeds.filter((seed) => Boolean(seed.loverId)).map((seed) => seed.userId);
  if (lovers.length === 2) {
    game.loverPair = [lovers[0], lovers[1]];
  }
}

function appendPlayerChat(game: InternalGame, channel: WebChatChannel, authorId: string, content: string): void {
  const author = game.getPlayerOrThrow(authorId);
  game.webChats[channel].push({
    id: makeId(),
    channel,
    kind: "player",
    authorId,
    authorName: author.displayName,
    content,
    createdAt: Date.now(),
  });
}

function appendSystemChat(game: InternalGame, channel: WebChatChannel, content: string): void {
  game.webChats[channel].push({
    id: makeId(),
    channel,
    kind: "system",
    authorId: "system",
    authorName: "시스템",
    content,
    createdAt: Date.now(),
  });
}

function appendPrivateLog(game: InternalGame, userId: string, line: string): void {
  const entries = game.privateLogs.get(userId) ?? [];
  entries.push({
    id: makeId(),
    line,
    createdAt: Date.now(),
  });
  game.privateLogs.set(userId, entries);
}

function makePlayer(
  userId: string,
  displayName: string,
  role: Role,
  alive = true,
  isContacted = false,
  loverId?: string,
  ascended = false,
  deadReason?: string,
): PracticePlayerSeed {
  return {
    userId,
    displayName,
    role,
    alive,
    isContacted,
    loverId,
    ascended,
    deadReason,
  };
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, "0")}`;
}

function createMember(id: string, displayName: string): GuildMember {
  return {
    id,
    displayName,
    user: {
      id,
      username: displayName,
      bot: false,
    },
  } as never as GuildMember;
}
