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
  game: ReturnType<typeof createPracticeGame>["game"],
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

  const autoBotTimer = setInterval(() => {
    let changed = false;
    
    // NPC Chatter
    if ((game.phase === "discussion" || game.phase === "night") && Math.random() < 0.15) {
      const aliveBots = Array.from(game.players.values()).filter(p => p.alive && p.userId !== "practice-viewer");
      if (aliveBots.length > 0) {
        const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
        const channel = game.phase === "night" ? "mafia" : "public";
        // Only chat if bot has access
        if (game.canWriteChat(bot.userId, channel)) {
           const texts = ["음... 누굴까요?", "일단 지켜보죠.", "어젯밤에 별일 없었나요?", "투표합시다!", "저는 시민입니다.", "마피아는 누구?", "수상한 사람이 있네요."];
           const content = texts[Math.floor(Math.random() * texts.length)];
           game.sendChat(bot.userId, channel, content);
           changed = true;
        }
      }
    }

    if (game.phase === "vote") {
      const aliveBots = Array.from(game.players.values()).filter(p => p.alive && p.userId !== "practice-viewer" && !game.dayVotes.has(p.userId));
      if (aliveBots.length > 0) {
        const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
        const targets = Array.from(game.players.values()).filter(p => p.alive).map(p => p.userId);
        if (targets.length > 0) {
          const targetId = targets[Math.floor(Math.random() * targets.length)];
          game.dayVotes.set(bot.userId, targetId);
          (game as any).appendPublicActivityLog(`누군가가 ${game.getPlayerOrThrow(targetId).displayName} 님에게 투표했습니다.`);
          changed = true;
          console.log(`[web-practice] NPC ${bot.userId} -> voted ${targetId}`);
        }
      }
    } else if (game.phase === "trial" && game.currentTrialTargetId) {
      const aliveBots = Array.from(game.players.values()).filter(p => p.alive && p.userId !== "practice-viewer" && p.userId !== game.currentTrialTargetId && !game.trialVotes.has(p.userId));
      if (aliveBots.length > 0) {
        const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
        const vote = Math.random() < 0.6 ? "yes" : "no"; // Slightly biased towards yes for drama
        game.trialVotes.set(bot.userId, vote);
        (game as any).appendPublicActivityLog(vote === "yes" ? "누군가가 찬성에 투표했습니다." : "누군가가 반대에 투표했습니다.");
        changed = true;
        console.log(`[web-practice] NPC ${bot.userId} -> trial voted ${vote}`);
      }
    }

    if (changed) {
      game.bumpStateVersion();
    }
  }, 1800);

  handles.push(autoBotTimer);
  return handles;
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
