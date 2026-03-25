import { Client } from "discord.js";
import { GameManager } from "../game/game";
import { Ruleset } from "../game/model";
import {
  buildPracticeScenarioDefinitions,
  createPracticeGame,
  initializePracticeGame,
  PRACTICE_VIEWER_ID,
  PracticeScenarioDefinition,
} from "./practice-scenarios";
import { createPracticeClient } from "./practice-client";
import { DashboardAccessService } from "../web/access";
import { JoinTicketService } from "../web/join-ticket";
import { FixedBaseUrlProvider } from "../web/public-base-url";
import { SessionStore } from "../web/session-store";
import { DashboardServer } from "../web/server";

const DEFAULT_PORT = 3014;
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
  const practiceClient = createPracticeClient();
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
    client: practiceClient,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port,
    secureCookies: false,
  });

  await server.listen();
  await Promise.all(games.map(({ definition, game }) => initializePracticeGame(game, definition, practiceClient)));

  const runtimeHandles = games.flatMap(({ definition, game }) => startPracticeScenario(definition, game, practiceClient));
  const links = await Promise.all(
    games.map(async ({ definition, game }) => ({
      id: definition.id,
      title: definition.title,
      summary: definition.summary,
      url: await dashboardAccess.issueJoinUrl(game.id, PRACTICE_VIEWER_ID),
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
  console.log("[web-practice] scenarios now use the real game engine.");
  console.log("[web-practice] only the viewer stays manual; other players auto-act with random valid choices.");
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
  client: Client,
): NodeJS.Timeout[] {
  const handles: NodeJS.Timeout[] = [];
  let lastPhaseKey = currentPracticePhaseKey(game);
  let lastAftermathKey = currentAftermathKey(game);

  schedulePracticePhaseAutomation(definition.id, game, client, handles);
  schedulePracticeAftermath(definition.id, game, client, handles);

  handles.push(
    setInterval(() => {
      const nextPhaseKey = currentPracticePhaseKey(game);
      if (nextPhaseKey === lastPhaseKey) {
        return;
      }
      lastPhaseKey = nextPhaseKey;
      schedulePracticePhaseAutomation(definition.id, game, client, handles);
    }, 250),
  );

  handles.push(
    setInterval(() => {
      const nextAftermathKey = currentAftermathKey(game);
      if (nextAftermathKey === lastAftermathKey) {
        return;
      }
      lastAftermathKey = nextAftermathKey;
      schedulePracticeAftermath(definition.id, game, client, handles);
    }, 250),
  );

  return handles;
}

function currentPracticePhaseKey(game: PracticeGame): string {
  const token = game.phaseContext?.token ?? -1;
  return `${game.phase}:${token}:${game.currentTrialTargetId ?? ""}:${game.pendingArticle?.actorId ?? ""}`;
}

function currentAftermathKey(game: PracticeGame): string {
  const choice = game.pendingAftermathChoice;
  if (!choice) {
    return "";
  }
  return `${choice.token}:${choice.actorId}:${choice.action}`;
}

function schedulePracticePhaseAutomation(
  scenarioId: string,
  game: PracticeGame,
  client: Client,
  handles: NodeJS.Timeout[],
): void {
  if (game.phase === "ended" || !game.phaseContext) {
    return;
  }

  const token = game.phaseContext.token;

  if (game.phase === "night") {
    schedulePracticeNightActions(scenarioId, game, client, token, handles);
    schedulePracticeChats(scenarioId, game, token, handles);
    return;
  }

  if (game.phase === "discussion") {
    schedulePracticeDiscussionActions(scenarioId, game, client, token, handles);
    schedulePracticeChats(scenarioId, game, token, handles);
    return;
  }

  if (game.phase === "vote") {
    schedulePracticeVoteActions(scenarioId, game, client, token, handles);
    return;
  }

  if (game.phase === "defense") {
    schedulePracticeDefenseActions(scenarioId, game, client, token, handles);
    return;
  }

  if (game.phase === "trial") {
    schedulePracticeTrialVotes(scenarioId, game, client, token, handles);
  }
}

function schedulePracticeNightActions(
  scenarioId: string,
  game: PracticeGame,
  client: Client,
  token: number,
  handles: NodeJS.Timeout[],
): void {
  const actors = shuffle(
    Array.from(game.players.values()).filter((player) => player.alive && player.userId !== PRACTICE_VIEWER_ID),
  );
  if (actors.length === 0) {
    return;
  }

  const delays = buildSortedRandomDelays(actors.length, resolvePhaseWindowMs(game, 1_400, 8_500));
  actors.forEach((player, index) => {
    schedulePracticeAction(
      handles,
      delays[index],
      () => game.phase === "night" && game.phaseContext?.token === token,
      async () => {
        const prompt = game.getNightPromptForPlayer(player.userId);
        if (!prompt || game.nightActions.has(player.userId)) {
          return;
        }

        const targetId = pickAutomatedTarget(game, player.userId, prompt.action, prompt.targets);
        if (!targetId) {
          return;
        }

        await game.submitNightSelection(client, {
          kind: "night",
          actorId: player.userId,
          action: prompt.action,
          targetId,
          token,
        });
        console.log(`[web-practice] ${scenarioId} npc ${player.userId} -> ${prompt.action} ${targetId}`);
      },
    );
  });
}

function schedulePracticeDiscussionActions(
  scenarioId: string,
  game: PracticeGame,
  client: Client,
  token: number,
  handles: NodeJS.Timeout[],
): void {
  const timeActors = shuffle(
    Array.from(game.players.values()).filter(
      (player) =>
        player.alive &&
        player.userId !== PRACTICE_VIEWER_ID &&
        player.timeAdjustUsedOnDay !== game.dayNumber,
    ),
  );
  const timeActor = timeActors[0];
  if (timeActor && Math.random() < 0.45) {
    schedulePracticeAction(
      handles,
      1_400 + Math.floor(Math.random() * 4_000),
      () => game.phase === "discussion" && game.phaseContext?.token === token && timeActor.timeAdjustUsedOnDay !== game.dayNumber,
      async () => {
        const direction = Math.random() < 0.5 ? "add" : "cut";
        await game.adjustDiscussionTime(client, timeActor.userId, direction, token);
        console.log(`[web-practice] ${scenarioId} npc ${timeActor.userId} -> time ${direction}`);
      },
    );
  }

  const pendingArticle = game.pendingArticle;
  if (pendingArticle && pendingArticle.actorId !== PRACTICE_VIEWER_ID && game.dayNumber >= pendingArticle.publishFromDay) {
    schedulePracticeAction(
      handles,
      2_000 + Math.floor(Math.random() * 4_000),
      () =>
        game.phase === "discussion" &&
        game.phaseContext?.token === token &&
        Boolean(game.pendingArticle) &&
        game.pendingArticle?.actorId === pendingArticle.actorId &&
        game.dayNumber >= (game.pendingArticle?.publishFromDay ?? Number.MAX_SAFE_INTEGER),
      async () => {
        await game.publishReporterArticle(client, pendingArticle.actorId);
        console.log(`[web-practice] ${scenarioId} npc ${pendingArticle.actorId} -> reporter_publish`);
      },
    );
  }
}

function schedulePracticeVoteActions(
  scenarioId: string,
  game: PracticeGame,
  client: Client,
  token: number,
  handles: NodeJS.Timeout[],
): void {
  const madam = Array.from(game.players.values()).find(
    (player) =>
      player.alive &&
      player.userId !== PRACTICE_VIEWER_ID &&
      player.role === "madam" &&
      !game.pendingSeductionTargetId,
  );
  if (madam) {
    const targets = game.alivePlayers.filter((player) => player.userId !== madam.userId).map((player) => player.userId);
    const targetId = pickRandom(targets);
    if (targetId) {
      schedulePracticeAction(
        handles,
        1_200 + Math.floor(Math.random() * 2_000),
        () => game.phase === "vote" && game.phaseContext?.token === token && !game.pendingSeductionTargetId,
        async () => {
          await game.submitNightSelection(client, {
            kind: "madam",
            actorId: madam.userId,
            action: "select",
            targetId,
            token,
          });
          console.log(`[web-practice] ${scenarioId} npc ${madam.userId} -> madam ${targetId}`);
        },
      );
    }
  }

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

  const delays = buildSortedRandomDelays(voters.length, resolvePhaseWindowMs(game, 1_500, 7_500));
  voters.forEach((player, index) => {
    schedulePracticeAction(
      handles,
      delays[index],
      () => game.phase === "vote" && game.phaseContext?.token === token,
      async () => {
        if (game.dayVotes.has(player.userId) || game.bulliedToday.has(player.userId)) {
          return;
        }
        const targetId = pickAutomatedVoteTarget(game, player.userId);
        if (!targetId) {
          return;
        }
        await game.submitVote(client, player.userId, targetId, token);
        console.log(`[web-practice] ${scenarioId} npc ${player.userId} -> vote ${targetId}`);
      },
    );
  });
}

function schedulePracticeDefenseActions(
  scenarioId: string,
  game: PracticeGame,
  client: Client,
  token: number,
  handles: NodeJS.Timeout[],
): void {
  const targetId = game.currentTrialTargetId;
  if (!targetId) {
    return;
  }
  const target = game.getPlayer(targetId);
  if (!target || !target.alive || target.userId === PRACTICE_VIEWER_ID || target.role !== "terrorist") {
    return;
  }

  const choices = game.alivePlayers.filter((player) => player.userId !== target.userId).map((player) => player.userId);
  const burnTargetId = pickRandom(choices);
  if (!burnTargetId) {
    return;
  }

  schedulePracticeAction(
    handles,
    1_000 + Math.floor(Math.random() * 3_000),
    () => game.phase === "defense" && game.phaseContext?.token === token && !game.pendingTrialBurns.has(target.userId),
    async () => {
      await game.submitNightSelection(client, {
        kind: "terror",
        actorId: target.userId,
        action: "burn",
        targetId: burnTargetId,
        token,
      });
      console.log(`[web-practice] ${scenarioId} npc ${target.userId} -> terror ${burnTargetId}`);
    },
  );
}

function schedulePracticeTrialVotes(
  scenarioId: string,
  game: PracticeGame,
  client: Client,
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

  const delays = buildSortedRandomDelays(voters.length, resolvePhaseWindowMs(game, 1_200, 7_500));
  voters.forEach((player, index) => {
    schedulePracticeAction(
      handles,
      delays[index],
      () => game.phase === "trial" && game.phaseContext?.token === token,
      async () => {
        if (game.trialVotes.has(player.userId) || game.bulliedToday.has(player.userId)) {
          return;
        }
        const vote = Math.random() < 0.6 ? "yes" : "no";
        await game.submitTrialVote(client, player.userId, vote, token);
        console.log(`[web-practice] ${scenarioId} npc ${player.userId} -> trial ${vote}`);
      },
    );
  });
}

function schedulePracticeAftermath(
  scenarioId: string,
  game: PracticeGame,
  client: Client,
  handles: NodeJS.Timeout[],
): void {
  const choice = game.pendingAftermathChoice;
  if (!choice || choice.actorId === PRACTICE_VIEWER_ID) {
    return;
  }

  const targetId = pickRandom(choice.targetIds);
  if (!targetId) {
    return;
  }

  schedulePracticeAction(
    handles,
    1_000 + Math.floor(Math.random() * 2_500),
    () =>
      Boolean(game.pendingAftermathChoice) &&
      game.pendingAftermathChoice?.token === choice.token &&
      game.pendingAftermathChoice?.actorId === choice.actorId,
    async () => {
      await game.submitNightSelection(client, {
        kind: "aftermath",
        actorId: choice.actorId,
        action: choice.action,
        targetId,
        token: choice.token,
      });
      console.log(`[web-practice] ${scenarioId} npc ${choice.actorId} -> aftermath ${choice.action} ${targetId}`);
    },
  );
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
      schedulePracticeAction(
        handles,
        delays[index],
        () => game.phaseContext?.token === token && game.canWriteChat(speakerId, plan.channel),
        () => {
          game.sendChat(speakerId, plan.channel, content);
          console.log(`[web-practice] ${scenarioId} npc ${speakerId} -> chat ${plan.channel}`);
        },
      );
    });
  });
}

function schedulePracticeAction(
  handles: NodeJS.Timeout[],
  delayMs: number,
  shouldRun: () => boolean,
  run: () => Promise<void> | void,
): void {
  handles.push(
    setTimeout(() => {
      if (!shouldRun()) {
        return;
      }

      Promise.resolve(run()).catch((error) => {
        console.error("[web-practice] npc action failed", error);
      });
    }, delayMs),
  );
}

function pickAutomatedTarget(
  game: PracticeGame,
  actorId: string,
  action: string,
  targets: string[],
): string | null {
  let candidates = [...targets];
  if (candidates.length === 0) {
    return null;
  }

  if (action !== "doctorProtect") {
    const withoutSelf = candidates.filter((targetId) => targetId !== actorId);
    if (withoutSelf.length > 0) {
      candidates = withoutSelf;
    }
  }

  if (action === "mafiaKill" || action === "beastKill") {
    const nonMafia = candidates.filter((targetId) => {
      const player = game.getPlayer(targetId);
      return player && player.role !== "mafia" && player.role !== "spy" && player.role !== "beastman" && player.role !== "madam";
    });
    if (nonMafia.length > 0) {
      candidates = nonMafia;
    }
  }

  return pickRandom(candidates);
}

function pickAutomatedVoteTarget(game: PracticeGame, actorId: string): string | null {
  let candidates = game.alivePlayers.filter((player) => player.userId !== actorId).map((player) => player.userId);
  if (candidates.length === 0) {
    candidates = game.alivePlayers.map((player) => player.userId);
  }
  return pickRandom(candidates);
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) {
    return null;
  }
  return items[Math.floor(Math.random() * items.length)];
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
