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
    { userId: "spy", role: "spy", isContacted: false },
    { userId: "madam", role: "madam", isContacted: true },
    { userId: "lover-a", role: "lover", loverId: "lover-b" },
    { userId: "lover-b", role: "lover", loverId: "lover-a" },
    { userId: "medium", role: "medium" },
    { userId: "dead", role: "citizen", alive: false },
    { userId: "citizen", role: "citizen" },
  ]);

  game.phase = "night";

  assert.equal(game.canReadChat("mafia", "mafia"), true);
  assert.equal(game.canReadChat("spy", "mafia"), false);
  assert.equal(game.canReadChat("madam", "mafia"), true);
  assert.equal(game.canReadChat("lover-a", "lover"), true);
  assert.equal(game.canReadChat("medium", "graveyard"), true);
  assert.equal(game.canReadChat("dead", "mafia"), true);
  assert.equal(game.canReadChat("dead", "lover"), true);
  assert.equal(game.canWriteChat("dead", "mafia"), false);
  assert.equal(game.canWriteChat("dead", "lover"), false);
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

test("찬반 투표 패널에는 현재 대상 이름이 포함된다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia", role: "mafia", displayName: "루나" },
    { userId: "citizen", role: "citizen", displayName: "민재" },
  ]);

  game.phase = "trial";
  game.currentTrialTargetId = "citizen";
  game.phaseContext = { token: 3, startedAt: Date.now(), deadlineAt: Date.now() + 10_000 };

  const state = buildDashboardState(game, "mafia").state!;
  const control = state.actions.controls.find((entry) => entry.actionType === "trial_vote");

  assert.ok(control);
  assert.match(control.description, /민재 님을 처형할지 선택합니다/);
});

test("낮 투표를 제출한 뒤에는 대시보드에서 재선택할 수 없다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia", role: "mafia", displayName: "루나" },
    { userId: "citizen", role: "citizen", displayName: "민재" },
  ]);

  game.phase = "vote";
  game.phaseContext = { token: 4, startedAt: Date.now(), deadlineAt: Date.now() + 10_000 };
  game.dayVotes.set("mafia", "citizen");
  game.getPlayerOrThrow("mafia").voteLockedToday = true;

  const state = buildDashboardState(game, "mafia").state!;

  assert.equal(state.actions.controls.some((control) => control.actionType === "vote"), false);
  const submitted = state.actions.controls.find((control) => control.actionType === "vote_submitted");
  assert.ok(submitted);
  assert.match(submitted.description, /민재 님에게 투표를 제출했습니다/);
});

test("찬반 투표를 제출한 뒤에는 대시보드에서 재선택할 수 없다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia", role: "mafia", displayName: "루나" },
    { userId: "citizen", role: "citizen", displayName: "민재" },
  ]);

  game.phase = "trial";
  game.currentTrialTargetId = "citizen";
  game.phaseContext = { token: 5, startedAt: Date.now(), deadlineAt: Date.now() + 10_000 };
  game.trialVotes.set("mafia", "yes");

  const state = buildDashboardState(game, "mafia").state!;

  assert.equal(state.actions.controls.some((control) => control.actionType === "trial_vote"), false);
  const submitted = state.actions.controls.find((control) => control.actionType === "trial_vote_submitted");
  assert.ok(submitted);
  assert.match(submitted.description, /처형 찬성에 투표를 제출했습니다/);
});

test("상태 패널 좌석은 참가 순서와 닉네임을 유지하고 빈 자리를 채운다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "u1", role: "mafia", displayName: "루나" },
    { userId: "u2", role: "doctor", displayName: "민재", alive: false },
    { userId: "u3", role: "citizen", displayName: "서아" },
  ]);

  const state = buildDashboardState(game, "u1").state!;

  assert.equal(state.room.seats.length, 8);
  assert.deepEqual(
    state.room.seats.slice(0, 3).map((seat) => ({
      seat: seat.seat,
      displayName: seat.displayName,
      alive: seat.alive,
      isViewer: seat.isViewer,
      empty: seat.empty,
    })),
    [
      { seat: 1, displayName: "루나", alive: true, isViewer: true, empty: false },
      { seat: 2, displayName: "민재", alive: false, isViewer: false, empty: false },
      { seat: 3, displayName: "서아", alive: true, isViewer: false, empty: false },
    ],
  );
  assert.equal(state.room.seats[7].empty, true);
  assert.equal(state.room.seats[7].displayName, null);
});

test("종료 상태는 승패와 역할 공개 요약을 포함한다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia", role: "mafia", displayName: "루나" },
    { userId: "doctor", role: "doctor", displayName: "민재", alive: false },
  ]);

  game.phase = "ended";
  game.endedWinner = "마피아팀";
  game.endedReason = "마피아팀 승리";

  const mafiaState = buildDashboardState(game, "mafia").state!;
  const doctorState = buildDashboardState(game, "doctor").state!;

  assert.equal(mafiaState.endedSummary?.viewerResultLabel, "승리");
  assert.equal(doctorState.endedSummary?.viewerResultLabel, "패배");
  assert.equal(mafiaState.endedSummary?.winnerLabel, "마피아팀");
  assert.equal(mafiaState.endedSummary?.revealedPlayers.length, 2);
  assert.equal(mafiaState.endedSummary?.revealedPlayers[1].roleLabel, "의사");
});
