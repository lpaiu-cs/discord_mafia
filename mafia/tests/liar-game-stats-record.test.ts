import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecordedLiarMatch } from "../src/db/liar-match-record";
import { LiarGame } from "../../liar/src";

function createGame(): LiarGame {
  return new LiarGame({
    guildId: "guild-1",
    guildName: "테스트 길드",
    channelId: "channel-1",
    hostId: "host",
    hostDisplayName: "방장",
    categoryId: "food",
  });
}

function seedPlayers(game: LiarGame): void {
  game.addPlayer("p1", "민준");
  game.addPlayer("p2", "서윤");
  game.addPlayer("p3", "하준");
}

test("liar completed record 는 승자와 투표/단서 정보를 정규화한다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  while (game.phase === "clue") {
    const speaker = game.getCurrentSpeaker()!;
    game.submitClue(speaker.userId, `${speaker.displayName} 설명`);
  }

  game.beginVote();
  game.submitVote("host", "host");
  game.submitVote("p1", "host");
  game.submitVote("p2", "host");
  game.submitVote("p3", "p1");
  game.guessWord("host", "김치찌개");

  const record = buildRecordedLiarMatch(game);

  assert.equal(record.status, "completed");
  assert.equal(record.mode, "modeA");
  assert.equal(record.winner, "liar");
  assert.equal(record.secretWord, "김치찌개");
  assert.equal(record.liarAssignedWord, null);
  assert.equal(record.accusedUserId, "host");
  assert.equal(record.players.find((player) => player.discordUserId === "host")?.isLiar, true);
  assert.equal(record.players.find((player) => player.discordUserId === "host")?.isWinner, true);
  assert.equal(record.players.find((player) => player.discordUserId === "p1")?.voteTargetUserId, "host");
  assert.equal(record.players.every((player) => player.submittedClue), true);
});

test("liar cancelled record 는 취소 상태로 남는다", () => {
  const game = createGame();
  seedPlayers(game);
  game.forceEnd("방장이 종료했습니다.");

  const record = buildRecordedLiarMatch(game);

  assert.equal(record.status, "cancelled");
  assert.equal(record.mode, "modeA");
  assert.equal(record.winner, null);
  assert.equal(record.players.every((player) => player.isWinner === false), true);
});

test("modeB record 는 라이어에게 주어진 오답 제시어도 남긴다", () => {
  const game = new LiarGame({
    guildId: "guild-1",
    guildName: "테스트 길드",
    channelId: "channel-1",
    hostId: "host",
    hostDisplayName: "방장",
    categoryId: "food",
    mode: "modeB",
  });
  seedPlayers(game);

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  while (game.phase === "clue") {
    const speaker = game.getCurrentSpeaker()!;
    game.submitClue(speaker.userId, `${speaker.displayName} 설명`);
  }

  game.beginVote();
  game.submitVote("host", "host");
  game.submitVote("p1", "host");
  game.submitVote("p2", "host");
  game.submitVote("p3", "p1");
  game.guessWord("host", "김치찌개");

  const record = buildRecordedLiarMatch(game);

  assert.equal(record.mode, "modeB");
  assert.equal(record.secretWord, "김치찌개");
  assert.equal(record.liarAssignedWord, "비빔밥");
});
