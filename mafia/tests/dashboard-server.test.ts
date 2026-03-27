import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client, Guild, GuildMember } from "discord.js";
import { WebSocket } from "ws";
import { GameStatsStore } from "../src/db/game-stats-store";
import { PlayerDashboardStats } from "../src/db/player-dashboard-stats";
import { EnsureUserProfileInput, UserProfile } from "../src/db/user-profile";
import { GameRegistry, InMemoryGameRegistry } from "../src/game/game";
import { JoinTicketService } from "../src/web/join-ticket";
import { SessionStore, InMemorySessionStore } from "../src/web/session-store";
import { DashboardServer } from "../src/web/server";

function createMember(id: string, displayName: string): GuildMember {
  return {
    id,
    displayName,
    user: { bot: false },
  } as GuildMember;
}

class FakeGameStatsStore implements GameStatsStore {
  readonly enabled = true;
  readonly ensuredProfiles: EnsureUserProfileInput[] = [];

  constructor(private readonly stats: PlayerDashboardStats | null) {}

  async initialize(): Promise<void> {
    return;
  }

  async ensureUserProfile(profile: EnsureUserProfileInput): Promise<void> {
    this.ensuredProfiles.push(profile);
  }

  async getUserProfile(discordUserId: string): Promise<UserProfile | null> {
    const profile = this.ensuredProfiles.find((entry) => entry.discordUserId === discordUserId);
    if (!profile) {
      return null;
    }

    const now = new Date();
    return {
      discordUserId: profile.discordUserId,
      latestDisplayName: profile.displayName,
      latestGuildId: profile.discordGuildId ?? null,
      latestGuildName: profile.guildName ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastPlayedAt: null,
    };
  }

  async recordEndedGame(): Promise<void> {
    return;
  }

  async getPlayerDashboardStats(): Promise<PlayerDashboardStats | null> {
    return this.stats;
  }

  async close(): Promise<void> {
    return;
  }
}

test("URL exchange 는 세션 쿠키를 발급하고 polling/chat API 와 연동된다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const guild = { id: "guild-1" } as Guild;
  const host = createMember("user-1", "host");
  const game = manager.create(guild, "channel-1", host, "balance");
  game.phase = "discussion";
  game.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };

  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: true,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const ticket = joinTicketService.issue({
    gameId: game.id,
    discordUserId: "user-1",
    ttlMs: 180_000,
  });

  const exchangeResponse = await fetch(`http://127.0.0.1:${port}/auth/exchange?ticket=${encodeURIComponent(ticket)}`, {
    redirect: "manual",
  });
  const setCookie = exchangeResponse.headers.get("set-cookie");

  assert.equal(exchangeResponse.status, 302);
  assert.match(setCookie ?? "", /HttpOnly/);
  assert.match(setCookie ?? "", /Secure/);
  assert.match(setCookie ?? "", /SameSite=Lax/);

  const cookieHeader = (setCookie ?? "").split(";")[0];
  const stateResponse = await fetch(`http://127.0.0.1:${port}/api/game/${encodeURIComponent(game.id)}/state`, {
    headers: {
      Cookie: cookieHeader,
    },
  });
  const initialState = await stateResponse.json();

  assert.equal(initialState.changed, true);
  const sinceVersion = initialState.version;

  const signedCookieValue = cookieHeader.split("=")[1];
  const sessionId = sessionStore.parseCookieValue(decodeURIComponent(signedCookieValue));
  const session = sessionStore.get(sessionId!);
  assert.ok(session);

  const chatResponse = await fetch(`http://127.0.0.1:${port}/api/game/${encodeURIComponent(game.id)}/chats/public`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "content-type": "application/json",
      "x-csrf-token": session!.csrfToken,
    },
    body: JSON.stringify({ content: "안녕하세요" }),
  });

  assert.equal(chatResponse.status, 200);

  const updatedStateResponse = await fetch(
    `http://127.0.0.1:${port}/api/game/${encodeURIComponent(game.id)}/state?sinceVersion=${encodeURIComponent(String(sinceVersion))}`,
    {
      headers: {
        Cookie: cookieHeader,
      },
    },
  );
  const updatedState = await updatedStateResponse.json();

  assert.equal(updatedState.changed, true);
  assert.equal(updatedState.state.publicChat.messages.at(-1).content, "안녕하세요");
});

test("브라우저는 서로 다른 게임 세션 쿠키를 동시에 유지할 수 있다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const host = createMember("user-1", "host");
  const gameA = manager.create({ id: "guild-a" } as Guild, "channel-a", host, "balance");
  const gameB = manager.create({ id: "guild-b" } as Guild, "channel-b", host, "balance");

  gameA.phase = "discussion";
  gameA.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };
  gameB.phase = "night";
  gameB.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };

  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: true,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const ticketA = joinTicketService.issue({
    gameId: gameA.id,
    discordUserId: "user-1",
    ttlMs: 180_000,
  });
  const ticketB = joinTicketService.issue({
    gameId: gameB.id,
    discordUserId: "user-1",
    ttlMs: 180_000,
  });

  const exchangeA = await fetch(`http://127.0.0.1:${port}/auth/exchange?ticket=${encodeURIComponent(ticketA)}`, {
    redirect: "manual",
  });
  const exchangeB = await fetch(`http://127.0.0.1:${port}/auth/exchange?ticket=${encodeURIComponent(ticketB)}`, {
    redirect: "manual",
  });

  const cookieA = (exchangeA.headers.get("set-cookie") ?? "").split(";")[0];
  const cookieB = (exchangeB.headers.get("set-cookie") ?? "").split(";")[0];

  assert.match(cookieA, /^mafia_session_/);
  assert.match(cookieB, /^mafia_session_/);
  assert.notEqual(cookieA.split("=")[0], cookieB.split("=")[0]);

  const mergedCookieHeader = `${cookieA}; ${cookieB}`;

  const stateAResponse = await fetch(`http://127.0.0.1:${port}/api/game/${encodeURIComponent(gameA.id)}/state`, {
    headers: {
      Cookie: mergedCookieHeader,
    },
  });
  const stateBResponse = await fetch(`http://127.0.0.1:${port}/api/game/${encodeURIComponent(gameB.id)}/state`, {
    headers: {
      Cookie: mergedCookieHeader,
    },
  });

  const stateA = await stateAResponse.json();
  const stateB = await stateBResponse.json();

  assert.equal(stateA.changed, true);
  assert.equal(stateA.state.room.gameId, gameA.id);
  assert.equal(stateB.changed, true);
  assert.equal(stateB.state.room.gameId, gameB.id);
});

test("개인 전적이 있으면 대시보드 상태 payload 에 포함된다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const guild = { id: "guild-1" } as Guild;
  const host = createMember("user-1", "host");
  const game = manager.create(guild, "channel-1", host, "balance");
  game.phase = "discussion";
  game.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };

  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const gameStatsStore = new FakeGameStatsStore({
    discordUserId: "user-1",
    latestDisplayName: "host",
    lifetime: {
      matchesPlayed: 12,
      wins: 7,
      losses: 5,
      mafiaWins: 4,
      citizenWins: 3,
    },
    roleStats: [
      {
        role: "mafia",
        plays: 5,
        wins: 4,
        losses: 1,
      },
    ],
    recentMatches: [
      {
        externalGameId: "match-1",
        guildName: "테스트 서버",
        ruleset: "balance",
        status: "completed",
        winnerTeam: "mafia",
        endedReason: "마피아팀 승리",
        playerCount: 6,
        endedAt: new Date("2026-03-27T01:00:00.000Z"),
        originalRole: "mafia",
        finalRole: "mafia",
        team: "mafia",
        isWinner: true,
        survived: true,
        deathReason: null,
      },
    ],
  });
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    gameStatsStore,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: false,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const ticket = joinTicketService.issue({
    gameId: game.id,
    discordUserId: "user-1",
    ttlMs: 180_000,
  });

  const exchangeResponse = await fetch(`http://127.0.0.1:${port}/auth/exchange?ticket=${encodeURIComponent(ticket)}`, {
    redirect: "manual",
  });
  const cookieHeader = (exchangeResponse.headers.get("set-cookie") ?? "").split(";")[0];
  const stateResponse = await fetch(`http://127.0.0.1:${port}/api/game/${encodeURIComponent(game.id)}/state`, {
    headers: {
      Cookie: cookieHeader,
    },
  });
  const payload = await stateResponse.json();

  assert.equal(payload.changed, true);
  assert.equal(payload.state.personalStats.enabled, true);
  assert.equal(payload.state.personalStats.summary.matchesPlayed, 12);
  assert.equal(payload.state.personalStats.summary.winRatePercent, 58);
  assert.equal(payload.state.personalStats.roleStats[0].roleLabel, "마피아");
  assert.equal(payload.state.personalStats.recentMatches[0].resultLabel, "승리");
  assert.equal(payload.state.personalStats.recentMatches[0].guildName, "테스트 서버");
});

test("URL exchange 는 유저 프로필을 business DB 에 보장한다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const guild = { id: "guild-1", name: "테스트 길드" } as Guild;
  const host = createMember("user-1", "host");
  const game = manager.create(guild, "channel-1", host, "balance");

  game.phase = "discussion";
  game.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };

  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const gameStatsStore = new FakeGameStatsStore(null);
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    gameStatsStore,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: false,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const ticket = joinTicketService.issue({
    gameId: game.id,
    discordUserId: "user-1",
    ttlMs: 180_000,
  });

  const exchangeResponse = await fetch(`http://127.0.0.1:${port}/auth/exchange?ticket=${encodeURIComponent(ticket)}`, {
    redirect: "manual",
  });

  assert.equal(exchangeResponse.status, 302);
  assert.deepEqual(gameStatsStore.ensuredProfiles, [
    {
      discordUserId: "user-1",
      displayName: "host",
      discordGuildId: "guild-1",
      guildName: "테스트 길드",
    },
  ]);
});

test("로컬 HTTP 프리뷰에서는 세션 쿠키에 Secure 를 붙이지 않는다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const guild = { id: "guild-1" } as Guild;
  const host = createMember("user-1", "host");
  const game = manager.create(guild, "channel-1", host, "balance");
  game.phase = "discussion";
  game.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };

  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: false,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const ticket = joinTicketService.issue({
    gameId: game.id,
    discordUserId: "user-1",
    ttlMs: 180_000,
  });

  const exchangeResponse = await fetch(`http://127.0.0.1:${port}/auth/exchange?ticket=${encodeURIComponent(ticket)}`, {
    redirect: "manual",
  });
  const setCookie = exchangeResponse.headers.get("set-cookie") ?? "";

  assert.equal(exchangeResponse.status, 302);
  assert.doesNotMatch(setCookie, /Secure/);
});

test("잘못 인코딩된 쿠키 헤더는 500 대신 401 로 처리된다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const guild = { id: "guild-1" } as Guild;
  const host = createMember("user-1", "host");
  const game = manager.create(guild, "channel-1", host, "balance");
  game.phase = "discussion";
  game.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };

  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: true,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/game/${encodeURIComponent(game.id)}/state`, {
    headers: {
      Cookie: "mafia_session=%E0%A4%A",
    },
  });

  assert.equal(response.status, 401);
});

test("새 링크를 발급하면 이전 WebSocket 세션은 더 이상 상태를 받지 못한다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const guild = { id: "guild-1" } as Guild;
  const host = createMember("user-1", "host");
  const game = manager.create(guild, "channel-1", host, "balance");
  game.phase = "discussion";
  game.phaseContext = {
    token: 1,
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
  };

  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: true,
  });
  const port = await server.listen();

  let socket: WebSocket | null = null;
  t.after(async () => {
    socket?.close();
    await server.close();
  });

  const issueCookie = async (): Promise<string> => {
    const ticket = joinTicketService.issue({
      gameId: game.id,
      discordUserId: "user-1",
      ttlMs: 180_000,
    });

    const exchangeResponse = await fetch(`http://127.0.0.1:${port}/auth/exchange?ticket=${encodeURIComponent(ticket)}`, {
      redirect: "manual",
    });

    return (exchangeResponse.headers.get("set-cookie") ?? "").split(";")[0];
  };

  const firstCookie = await issueCookie();
  socket = new WebSocket(`ws://127.0.0.1:${port}/api/game/${encodeURIComponent(game.id)}/ws`, {
    headers: {
      Cookie: firstCookie,
    },
  });

  await new Promise<void>((resolve, reject) => {
    socket!.once("open", () => resolve());
    socket!.once("error", reject);
  });

  await issueCookie();

  let receivedMessage = false;
  socket.on("message", () => {
    receivedMessage = true;
  });

  const closeCode = await new Promise<number>((resolve, reject) => {
    socket!.once("close", (code) => resolve(Number(code)));
    socket!.once("error", reject);
    game.appendPublicLine("rejoin after ws test");
  });

  assert.equal(closeCode, 4001);
  assert.equal(receivedMessage, false);
});

test("리소스 서버는 새 mp3 오디오 파일들과 URL 인코딩된 파일명을 그대로 제공한다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: false,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const gunshots = await fetch(`http://127.0.0.1:${port}/resource/audio/gunshots.mp3`);
  const doctor = await fetch(`http://127.0.0.1:${port}/resource/audio/doctor.mp3`);
  const ending = await fetch(`http://127.0.0.1:${port}/resource/audio/ending.mp3`);
  const encodedCamera = await fetch(`http://127.0.0.1:${port}/resource/audio/%63amera_shutter.mp3`);

  assert.equal(gunshots.status, 200);
  assert.equal(gunshots.headers.get("content-type"), "audio/mpeg");
  assert.equal(doctor.status, 200);
  assert.equal(doctor.headers.get("content-type"), "audio/mpeg");
  assert.equal(ending.status, 200);
  assert.equal(ending.headers.get("content-type"), "audio/mpeg");
  assert.equal(encodedCamera.status, 200);
  assert.equal(encodedCamera.headers.get("content-type"), "audio/mpeg");
});

test("클라이언트 자산 서버는 유효한 CSS 와 JS 모듈을 제공한다", async (t) => {
  const manager = new InMemoryGameRegistry();
  const joinTicketService = new JoinTicketService("join-secret");
  const sessionStore = new InMemorySessionStore("session-secret");
  const server = new DashboardServer({
    client: {} as Client,
    gameManager: manager,
    joinTicketService,
    sessionStore,
    port: 0,
    secureCookies: false,
  });
  const port = await server.listen();
  t.after(async () => {
    await server.close();
  });

  const css = await fetch(`http://127.0.0.1:${port}/client/app.css`);
  const js = await fetch(`http://127.0.0.1:${port}/client/app.js`);
  const jsSource = await js.text();

  assert.equal(css.status, 200);
  assert.equal(css.headers.get("content-type"), "text/css");
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type") ?? "", /^application\/javascript/);

  const tempDir = await mkdtemp(join(tmpdir(), "dashboard-client-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const tempModulePath = join(tempDir, "app.mjs");
  await writeFile(tempModulePath, jsSource, "utf8");
  execFileSync(process.execPath, ["--check", tempModulePath], {
    stdio: "pipe",
  });
});
