import { Guild, GuildMember } from "discord.js";
import { GameManager } from "../game/game";
import { PlayerState, Role, Ruleset } from "../game/model";
import { DashboardAccessService } from "../web/access";
import { JoinTicketService } from "../web/join-ticket";
import { FixedBaseUrlProvider } from "../web/public-base-url";
import { SessionStore } from "../web/session-store";
import { DashboardServer } from "../web/server";

const PREVIEW_USER_ID = "dev-user";
const DEFAULT_PORT = 3010;

async function main(): Promise<void> {
  const port = readInteger("DEV_PREVIEW_PORT", DEFAULT_PORT);
  const ruleset = readRuleset(process.env.PREVIEW_RULESET ?? "balance");
  const phase = readPhase(process.env.PREVIEW_PHASE ?? "night");
  const role = readRole(process.env.PREVIEW_ROLE ?? "mafia");
  const previewBaseUrl = `http://localhost:${port}`;

  const manager = new GameManager();
  const guild = { id: "preview-guild" } as Guild;
  const host = createMember(PREVIEW_USER_ID, "개발자");
  const game = manager.create(guild, "preview-channel", host, ruleset);

  seedPreviewGame(game as any, role, phase);

  const joinTicketService = new JoinTicketService(process.env.JOIN_TICKET_SECRET ?? "preview-join-ticket-secret");
  const sessionStore = new SessionStore(process.env.WEB_SESSION_SECRET ?? "preview-web-session-secret");
  const dashboardAccess = new DashboardAccessService(
    new FixedBaseUrlProvider(previewBaseUrl),
    joinTicketService,
    5 * 60 * 1000,
  );
  const server = new DashboardServer({
    client: {} as never,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port,
    secureCookies: false,
  });

  await server.listen();
  const joinUrl = await dashboardAccess.issueJoinUrl(game.id, PREVIEW_USER_ID);

  console.log("");
  console.log("[web-preview] developer preview server is ready");
  console.log(`[web-preview] phase=${phase} role=${role} ruleset=${ruleset}`);
  console.log(`[web-preview] open: ${joinUrl}`);
  console.log("[web-preview] press Ctrl+C to stop");
  console.log("");

  const shutdown = async () => {
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

function seedPreviewGame(game: Record<string, any>, role: Role, phase: PreviewPhase): void {
  const now = Date.now();
  const players = buildPreviewPlayers(role, phase);

  game.players.clear();
  for (const player of players) {
    game.players.set(player.userId, player);
  }

  game.phase = phase;
  game.phaseContext = {
    token: 1,
    startedAt: now,
    deadlineAt: now + 5 * 60 * 1000,
  };
  game.nightNumber = phase === "night" ? 1 : 1;
  game.dayNumber = phase === "night" ? 0 : 1;
  game.lastPublicLines = [
    "개발자용 웹 대시보드 프리뷰 게임입니다.",
    phase === "night" ? "밤 행동과 비밀 채팅 UI를 미리 점검할 수 있습니다." : "낮 행동과 채팅 UI를 미리 점검할 수 있습니다.",
  ];

  if (phase === "defense" || phase === "trial") {
    game.currentTrialTargetId = PREVIEW_USER_ID;
  }

  if (phase === "vote") {
    game.dayVotes.set("npc-doctor", "npc-citizen");
  }

  if (phase === "trial") {
    game.trialVotes.set("npc-doctor", "yes");
  }

  if (phase === "night" && role === "reporter") {
    game.nightActions.set(PREVIEW_USER_ID, {
      actorId: PREVIEW_USER_ID,
      action: "reporterArticle",
      targetId: "npc-citizen",
      submittedAt: now,
    });
  }

  if (phase === "discussion" && role === "reporter") {
    game.pendingArticle = {
      actorId: PREVIEW_USER_ID,
      targetId: "npc-citizen",
      role: "citizen",
      publishFromDay: 1,
    };
  }

  if (phase === "night" && role === "mafia") {
    game.webChats.mafia.push({
      id: "mafia-chat-1",
      channel: "mafia",
      authorId: "npc-spy",
      authorName: "보조",
      content: "프리뷰용 마피아 채팅입니다.",
      createdAt: now - 30_000,
    });
  }

  if (phase === "night" && role === "lover") {
    game.webChats.lover.push({
      id: "lover-chat-1",
      channel: "lover",
      authorId: "npc-lover",
      authorName: "연인 상대",
      content: "프리뷰용 연인 채팅입니다.",
      createdAt: now - 30_000,
    });
  }

  if (phase === "night") {
    game.webChats.graveyard.push({
      id: "graveyard-chat-1",
      channel: "graveyard",
      authorId: "dead-citizen",
      authorName: "망자",
      content: "프리뷰용 망자 채팅입니다.",
      createdAt: now - 30_000,
    });
  }

  game.webChats.public.push({
    id: "public-chat-1",
    channel: "public",
    authorId: "npc-citizen",
    authorName: "시민A",
    content: "프리뷰용 공개 채팅입니다.",
    createdAt: now - 45_000,
  });

  game.appendPrivateLog(PREVIEW_USER_ID, `프리뷰 역할: ${role}`);
  game.appendPrivateLog(PREVIEW_USER_ID, `프리뷰 단계: ${phase}`);
}

function buildPreviewPlayers(role: Role, phase: PreviewPhase): PlayerState[] {
  const viewerAlive = !(role === "citizen" && phase === "night" && process.env.PREVIEW_DEAD_VIEW === "true");
  const players: PlayerState[] = [
    makePlayer(PREVIEW_USER_ID, "민우", role, viewerAlive),
    makePlayer("npc-citizen", "하린지수", "citizen", true),
    makePlayer("npc-doctor", "서준도윤하린별", "doctor", true),
    makePlayer("npc-spy", "하린지수민호도윤서아예나", "spy", true, true),
    makePlayer("dead-citizen", "사망닉네임예시", "citizen", false),
  ];

  if (role === "lover") {
    players[0].loverId = "npc-lover";
    players.push(makePlayer("npc-lover", "연인테스트이름", "lover", true, false, PREVIEW_USER_ID));
  }

  if (role !== "lover") {
    players.push(makePlayer("npc-thug", "도윤서아", "thug", true));
  }

  if (role === "medium") {
    players[0].alive = true;
  }

  if (phase === "night" && !players.some((player) => !player.alive)) {
    players.push(makePlayer("dead-extra", "열두글자테스트닉네임", "citizen", false));
  }

  return players;
}

function makePlayer(
  userId: string,
  displayName: string,
  role: Role,
  alive: boolean,
  isContacted = false,
  loverId?: string,
): PlayerState {
  return {
    userId,
    displayName,
    role,
    originalRole: role,
    alive,
    deadReason: alive ? undefined : "프리뷰 사망",
    isContacted,
    loverId,
    ascended: false,
    soldierUsed: false,
    reporterUsed: false,
    priestUsed: false,
    terrorMarkId: undefined,
    voteLockedToday: false,
    timeAdjustUsedOnDay: null,
  };
}

function createMember(id: string, displayName: string): GuildMember {
  return {
    id,
    displayName,
    user: { bot: false },
  } as GuildMember;
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

type PreviewPhase = "night" | "discussion" | "vote" | "defense" | "trial";

function readPhase(value: string): PreviewPhase {
  if (value === "night" || value === "discussion" || value === "vote" || value === "defense" || value === "trial") {
    return value;
  }

  throw new Error(`unsupported PREVIEW_PHASE: ${value}`);
}

function readRuleset(value: string): Ruleset {
  if (value === "initial" || value === "balance") {
    return value;
  }

  throw new Error(`unsupported PREVIEW_RULESET: ${value}`);
}

function readRole(value: string): Role {
  const allowed: Role[] = [
    "mafia",
    "spy",
    "beastman",
    "madam",
    "police",
    "doctor",
    "soldier",
    "politician",
    "medium",
    "lover",
    "thug",
    "reporter",
    "detective",
    "graverobber",
    "terrorist",
    "priest",
    "citizen",
  ];

  if (allowed.includes(value as Role)) {
    return value as Role;
  }

  throw new Error(`unsupported PREVIEW_ROLE: ${value}`);
}

void main().catch((error) => {
  console.error("[web-preview] failed to start", error);
  process.exit(1);
});
