import { Guild, GuildMember } from "discord.js";
import { GameManager, MafiaGame, WebChatChannel } from "../game/game";
import { PendingArticle, Phase, PlayerState, Role, Ruleset } from "../game/model";

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

export interface PracticeStep {
  afterMs: number;
  label: string;
  run: (game: InternalGame) => void;
}

export interface PracticeScenarioDefinition {
  id: "practice1" | "practice2" | "practice3" | "practice4";
  title: string;
  summary: string;
  viewerRole: Role;
  seed: (game: InternalGame) => PracticeStep[];
}

const NIGHT_MS = 28_000;
const DISCUSSION_MS = 24_000;
const VOTE_MS = 12_000;
const DEFENSE_MS = 12_000;
const TRIAL_MS = 12_000;

export const PRACTICE_VIEWER_ID = "practice-viewer";
export const PRACTICE_VIEWER_NAME = "민우";

export function buildPracticeScenarioDefinitions(): PracticeScenarioDefinition[] {
  return [
    {
      id: "practice1",
      title: "practice1: 마피아 시점",
      summary: "밤 마피아 채팅과 낮 공개 채팅, 둘째 날까지의 흐름을 함께 본다.",
      viewerRole: "mafia",
      seed: seedPractice1,
    },
    {
      id: "practice2",
      title: "practice2: 정치인 시점",
      summary: "정치인에게 보이면 안 되는 마피아/망자 대화가 숨겨지는지 본다.",
      viewerRole: "politician",
      seed: seedPractice2,
    },
    {
      id: "practice3",
      title: "practice3: 영매 시점",
      summary: "밤의 망자 채팅과 영매 시야를 중심으로 둘째 날까지 본다.",
      viewerRole: "medium",
      seed: seedPractice3,
    },
    {
      id: "practice4",
      title: "practice4: 사망자 시점",
      summary: "처음부터 죽은 상태로 시작해 망자 채팅 read/write 와 낮 read-only 를 본다.",
      viewerRole: "citizen",
      seed: seedPractice4,
    },
  ];
}

export function createPracticeGame(
  manager: GameManager,
  definition: PracticeScenarioDefinition,
  ruleset: Ruleset,
): { game: InternalGame; steps: PracticeStep[] } {
  const guild = { id: `practice-guild-${definition.id}` } as Guild;
  const host = createMember(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME);
  const game = manager.create(guild, `practice-channel-${definition.id}`, host, ruleset) as InternalGame;
  const steps = definition.seed(game);
  return { game, steps };
}

function seedPractice1(game: InternalGame): PracticeStep[] {
  seedPlayers(game, [
    makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "mafia", true),
    makePlayer("ally-spy", "하린지수", "spy", true, true),
    makePlayer("doctor", "서준도윤", "doctor", true),
    makePlayer("politician", "정치연", "politician", true),
    makePlayer("thug", "도윤", "thug", true),
    makePlayer("reporter", "지호", "reporter", true),
  ]);

  runStep(game, () => {
    setPhaseSnapshot(game, {
      phase: "night",
      dayNumber: 0,
      nightNumber: 1,
      durationMs: NIGHT_MS,
      publicLines: ["practice1: 마피아 시점 연습이 시작되었습니다.", "1번째 밤입니다. 마피아 채팅과 행동 패널을 확인하세요."],
    });
    appendChat(game, "mafia", "ally-spy", "오늘은 도윤 먼저 압박해 보죠.");
    appendPrivateLog(game, PRACTICE_VIEWER_ID, "practice1: 밤에는 마피아 채팅을 읽고 쓸 수 있습니다.");
  });

  return [
    step(6_000, "밤 1차 마피아 대화", (draft) => {
      appendChat(draft, "mafia", "ally-spy", "낮에는 공개 채팅으로 자연스럽게 움직이겠습니다.");
    }),
    step(14_000, "밤 2차 마피아 대화", (draft) => {
      appendChat(draft, "mafia", "ally-spy", "행동 패널에서 대상을 바꿔도 UI가 유지되는지 봐 주세요.");
    }),
    step(28_000, "1번째 낮 토론 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 1,
        nightNumber: 1,
        durationMs: DISCUSSION_MS,
        publicLines: ["1번째 낮이 시작되었습니다.", "밤사이 사망자는 없었습니다."],
      });
      appendChat(draft, "public", "politician", "저는 아직 누구를 몰지 정하지 않았습니다.");
    }),
    step(38_000, "낮 공개 대화 추가", (draft) => {
      appendChat(draft, "public", "doctor", "서두르지 말고 발언을 더 들어봅시다.");
    }),
    step(52_000, "낮 투표 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "vote",
        dayNumber: 1,
        nightNumber: 1,
        durationMs: VOTE_MS,
        publicLines: ["투표 시간입니다.", "처형 대상을 선택하세요."],
      });
    }),
    step(64_000, "최후의 반론", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "defense",
        dayNumber: 1,
        nightNumber: 1,
        durationMs: DEFENSE_MS,
        currentTrialTargetId: "politician",
        publicLines: ["정치연 님이 최후의 반론에 올라갔습니다."],
      });
    }),
    step(76_000, "찬반 투표", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "trial",
        dayNumber: 1,
        nightNumber: 1,
        durationMs: TRIAL_MS,
        currentTrialTargetId: "politician",
        publicLines: ["정치연 님을 처형할지 결정합니다."],
      });
    }),
    step(88_000, "2번째 밤 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "night",
        dayNumber: 1,
        nightNumber: 2,
        durationMs: NIGHT_MS,
        publicLines: ["2번째 밤입니다.", "정치연 님은 생존했습니다."],
      });
      appendChat(draft, "mafia", "ally-spy", "이번 밤에는 서준도윤 쪽으로 보겠습니다.");
    }),
    step(98_000, "2번째 밤 마피아 대화", (draft) => {
      appendChat(draft, "mafia", "ally-spy", "채팅 전송과 polling 갱신이 동시에 보이면 정상입니다.");
    }),
    step(116_000, "2번째 낮 토론 시작", (draft) => {
      killPlayer(draft, "doctor", "practice1 night scripted death");
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 2,
        nightNumber: 2,
        durationMs: DISCUSSION_MS,
        publicLines: ["2번째 낮이 시작되었습니다.", "서준도윤 님이 밤사이 사망했습니다."],
      });
      appendChat(draft, "public", "thug", "이제 남은 사람들 중심으로 정리해 봅시다.");
    }),
    step(128_000, "2번째 낮 공개 대화", (draft) => {
      appendChat(draft, "public", "reporter", "둘째 날 시점 공개 채팅 예시입니다.");
    }),
    step(144_000, "practice1 종료", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "ended",
        dayNumber: 2,
        nightNumber: 2,
        publicLines: ["practice1 종료", "마피아 시점 예시가 끝났습니다."],
      });
      appendPrivateLog(draft, PRACTICE_VIEWER_ID, "practice1: 시뮬레이션이 종료되었습니다.");
    }),
  ];
}

function seedPractice2(game: InternalGame): PracticeStep[] {
  seedPlayers(game, [
    makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "politician", true),
    makePlayer("mafia", "하린지수", "mafia", true),
    makePlayer("doctor", "서준", "doctor", true),
    makePlayer("citizen", "도윤서아", "citizen", true),
    makePlayer("reporter", "지호민서", "reporter", true),
    makePlayer("dead-citizen", "소연", "citizen", false, false, undefined, false, "practice2 seeded dead"),
  ]);

  runStep(game, () => {
    setPhaseSnapshot(game, {
      phase: "discussion",
      dayNumber: 1,
      nightNumber: 0,
      durationMs: DISCUSSION_MS,
      publicLines: ["practice2: 정치인 시점 연습이 시작되었습니다.", "공개 채팅만 보이고 비밀 채팅은 숨겨져야 합니다."],
    });
    appendChat(game, "public", "doctor", "정치인은 공개 채팅과 투표 흐름만 보면 됩니다.");
    appendChat(game, "mafia", "mafia", "이 대화는 정치인 화면에 보이면 안 됩니다.");
    appendPrivateLog(game, PRACTICE_VIEWER_ID, "practice2: 비밀 채팅 패널이 비어 있어야 정상입니다.");
  });

  return [
    step(10_000, "숨겨진 마피아 대화 추가", (draft) => {
      appendChat(draft, "mafia", "mafia", "낮에도 기록은 남지만 정치인에게는 계속 숨겨집니다.");
    }),
    step(24_000, "1번째 낮 투표 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "vote",
        dayNumber: 1,
        nightNumber: 0,
        durationMs: VOTE_MS,
        publicLines: ["투표 시간입니다.", "정치인은 일반 플레이어처럼 투표 UI 를 봅니다."],
      });
    }),
    step(36_000, "2번째 밤 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "night",
        dayNumber: 1,
        nightNumber: 1,
        durationMs: NIGHT_MS,
        publicLines: ["2번째 밤입니다.", "정치인에게는 비밀 채팅이 계속 노출되지 않습니다."],
      });
      appendChat(draft, "mafia", "mafia", "밤 마피아 대화도 정치인에게는 보이지 않습니다.");
      appendChat(draft, "graveyard", "dead-citizen", "망자 대화 역시 정치인에게는 보이지 않습니다.");
    }),
    step(64_000, "2번째 낮 토론 시작", (draft) => {
      killPlayer(draft, "doctor", "practice2 scripted death");
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 2,
        nightNumber: 1,
        durationMs: DISCUSSION_MS,
        publicLines: ["2번째 낮이 시작되었습니다.", "서준 님이 밤사이 사망했습니다."],
      });
      appendChat(draft, "public", "reporter", "둘째 날 공개 발언 예시입니다.");
    }),
    step(80_000, "2번째 낮 투표", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "vote",
        dayNumber: 2,
        nightNumber: 1,
        durationMs: VOTE_MS,
        publicLines: ["둘째 날 투표 시간입니다.", "정치인도 투표 셀렉트를 사용할 수 있습니다."],
      });
    }),
    step(92_000, "정치인 반론/찬반", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "trial",
        dayNumber: 2,
        nightNumber: 1,
        durationMs: TRIAL_MS,
        currentTrialTargetId: PRACTICE_VIEWER_ID,
        publicLines: ["민우 님을 처형할지 결정합니다."],
      });
    }),
    step(104_000, "정치인 생존 예시", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 2,
        nightNumber: 1,
        durationMs: DISCUSSION_MS,
        publicLines: ["정치인은 투표 처형되지 않습니다.", "다음 낮으로 이어지는 예시입니다."],
      });
      appendChat(draft, "public", "citizen", "정치인은 그대로 살아남았습니다.");
    }),
    step(128_000, "practice2 종료", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "ended",
        dayNumber: 2,
        nightNumber: 1,
        publicLines: ["practice2 종료", "정치인 시점 권한 예시가 끝났습니다."],
      });
    }),
  ];
}

function seedPractice3(game: InternalGame): PracticeStep[] {
  seedPlayers(game, [
    makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "medium", true),
    makePlayer("mafia", "하린", "mafia", true),
    makePlayer("priest", "예린지수", "priest", true),
    makePlayer("citizen", "도윤", "citizen", true),
    makePlayer("dead-citizen", "소연", "citizen", false, false, undefined, false, "practice3 seeded dead"),
    makePlayer("dead-doctor", "서준", "doctor", false, false, undefined, false, "practice3 seeded dead"),
  ]);

  runStep(game, () => {
    setPhaseSnapshot(game, {
      phase: "night",
      dayNumber: 0,
      nightNumber: 1,
      durationMs: NIGHT_MS,
      publicLines: ["practice3: 영매 시점 연습이 시작되었습니다.", "밤에는 망자 채팅이 열리고 영매도 읽고 쓸 수 있습니다."],
    });
    appendChat(game, "graveyard", "dead-citizen", "영매님, 제 직업이 궁금하신가요?");
    appendChat(game, "graveyard", "dead-doctor", "망자 채팅이 보이는지만 먼저 확인해 주세요.");
    appendPrivateLog(game, PRACTICE_VIEWER_ID, "practice3: 밤에는 망자 채팅 패널이 보여야 합니다.");
  });

  return [
    step(12_000, "망자 대화 추가", (draft) => {
      appendChat(draft, "graveyard", "dead-citizen", "몇 초 간격으로 NPC 대화가 추가됩니다.");
    }),
    step(28_000, "1번째 낮 토론 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 1,
        nightNumber: 1,
        durationMs: DISCUSSION_MS,
        publicLines: ["1번째 낮이 시작되었습니다.", "낮에는 영매에게 망자 채팅이 보이지 않습니다."],
      });
      appendChat(draft, "public", "priest", "낮에는 공개 채팅만 보이는 상태를 점검합니다.");
    }),
    step(52_000, "2번째 밤 시작", (draft) => {
      killPlayer(draft, "citizen", "practice3 scripted death");
      setPhaseSnapshot(draft, {
        phase: "night",
        dayNumber: 1,
        nightNumber: 2,
        durationMs: NIGHT_MS,
        publicLines: ["2번째 밤입니다.", "새 망자가 생겨 망자 채팅 내용이 늘어납니다."],
      });
      appendChat(draft, "graveyard", "citizen", "저도 방금 합류했습니다.");
      appendPrivateLog(draft, PRACTICE_VIEWER_ID, "practice3: 둘째 밤에는 새 망자가 추가됩니다.");
    }),
    step(80_000, "2번째 낮 토론 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 2,
        nightNumber: 2,
        durationMs: DISCUSSION_MS,
        publicLines: ["2번째 낮이 시작되었습니다.", "도윤 님이 밤사이 사망했습니다."],
      });
      appendChat(draft, "public", "mafia", "둘째 날 공개 채팅 예시입니다.");
    }),
    step(104_000, "practice3 종료", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "ended",
        dayNumber: 2,
        nightNumber: 2,
        publicLines: ["practice3 종료", "영매 시점 예시가 끝났습니다."],
      });
    }),
  ];
}

function seedPractice4(game: InternalGame): PracticeStep[] {
  seedPlayers(game, [
    makePlayer(PRACTICE_VIEWER_ID, PRACTICE_VIEWER_NAME, "citizen", false, false, undefined, false, "practice4 seeded dead"),
    makePlayer("mafia", "하린", "mafia", true),
    makePlayer("doctor", "서준지수", "doctor", true),
    makePlayer("lover-a", "연서", "lover", true, false, "lover-b"),
    makePlayer("lover-b", "도윤", "lover", true, false, "lover-a"),
    makePlayer("dead-citizen", "소연", "citizen", false, false, undefined, false, "practice4 seeded dead"),
  ]);

  runStep(game, () => {
    setPhaseSnapshot(game, {
      phase: "night",
      dayNumber: 0,
      nightNumber: 1,
      durationMs: NIGHT_MS,
      publicLines: ["practice4: 사망자 시점 연습이 시작되었습니다.", "죽은 상태에서는 밤에 망자 채팅만 쓸 수 있습니다."],
    });
    appendChat(game, "graveyard", "dead-citizen", "사망자끼리 밤에만 대화할 수 있습니다.");
    appendPrivateLog(game, PRACTICE_VIEWER_ID, "practice4: 현재는 사망 상태라 공개 채팅에 쓸 수 없습니다.");
  });

  return [
    step(10_000, "망자 대화 추가", (draft) => {
      appendChat(draft, "graveyard", "dead-citizen", "밤에는 이 채팅이 계속 열려 있습니다.");
    }),
    step(28_000, "1번째 낮 토론 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 1,
        nightNumber: 1,
        durationMs: DISCUSSION_MS,
        publicLines: ["1번째 낮이 시작되었습니다.", "사망자는 공개 채팅을 읽기만 할 수 있습니다."],
      });
      appendChat(draft, "public", "doctor", "낮에는 공개 채팅만 관전하게 됩니다.");
    }),
    step(52_000, "2번째 밤 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "night",
        dayNumber: 1,
        nightNumber: 2,
        durationMs: NIGHT_MS,
        publicLines: ["2번째 밤입니다.", "망자 채팅이 다시 열렸습니다."],
      });
      appendChat(draft, "graveyard", "dead-citizen", "둘째 밤에도 망자 채팅은 정상 동작합니다.");
    }),
    step(80_000, "2번째 낮 토론 시작", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "discussion",
        dayNumber: 2,
        nightNumber: 2,
        durationMs: DISCUSSION_MS,
        publicLines: ["2번째 낮이 시작되었습니다.", "사망자 시점 읽기 전용 예시가 이어집니다."],
      });
      appendChat(draft, "public", "lover-a", "둘째 날 공개 채팅 예시입니다.");
    }),
    step(104_000, "practice4 종료", (draft) => {
      setPhaseSnapshot(draft, {
        phase: "ended",
        dayNumber: 2,
        nightNumber: 2,
        publicLines: ["practice4 종료", "사망자 시점 예시가 끝났습니다."],
      });
    }),
  ];
}

function step(afterMs: number, label: string, run: (game: InternalGame) => void): PracticeStep {
  return { afterMs, label, run };
}

function runStep(game: InternalGame, run: (draft: InternalGame) => void): void {
  run(game);
  game.bumpStateVersion();
}

function seedPlayers(game: InternalGame, seeds: PracticePlayerSeed[]): void {
  game.players.clear();
  game.deadOrder.length = 0;
  game.loverPair = null;
  game.webChats.public.length = 0;
  game.webChats.mafia.length = 0;
  game.webChats.lover.length = 0;
  game.webChats.graveyard.length = 0;
  game.privateLogs.clear();

  for (const seed of seeds) {
    const player = seed;
    game.players.set(
      seed.userId,
      {
        userId: player.userId,
        displayName: player.displayName,
        role: player.role,
        originalRole: player.role,
        alive: player.alive ?? true,
        deadReason: player.alive === false ? player.deadReason ?? "연습 시나리오 사망" : undefined,
        isContacted: player.isContacted ?? false,
        loverId: player.loverId,
        ascended: player.ascended ?? false,
        soldierUsed: false,
        reporterUsed: false,
        priestUsed: false,
        terrorMarkId: undefined,
        voteLockedToday: false,
        timeAdjustUsedOnDay: null,
      } satisfies PlayerState,
    );

    if (seed.alive === false) {
      game.deadOrder.push(seed.userId);
    }
  }

  const lovers = seeds.filter((seed) => Boolean(seed.loverId)).map((seed) => seed.userId);
  if (lovers.length === 2) {
    game.loverPair = [lovers[0], lovers[1]];
  }
}

function setPhaseSnapshot(
  game: InternalGame,
  input: {
    phase: Phase;
    dayNumber: number;
    nightNumber: number;
    durationMs?: number;
    publicLines: string[];
    currentTrialTargetId?: string | null;
    bulliedIds?: string[];
    pendingArticle?: PendingArticle | null;
  },
): void {
  clearPhaseState(game);
  game.phase = input.phase;
  game.dayNumber = input.dayNumber;
  game.nightNumber = input.nightNumber;
  game.currentTrialTargetId = input.currentTrialTargetId ?? null;
  game.bulliedToday = new Set(input.bulliedIds ?? []);
  game.pendingArticle = input.pendingArticle ?? null;
  game.lastPublicLines = [...input.publicLines];

  if (input.phase === "ended") {
    game.phaseContext = null;
    return;
  }

  const now = Date.now();
  game.phaseContext = {
    token: (game.phaseContext?.token ?? 0) + 1,
    startedAt: now,
    deadlineAt: now + (input.durationMs ?? DISCUSSION_MS),
  };
}

function clearPhaseState(game: InternalGame): void {
  game.nightActions.clear();
  game.bonusNightActions.clear();
  game.spyBonusGrantedTonight.clear();
  game.dayVotes.clear();
  game.trialVotes.clear();
  game.pendingTrialBurns.clear();
  game.blockedTonightTargetId = null;
  game.pendingSeductionTargetId = null;
  game.bulliedToday = new Set<string>();
  game.bulliedNextDay = new Set<string>();
  game.currentTrialTargetId = null;
  game.pendingArticle = null;
  if (game.pendingAftermathChoice) {
    clearTimeout(game.pendingAftermathChoice.timeout);
    game.pendingAftermathChoice = null;
  }
}

function appendChat(game: InternalGame, channel: WebChatChannel, authorId: string, content: string): void {
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

function appendPrivateLog(game: InternalGame, userId: string, line: string): void {
  const entries = game.privateLogs.get(userId) ?? [];
  entries.push({
    id: makeId(),
    line,
    createdAt: Date.now(),
  });
  game.privateLogs.set(userId, entries);
}

function killPlayer(game: InternalGame, userId: string, reason: string): void {
  const player = game.getPlayerOrThrow(userId);
  if (!player.alive) {
    return;
  }

  player.alive = false;
  player.deadReason = reason;
  if (!game.deadOrder.includes(userId)) {
    game.deadOrder.push(userId);
  }
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
    user: { bot: false },
  } as GuildMember;
}
