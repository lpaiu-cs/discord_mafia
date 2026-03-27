import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Guild, GuildMember } from "discord.js";
import { LiarGame } from "../../liar/src";
import { LocalFileGameStatsStore } from "../src/db/local-file-game-stats-store";
import { buildRecordedLiarMatch } from "../src/db/liar-match-record";
import { MafiaGame } from "../src/game/game";
import { PlayerState, Role } from "../src/game/model";

type InternalGame = MafiaGame & Record<string, unknown>;

interface PlayerSeed {
  userId: string;
  role: Role;
  originalRole?: Role;
  displayName?: string;
  alive?: boolean;
  deadReason?: string;
}

function createMafiaGame(): InternalGame {
  const guild = { id: "guild-1", name: "Guild One" } as Guild;
  const host = { id: "host", displayName: "host", user: { bot: false } } as GuildMember;
  const game = new MafiaGame(guild, "channel-1", host, "balance", () => undefined, "web") as InternalGame;
  game.players.clear();
  return game;
}

function seedMafiaPlayers(game: InternalGame, players: PlayerSeed[]): void {
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

function createLiarGame(): LiarGame {
  const game = new LiarGame({
    guildId: "guild-1",
    guildName: "Guild One",
    channelId: "channel-1",
    hostId: "host",
    hostDisplayName: "방장",
    categoryId: "food",
  });
  game.addPlayer("p1", "민준");
  game.addPlayer("p2", "서윤");
  game.addPlayer("p3", "하준");
  return game;
}

test("로컬 파일 전적 저장소는 Postgres 없이도 마피아/라이어 전적을 유지한다", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "discord-game-bot-stats-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const filePath = join(tempDir, "game-stats.json");
  const store = new LocalFileGameStatsStore(filePath);
  await store.initialize();

  const mafiaGame = createMafiaGame();
  seedMafiaPlayers(mafiaGame, [
    { userId: "host", displayName: "루나", role: "mafia" },
    { userId: "u2", displayName: "민재", role: "doctor", alive: false, deadReason: "마피아 처형" },
  ]);
  mafiaGame.startedAt = 1_700_000_000_000;
  mafiaGame.endedAt = 1_700_000_100_000;
  mafiaGame.endedWinner = "마피아팀";
  mafiaGame.endedReason = "마피아팀 승리";

  await store.recordEndedGame(mafiaGame);

  const liarGame = createLiarGame();
  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  liarGame.start(() => rolls.shift() ?? 0);
  while (liarGame.phase === "clue") {
    const speaker = liarGame.getCurrentSpeaker()!;
    liarGame.submitClue(speaker.userId, `${speaker.displayName} 설명`);
  }
  liarGame.beginVote();
  liarGame.submitVote("host", "host");
  liarGame.submitVote("p1", "host");
  liarGame.submitVote("p2", "host");
  liarGame.submitVote("p3", "p1");
  liarGame.guessWord("host", "김치찌개");

  await store.recordEndedLiarGame(buildRecordedLiarMatch(liarGame));
  await store.close();

  const reopenedStore = new LocalFileGameStatsStore(filePath);
  await reopenedStore.initialize();

  const mafiaStats = await reopenedStore.getPlayerDashboardStats("host");
  const liarStats = await reopenedStore.getLiarPlayerStats("host");

  assert.ok(mafiaStats);
  assert.equal(mafiaStats.lifetime.matchesPlayed, 1);
  assert.equal(mafiaStats.lifetime.wins, 1);
  assert.equal(mafiaStats.roleStats[0]?.role, "mafia");
  assert.equal(mafiaStats.recentMatches[0]?.guildName, "Guild One");

  assert.ok(liarStats);
  assert.equal(liarStats.lifetime.matchesPlayed, 1);
  assert.equal(liarStats.lifetime.liarMatches, 1);
  assert.equal(liarStats.lifetime.liarWins, 1);
  assert.equal(liarStats.recentMatches[0]?.categoryLabel, "음식");
});
