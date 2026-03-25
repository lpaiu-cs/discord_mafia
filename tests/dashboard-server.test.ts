import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, Guild, GuildMember } from "discord.js";
import { GameManager } from "../src/game/game";
import { JoinTicketService } from "../src/web/join-ticket";
import { SessionStore } from "../src/web/session-store";
import { DashboardServer } from "../src/web/server";

function createMember(id: string, displayName: string): GuildMember {
  return {
    id,
    displayName,
    user: { bot: false },
  } as GuildMember;
}

test("URL exchange 는 세션 쿠키를 발급하고 polling/chat API 와 연동된다", async (t) => {
  const manager = new GameManager();
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
  const sessionStore = new SessionStore("session-secret");
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
  const manager = new GameManager();
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
  const sessionStore = new SessionStore("session-secret");
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

test("로컬 HTTP 프리뷰에서는 세션 쿠키에 Secure 를 붙이지 않는다", async (t) => {
  const manager = new GameManager();
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
  const sessionStore = new SessionStore("session-secret");
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
  const manager = new GameManager();
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
  const sessionStore = new SessionStore("session-secret");
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
