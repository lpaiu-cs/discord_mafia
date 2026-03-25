import { GameManager } from "../game/game";
import { Ruleset } from "../game/model";
import {
  buildPracticeScenarioDefinitions,
  createPracticeGame,
  PracticeScenarioDefinition,
  PracticeStep,
} from "./practice-scenarios";
import { DashboardAccessService } from "../web/access";
import { JoinTicketService } from "../web/join-ticket";
import { FixedBaseUrlProvider } from "../web/public-base-url";
import { SessionStore } from "../web/session-store";
import { DashboardServer } from "../web/server";

const DEFAULT_PORT = 3014;
const PRACTICE_VIEWER_ID = "practice-viewer";
const PUBLIC_CHAT_LINES = [
  "일단 발언을 더 들어봅시다.",
  "저는 아직 판단을 보류하겠습니다.",
  "수상한 사람이 한 명 보이긴 합니다.",
  "근거를 조금 더 말해 주세요.",
  "투표 전에 정리해 봅시다.",
];
const MAFIA_CHAT_LINES = [
  "밤에는 조용히 맞춰 봅시다.",
  "다음 낮 반응을 먼저 보죠.",
  "겉으로는 시민처럼 움직이겠습니다.",
  "이번엔 무리하지 말고 넘어가죠.",
];
const GRAVEYARD_CHAT_LINES = [
  "망자 채팅은 이렇게 이어집니다.",
  "밤에만 열리는 채널이 맞습니다.",
  "새로 온 사람 있으면 말해 주세요.",
];

type PracticeGame = ReturnType<typeof createPracticeGame>["game"];

async function main(): Promise<void> {
  const port = readInteger("DEV_PRACTICE_PORT", DEFAULT_PORT);
  const ruleset = readRuleset(process.env.PRACTICE_RULESET ?? "balance");
  const practiceBaseUrl = `http://localhost:${port}`;

  const manager = new GameManager();
  const definitions = selectPracticeScenarios(buildPracticeScenarioDefinitions(), process.env.PRACTICE_SCENARIO ?? "practice1");
  const games = definitions.map((definition) => ({
    definition,
    ...createPracticeGame(manager, definition, ruleset),
  }));

  const joinTicketService = new JoinTicketService(process.env.JOIN_TICKET_SECRET ?? "practice-join-ticket-secret");
  const sessionStore = new SessionStore(process.env.WEB_SESSION_SECRET ?? "practice-web-session-secret");
  const dashboardAccess = new DashboardAccessService(
    new FixedBaseUrlProvider(practiceBaseUrl),
    joinTicketService,
    5 * 60 * 1000,
  );
  const server = new DashboardServer({
    client: {} as never,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port,
  });

  await server.listen();

  const runtimeHandles = games.flatMap(({ definition, game, steps }) => startPracticeScenario(definition, game, steps));
  const links = await Promise.all(
    games.map(async ({ definition, game }) => ({
      id: definition.id,
      title: definition.title,
      summary: definition.summary,
      url: await dashboardAccess.issueJoinUrl(game.id, "practice-viewer"),
    })),
  );

  console.log("");
  console.log("[web-practice] practice server is ready");
  console.log(`[web-practice] ruleset=${ruleset} port=${port}`);
  console.log(`[web-practice] selected=${definitions.map((definition) => definition.id).join(", ")}`);
  console.log("[web-practice] open the URLs below. each scenario keeps a separate per-game session cookie.");
  for (const link of links) {
    console.log("");
    console.log(`[web-practice] ${link.title}`);
    console.log(`[web-practice] ${link.summary}`);
    console.log(`[web-practice] open: ${link.url}`);
  }
  console.log("");
  console.log("[web-practice] scenarios auto-play for about two in-game days.");
  console.log("[web-practice] you can still send chat and submit actions while the scripted timeline runs.");
  console.log("[web-practice] press Ctrl+C to stop");
  console.log("");

  const shutdown = async () => {
    for (const handle of runtimeHandles) {
      clearTimeout(handle);
    }
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

function startPracticeScenario(
  definition: PracticeScenarioDefinition,
  game: PracticeGame,
  steps: PracticeStep[],
): NodeJS.Timeout[] {
  const handles = steps.map((step) =>
    setTimeout(() => {
      try {
        step.run(game);
        game.bumpStateVersion();
        console.log(`[web-practice] ${definition.id} -> ${step.label}`);
      } catch (error) {
        console.error(`[web-practice] ${definition.id} step failed`, error);
      }
    }, step.afterMs),
  );

  let lastPhaseKey = currentPracticePhaseKey(game);
  schedulePracticeBots(definition.id, game, handles);

  const phaseWatcher = setInterval(() => {
    const nextPhaseKey = currentPracticePhaseKey(game);
    if (nextPhaseKey === lastPhaseKey) {
      return;
    }
    lastPhaseKey = nextPhaseKey;
    schedulePracticeBots(definition.id, game, handles);
  }, 400);

  handles.push(phaseWatcher);
  return handles;
}

function currentPracticePhaseKey(game: PracticeGame): string {
  const token = game.phaseContext?.token ?? -1;
  return `${game.phase}:${token}:${game.currentTrialTargetId ?? ""}`;
}

function schedulePracticeBots(
  scenarioId: string,
  game: PracticeGame,
  handles: NodeJS.Timeout[],
): void {
  const phase = game.phase;
  const token = game.phaseContext?.token ?? -1;
  if (phase === "ended") {
    return;
  }

  if (phase === "vote") {
    schedulePracticeVotes(scenarioId, game, token, handles);
    return;
  }

  if (phase === "trial") {
    schedulePracticeTrialVotes(scenarioId, game, token, handles);
    return;
  }

  if (phase === "discussion" || phase === "night") {
    schedulePracticeChats(scenarioId, game, token, handles);
  }
}

function schedulePracticeVotes(
  scenarioId: string,
  game: PracticeGame,
  token: number,
  handles: NodeJS.Timeout[],
): void {
  const voters = shuffle(
    Array.from(game.players.values()).filter(
      (player) =>
        player.alive &&
        player.userId !== PRACTICE_VIEWER_ID &&
        !game.bulliedToday.has(player.userId) &&
        !game.dayVotes.has(player.userId),
    ),
  );
  if (voters.length === 0) {
    return;
  }

  const delays = buildSortedRandomDelays(voters.length, resolvePhaseWindowMs(game, 1_200, 8_000));
  voters.forEach((player, index) => {
    scheduleGuardedPracticeAction(game, handles, "vote", token, delays[index], () => {
      if (game.dayVotes.has(player.userId)) {
        return;
      }
      const targets = shuffle(
        Array.from(game.players.values())
          .filter((candidate) => candidate.alive && candidate.userId !== player.userId)
          .map((candidate) => candidate.userId),
      );
      const targetId = targets[0] ?? player.userId;
      game.dayVotes.set(player.userId, targetId);
      (game as any).appendPublicActivityLog(`누군가가 ${game.getPlayerOrThrow(targetId).displayName} 님에게 투표했습니다.`);
      console.log(`[web-practice] ${scenarioId} npc ${player.userId} -> vote ${targetId}`);
    });
  });
}

function schedulePracticeTrialVotes(
  scenarioId: string,
  game: PracticeGame,
  token: number,
  handles: NodeJS.Timeout[],
): void {
  const voters = shuffle(
    Array.from(game.players.values()).filter(
      (player) =>
        player.alive &&
        player.userId !== PRACTICE_VIEWER_ID &&
        player.userId !== game.currentTrialTargetId &&
        !game.bulliedToday.has(player.userId) &&
        !game.trialVotes.has(player.userId),
    ),
  );
  if (voters.length === 0) {
    return;
  }

  const delays = buildSortedRandomDelays(voters.length, resolvePhaseWindowMs(game, 1_200, 8_000));
  voters.forEach((player, index) => {
    scheduleGuardedPracticeAction(game, handles, "trial", token, delays[index], () => {
      if (game.trialVotes.has(player.userId)) {
        return;
      }
      const vote = Math.random() < 0.6 ? "yes" : "no";
      game.trialVotes.set(player.userId, vote);
      (game as any).appendPublicActivityLog(vote === "yes" ? "누군가가 찬성에 투표했습니다." : "누군가가 반대에 투표했습니다.");
      console.log(`[web-practice] ${scenarioId} npc ${player.userId} -> trial ${vote}`);
    });
  });
}

function schedulePracticeChats(
  scenarioId: string,
  game: PracticeGame,
  token: number,
  handles: NodeJS.Timeout[],
): void {
  const plans: { channel: "public" | "mafia" | "graveyard"; speakers: string[]; lines: string[] }[] = [];

  if (game.phase === "discussion") {
    const speakers = Array.from(game.players.values())
      .filter((player) => player.alive && player.userId !== PRACTICE_VIEWER_ID && game.canWriteChat(player.userId, "public"))
      .map((player) => player.userId);
    if (speakers.length > 0) {
      plans.push({ channel: "public", speakers, lines: PUBLIC_CHAT_LINES });
    }
  }

  if (game.phase === "night") {
    const mafiaSpeakers = Array.from(game.players.values())
      .filter((player) => player.userId !== PRACTICE_VIEWER_ID && game.canWriteChat(player.userId, "mafia"))
      .map((player) => player.userId);
    if (mafiaSpeakers.length > 0) {
      plans.push({ channel: "mafia", speakers: mafiaSpeakers, lines: MAFIA_CHAT_LINES });
    }

    const graveyardSpeakers = Array.from(game.players.values())
      .filter((player) => player.userId !== PRACTICE_VIEWER_ID && game.canWriteChat(player.userId, "graveyard"))
      .map((player) => player.userId);
    if (graveyardSpeakers.length > 0) {
      plans.push({ channel: "graveyard", speakers: graveyardSpeakers, lines: GRAVEYARD_CHAT_LINES });
    }
  }

  plans.forEach((plan) => {
    const maxMessages = Math.min(plan.speakers.length, plan.channel === "public" ? 2 : 1);
    if (maxMessages <= 0) {
      return;
    }
    const speakers = shuffle([...plan.speakers]).slice(0, maxMessages);
    const delays = buildSortedRandomDelays(maxMessages, resolvePhaseWindowMs(game, 900, 6_000));
    speakers.forEach((speakerId, index) => {
      const content = plan.lines[Math.floor(Math.random() * plan.lines.length)];
      scheduleGuardedPracticeAction(game, handles, game.phase, token, delays[index], () => {
        if (!game.canWriteChat(speakerId, plan.channel)) {
          return;
        }
        game.sendChat(speakerId, plan.channel, content);
        console.log(`[web-practice] ${scenarioId} npc ${speakerId} -> chat ${plan.channel}`);
      });
    });
  });
}

function scheduleGuardedPracticeAction(
  game: PracticeGame,
  handles: NodeJS.Timeout[],
  phase: PracticeGame["phase"],
  token: number,
  delayMs: number,
  run: () => void,
): void {
  handles.push(
    setTimeout(() => {
      if (game.phase !== phase || (game.phaseContext?.token ?? -1) !== token) {
        return;
      }
      try {
        run();
      } catch (error) {
        console.error("[web-practice] npc action failed", error);
      }
    }, delayMs),
  );
}

function resolvePhaseWindowMs(game: PracticeGame, minimumMs: number, maximumMs: number): number {
  const deadlineAt = game.phaseContext?.deadlineAt ?? Date.now() + maximumMs;
  const remaining = Math.max(0, deadlineAt - Date.now() - 900);
  return Math.max(minimumMs, Math.min(maximumMs, remaining));
}

function buildSortedRandomDelays(count: number, maxWindowMs: number): number[] {
  const upperBound = Math.max(1_000, maxWindowMs);
  const delays = Array.from({ length: count }, () => 600 + Math.floor(Math.random() * upperBound));
  delays.sort((left, right) => left - right);
  return delays;
}

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be an integer`);
  }

  return value;
}

function readRuleset(value: string): Ruleset {
  if (value === "initial" || value === "balance") {
    return value;
  }

  throw new Error(`unsupported PRACTICE_RULESET: ${value}`);
}

function selectPracticeScenarios(
  definitions: PracticeScenarioDefinition[],
  rawSelection: string,
): PracticeScenarioDefinition[] {
  if (rawSelection === "all") {
    return definitions;
  }

  const selected = definitions.find((definition) => definition.id === rawSelection);
  if (!selected) {
    throw new Error(`unsupported PRACTICE_SCENARIO: ${rawSelection}`);
  }

  return [selected];
}

void main().catch((error) => {
  console.error("[web-practice] failed to start", error);
  process.exit(1);
});
