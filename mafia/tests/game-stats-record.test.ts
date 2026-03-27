import assert from "node:assert/strict";
import { test } from "node:test";
import { Guild, GuildMember } from "discord.js";
import { MafiaGame } from "../src/game/game";
import { PlayerState, Role } from "../src/game/model";
import { buildRecordedMatch } from "../src/db/match-record";

type InternalGame = MafiaGame & Record<string, unknown>;

interface PlayerSeed {
  userId: string;
  role: Role;
  originalRole?: Role;
  displayName?: string;
  alive?: boolean;
  deadReason?: string;
}

function createTestGame(): InternalGame {
  const guild = { id: "guild-1", name: "Guild One" } as Guild;
  const host = { id: "host", displayName: "host", user: { bot: false } } as GuildMember;
  const game = new MafiaGame(guild, "channel-1", host, "balance", () => undefined, "web") as InternalGame;
  game.players.clear();
  return game;
}

function seedPlayers(game: InternalGame, players: PlayerSeed[]): void {
  game.players.clear();
  for (const player of players) {
    game.players.set(player.userId, makePlayer(player));
  }
}

function makePlayer(seed: PlayerSeed): PlayerState {
  return {
    userId: seed.userId,
    displayName: seed.displayName ?? seed.userId,
    role: seed.role,
    originalRole: seed.originalRole ?? seed.role,
    alive: seed.alive ?? true,
    deadReason: seed.deadReason,
    isContacted: false,
    loverId: undefined,
    ascended: false,
    soldierUsed: false,
    reporterUsed: false,
    priestUsed: false,
    terrorMarkId: undefined,
    voteLockedToday: false,
    timeAdjustUsedOnDay: null,
  };
}

test("completed game record 는 승패와 좌석 정보를 정규화한다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "u1", displayName: "루나", role: "mafia" },
    { userId: "u2", displayName: "민재", role: "doctor", alive: false, deadReason: "마피아 처형" },
  ]);
  game.startedAt = 1_700_000_000_000;
  game.endedAt = 1_700_000_100_000;
  game.endedWinner = "마피아팀";
  game.endedReason = "마피아팀 승리";

  const record = buildRecordedMatch(game);

  assert.equal(record.status, "completed");
  assert.equal(record.winnerTeam, "mafia");
  assert.equal(record.discordGuildId, "guild-1");
  assert.equal(record.guildName, "Guild One");
  assert.equal(record.players[0].seatNo, 1);
  assert.equal(record.players[0].isWinner, true);
  assert.equal(record.players[1].isWinner, false);
  assert.equal(record.players[1].survived, false);
  assert.equal(record.players[1].deathReason, "마피아 처형");
});

test("aborted game record 는 전적 집계 대상이 아닌 상태로 남긴다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "u1", displayName: "루나", role: "mafia" },
    { userId: "u2", displayName: "민재", role: "doctor" },
  ]);
  game.endedAt = 1_700_000_100_000;
  game.endedReason = "방장이 게임을 종료했습니다.";

  const record = buildRecordedMatch(game);

  assert.equal(record.status, "aborted");
  assert.equal(record.winnerTeam, null);
  assert.equal(record.players.every((player) => player.isWinner === false), true);
});
