import assert from "node:assert/strict";
import { test } from "node:test";
import { LiarGame } from "../src/engine/game";

function createGame() {
  return new LiarGame({
    guildId: "guild-1",
    guildName: "테스트 길드",
    channelId: "channel-1",
    hostId: "host",
    hostDisplayName: "방장",
    categoryId: "food",
  });
}

function seedPlayers(game: LiarGame) {
  game.addPlayer("p1", "민준");
  game.addPlayer("p2", "서윤");
  game.addPlayer("p3", "하준");
}

test("시작하면 라이어와 제시어, 설명 순서가 정해진다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.49, 0.0, 0.75, 0.5, 0.25, 0.1];
  game.start(() => rolls.shift() ?? 0);

  assert.equal(game.phase, "clue");
  assert.equal(game.liarId, "p1");
  assert.equal(game.secretWord, "김치찌개");
  assert.equal(game.turnOrder.length, 4);
  assert.equal(game.getCurrentSpeaker()?.userId, game.turnOrder[0]);
});

test("모드A 에서는 라이어가 자신이 라이어인 것을 알고 제시어를 받지 않는다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);

  const liarView = game.getKeywordView("host");
  const citizenView = game.getKeywordView("p1");

  assert.equal(liarView.isLiar, true);
  assert.equal(liarView.mode, "modeA");
  assert.equal(liarView.knowsLiarRole, true);
  assert.equal(liarView.keyword, null);
  assert.match(liarView.message, /당신은 라이어입니다/);
  assert.equal(citizenView.isLiar, false);
  assert.equal(citizenView.knowsLiarRole, false);
  assert.equal(citizenView.keyword, "김치찌개");
});

test("모드B 에서는 라이어가 오답 제시어를 받고 자신이 라이어인지 모른다", () => {
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

  const liarView = game.getKeywordView("host");
  const citizenView = game.getKeywordView("p1");

  assert.equal(liarView.isLiar, true);
  assert.equal(liarView.mode, "modeB");
  assert.equal(liarView.knowsLiarRole, false);
  assert.equal(liarView.keyword, "비빔밥");
  assert.doesNotMatch(liarView.message, /당신은 라이어입니다/);
  assert.equal(citizenView.keyword, "김치찌개");
});

test("최근 사용 제시어는 다음 시작에서 우선 제외할 수 있다", () => {
  const game = createGame();
  seedPlayers(game);

  game.start(() => 0, { excludedWords: ["김치찌개"] });

  assert.equal(game.secretWord, "비빔밥");
});

test("길드 교체 팩이 있으면 그 길드 전용 기본 카테고리로 시작한다", () => {
  const game = new LiarGame({
    guildId: "example-replace-pack",
    guildName: "교체 팩 길드",
    channelId: "channel-1",
    hostId: "host",
    hostDisplayName: "방장",
  });

  assert.equal(game.category.id, "k-snack");
  assert.equal(game.category.label, "분식");
});

test("설명 제출이 모두 끝나면 토론 단계로 넘어간다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);

  while (game.phase === "clue") {
    const speaker = game.getCurrentSpeaker();
    game.submitClue(speaker!.userId, `${speaker!.displayName} 설명`);
  }

  assert.equal(game.phase, "discussion");
  assert.equal(game.clues.length, 4);
});

test("라이어가 지목되면 추리 단계로 넘어가고 오답이면 시민이 이긴다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  while (game.phase === "clue") {
    const speaker = game.getCurrentSpeaker();
    game.submitClue(speaker!.userId, `${speaker!.displayName} 설명`);
  }

  game.beginVote();
  game.submitVote("host", "host");
  game.submitVote("p1", "host");
  game.submitVote("p2", "host");
  const resolution = game.submitVote("p3", "p1").resolution;

  assert.ok(resolution);
  assert.equal(game.phase, "guess");
  assert.equal(game.accusedUserId, "host");

  const result = game.guessWord("host", "초밥");
  assert.equal(result.winner, "citizens");
  assert.equal(game.phase, "ended");
  assert.match(result.reason, /제시어는 김치찌개/);
});

test("최다 득표 동률이면 라이어가 바로 승리한다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.75, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  while (game.phase === "clue") {
    const speaker = game.getCurrentSpeaker();
    game.submitClue(speaker!.userId, `${speaker!.displayName} 설명`);
  }

  game.beginVote();
  game.submitVote("host", "p1");
  game.submitVote("p1", "host");
  game.submitVote("p2", "p1");
  const resolution = game.submitVote("p3", "host").resolution;

  assert.ok(resolution);
  assert.equal(game.phase, "ended");
  assert.equal(game.result?.winner, "liar");
  assert.match(game.result?.reason ?? "", /동률/);
});

test("설명 시간 초과로 현재 차례를 넘길 수 있다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  const skippedSpeakerId = game.getCurrentSpeaker()!.userId;

  const skipped = game.skipCurrentSpeaker();

  assert.equal(skipped.skippedSpeakerId, skippedSpeakerId);
  assert.equal(skipped.phaseChanged, false);
  assert.notEqual(game.getCurrentSpeaker()?.userId, skippedSpeakerId);
  assert.equal(game.getCompletedClueTurns(), 1);
});

test("무투표 시간 초과면 라이어 승리로 끝난다", () => {
  const game = createGame();
  seedPlayers(game);

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  while (game.phase === "clue") {
    const speaker = game.getCurrentSpeaker()!;
    game.submitClue(speaker.userId, `${speaker.displayName} 설명`);
  }

  game.beginVote();
  const resolution = game.resolveVotingTimeout();

  assert.equal(game.phase, "ended");
  assert.equal(resolution.result?.winner, "liar");
  assert.match(resolution.result?.reason ?? "", /제출된 표가 없어/);
});

test("라이어가 시간 안에 정답을 못 내면 시민이 승리한다", () => {
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

  const result = game.resolveGuessTimeout();

  assert.equal(game.phase, "ended");
  assert.equal(result.winner, "citizens");
  assert.match(result.reason, /제한 시간 안에 정답을 제출하지 못해/);
});
