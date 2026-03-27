import assert from "node:assert/strict";
import { test } from "node:test";
import { GameRegistry, InMemoryGameRegistry } from "../src/game/game";
import { createPracticeClient } from "../src/dev/practice-client";
import {
  buildPracticeScenarioDefinitions,
  createPracticeGame,
  initializePracticeGame,
  PRACTICE_VIEWER_ID,
} from "../src/dev/practice-scenarios";
import { buildDashboardState } from "../src/web/presenter";

test("practice 시나리오는 4개가 준비되고 초기 시야가 역할별로 맞아야 한다", async () => {
  const manager = new InMemoryGameRegistry();
  const client = createPracticeClient();
  const scenarios = buildPracticeScenarioDefinitions();

  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    ["practice1", "practice2", "practice3", "practice4"],
  );

  const prepared = await Promise.all(
    scenarios.map(async (scenario) => {
      const game = createPracticeGame(manager, scenario, "balance").game;
      await initializePracticeGame(game, scenario, client, { enableTimers: false });
      return { scenario, game };
    }),
  );

  const mafiaState = buildDashboardState(prepared[0].game, PRACTICE_VIEWER_ID).state!;
  assert.equal(mafiaState.viewer.roleLabel, "마피아");
  assert.equal(mafiaState.room.phase, "night");
  assert.equal(mafiaState.secretChats.some((chat) => chat.channel === "mafia"), true);
  assert.ok(mafiaState.publicChat.messages.some((message) => message.kind === "system" && message.content.includes("practice1: 마피아 시점 연습이 시작되었습니다.")));

  const politicianState = buildDashboardState(prepared[1].game, PRACTICE_VIEWER_ID).state!;
  assert.equal(politicianState.viewer.roleLabel, "정치인");
  assert.equal(politicianState.room.phase, "discussion");
  assert.equal(politicianState.secretChats.length, 0);
  assert.equal(politicianState.publicChat.canWrite, true);

  const mediumState = buildDashboardState(prepared[2].game, PRACTICE_VIEWER_ID).state!;
  assert.equal(mediumState.viewer.roleLabel, "영매");
  assert.equal(mediumState.room.phase, "night");
  assert.equal(mediumState.secretChats.some((chat) => chat.channel === "graveyard"), true);

  const deadState = buildDashboardState(prepared[3].game, PRACTICE_VIEWER_ID).state!;
  assert.equal(deadState.viewer.alive, false);
  assert.equal(deadState.room.phase, "night");
  assert.equal(deadState.secretChats.some((chat) => chat.channel === "graveyard"), true);
  assert.equal(deadState.publicChat.canWrite, false);
});

test("practice1 은 사용자가 고른 마피아 대상이 실제 밤 사망자로 반영된다", async () => {
  const manager = new InMemoryGameRegistry();
  const client = createPracticeClient();
  const scenario = buildPracticeScenarioDefinitions().find((item) => item.id === "practice1");
  assert.ok(scenario);

  const game = createPracticeGame(manager, scenario, "balance").game;
  await initializePracticeGame(game, scenario, client, { enableTimers: false });

  const token = game.phaseContext?.token;
  assert.ok(token);

  await game.submitNightSelection(client, {
    kind: "night",
    actorId: PRACTICE_VIEWER_ID,
    action: "mafiaKill",
    targetId: "reporter",
    token,
  });

  await game.forceAdvance(client);
  game.clearTimer();

  assert.equal(game.getPlayerOrThrow("reporter").alive, false);
  assert.equal(game.getPlayerOrThrow("police").alive, true);
  assert.equal(game.getPlayerOrThrow("politician").alive, true);
});
