import assert from "node:assert/strict";
import { test } from "node:test";
import { Guild, GuildMember } from "discord.js";
import { MafiaGame } from "../src/game/game";
import { PlayerState, Role } from "../src/game/model";
import { buildDashboardState } from "../src/web/presenter";

type InternalGame = MafiaGame & Record<string, any>;

interface PlayerSeed {
  userId: string;
  role: Role;
  alive?: boolean;
  displayName?: string;
  loverId?: string;
  ascended?: boolean;
  isContacted?: boolean;
}

function createTestGame(): InternalGame {
  const guild = { id: "guild-1" } as Guild;
  const host = { id: "host", displayName: "host", user: { bot: false } } as GuildMember;
  const game = new MafiaGame(guild, "channel-1", host, "balance", () => undefined, "web") as InternalGame;
  game.players.clear();
  return game;
}

function seedPlayers(game: InternalGame, seeds: PlayerSeed[]): void {
  game.players.clear();
  game.loverPair = null;

  for (const seed of seeds) {
    game.players.set(seed.userId, makePlayer(seed));
  }

  const lovers = seeds.filter((seed) => Boolean(seed.loverId)).map((seed) => seed.userId);
  if (lovers.length === 2) {
    game.loverPair = [lovers[0], lovers[1]];
  }
}

function makePlayer(seed: PlayerSeed): PlayerState {
  return {
    userId: seed.userId,
    displayName: seed.displayName ?? seed.userId,
    role: seed.role,
    originalRole: seed.role,
    alive: seed.alive ?? true,
    deadReason: seed.alive === false ? "seeded dead" : undefined,
    isContacted: seed.isContacted ?? false,
    loverId: seed.loverId,
    ascended: seed.ascended ?? false,
    soldierUsed: false,
    reporterUsed: false,
    priestUsed: false,
    terrorMarkId: undefined,
    voteLockedToday: false,
    timeAdjustUsedOnDay: null,
  };
}

test("죽은 플레이어는 공개 채팅에 쓸 수 없고 밤에는 망자 채팅에 쓸 수 있다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "dead", role: "citizen", alive: false },
    { userId: "alive", role: "citizen", alive: true },
  ]);

  game.phase = "night";

  assert.equal(game.canWriteChat("dead", "public"), false);
  assert.equal(game.canWriteChat("dead", "graveyard"), true);
  assert.equal(game.canReadChat("dead", "graveyard"), true);
});

test("역할과 상태에 따라 비밀 채팅 접근 권한이 달라진다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia", role: "mafia" },
    { userId: "lover-a", role: "lover", loverId: "lover-b" },
    { userId: "lover-b", role: "lover", loverId: "lover-a" },
    { userId: "medium", role: "medium" },
    { userId: "dead", role: "citizen", alive: false },
    { userId: "citizen", role: "citizen" },
  ]);

  game.phase = "night";

  assert.equal(game.canReadChat("mafia", "mafia"), true);
  assert.equal(game.canReadChat("lover-a", "lover"), true);
  assert.equal(game.canReadChat("medium", "graveyard"), true);
  assert.equal(game.canReadChat("citizen", "mafia"), false);
  assert.equal(game.canReadChat("citizen", "graveyard"), false);
});

test("행동 패널은 단계에 맞는 행동만 노출한다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia", role: "mafia" },
    { userId: "citizen", role: "citizen" },
  ]);

  game.phase = "night";
  let state = buildDashboardState(game, "mafia").state!;
  assert.equal(state.actions.controls.some((control) => control.actionType === "night_select"), true);
  assert.equal(state.actions.controls.some((control) => control.actionType === "vote"), false);

  game.phase = "vote";
  game.phaseContext = { token: 1, startedAt: Date.now(), deadlineAt: Date.now() + 10_000 };
  state = buildDashboardState(game, "mafia").state!;
  assert.equal(state.actions.controls.some((control) => control.actionType === "vote"), true);
  assert.equal(state.actions.controls.some((control) => control.actionType === "night_select"), false);
});
