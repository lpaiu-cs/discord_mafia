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
    { userId: "spy-cold", role: "spy", isContacted: false },
    { userId: "spy-hot", role: "spy", isContacted: true },
    { userId: "beast-cold", role: "beastman", isContacted: false },
    { userId: "beast-hot", role: "beastman", isContacted: true },
    { userId: "madam-cold", role: "madam", isContacted: false },
    { userId: "madam-hot", role: "madam", isContacted: true },
    { userId: "lover-a", role: "lover", loverId: "lover-b" },
    { userId: "lover-b", role: "lover", loverId: "lover-a" },
    { userId: "medium", role: "medium" },
    { userId: "dead", role: "citizen", alive: false },
    { userId: "citizen", role: "citizen" },
  ]);

  game.phase = "night";

  assert.equal(game.canReadChat("mafia", "mafia"), true);
  assert.equal(game.canReadChat("spy-cold", "mafia"), false);
  assert.equal(game.canReadChat("spy-hot", "mafia"), true);
  assert.equal(game.canReadChat("beast-cold", "mafia"), false);
  assert.equal(game.canReadChat("beast-hot", "mafia"), true);
  assert.equal(game.canReadChat("madam-cold", "mafia"), false);
  assert.equal(game.canReadChat("madam-hot", "mafia"), true);
  assert.equal(game.canReadChat("lover-a", "lover"), true);
  assert.equal(game.canReadChat("medium", "graveyard"), true);
  assert.equal(game.canReadChat("dead", "mafia"), true);
  assert.equal(game.canReadChat("dead", "lover"), true);
  assert.equal(game.canWriteChat("spy-hot", "mafia"), true);
  assert.equal(game.canWriteChat("beast-hot", "mafia"), true);
  assert.equal(game.canWriteChat("madam-hot", "mafia"), true);
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

test("마피아 밤 선택 마커는 개인 draft 가 아니라 팀의 마지막 제출 대상을 따른다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia-a", role: "mafia", displayName: "루나" },
    { userId: "mafia-b", role: "mafia", displayName: "세아" },
    { userId: "citizen", role: "citizen", displayName: "민재" },
  ]);

  game.phase = "night";
  game.phaseContext = { token: 2, startedAt: Date.now(), deadlineAt: Date.now() + 10_000 };
  game.nightActions.set("mafia-a", {
    actorId: "mafia-a",
    action: "mafiaKill",
    targetId: "mafia-b",
    submittedAt: 100,
  });
  game.nightActions.set("mafia-b", {
    actorId: "mafia-b",
    action: "mafiaKill",
    targetId: "citizen",
    submittedAt: 200,
  });

  const state = buildDashboardState(game, "mafia-a").state!;
  const control = state.actions.controls.find((entry) => entry.action === "mafiaKill");

  assert.ok(control);
  assert.equal(control.currentValue, "citizen");
  assert.equal(control.currentLabel, "민재");
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

test("건달 협박 표시는 협박당한 본인에게만 보인다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "thug", role: "thug", displayName: "건달" },
    { userId: "target", role: "citizen", displayName: "대상" },
    { userId: "other", role: "doctor", displayName: "다른이" },
  ]);
  game.bulliedToday.add("target");

  const otherState = buildDashboardState(game, "other").state!;
  const targetState = buildDashboardState(game, "target").state!;

  assert.equal(otherState.room.seats.find((seat) => seat.userId === "target")?.bullied, false);
  assert.equal(targetState.room.seats.find((seat) => seat.userId === "target")?.bullied, true);
});

test("대시보드는 자기 직업 메모를 고정해서 내려준다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "mafia", role: "mafia", displayName: "루나" },
    { userId: "citizen", role: "citizen", displayName: "민재" },
  ]);

  const state = buildDashboardState(game, "mafia").state!;
  const viewerSeat = state.room.seats.find((seat) => seat.userId === "mafia");

  assert.equal(viewerSeat?.memoRole, "mafia");
  assert.equal(viewerSeat?.memoLocked, true);
  assert.equal(viewerSeat?.memoLockedReason, "내 직업");
});

test("경찰이 확정한 마피아 직업은 조사한 본인 메모에만 고정된다", () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "police", role: "police", displayName: "경찰" },
    { userId: "mafia", role: "mafia", displayName: "마피아" },
    { userId: "other", role: "doctor", displayName: "다른이" },
  ]);
  game.confirmRoleForViewer("police", "mafia", "mafia", "police");

  const policeState = buildDashboardState(game, "police").state!;
  const otherState = buildDashboardState(game, "other").state!;

  assert.equal(policeState.room.seats.find((seat) => seat.userId === "mafia")?.memoRole, "mafia");
  assert.equal(policeState.room.seats.find((seat) => seat.userId === "mafia")?.memoLockedReason, "경찰 조사로 확정");
  assert.equal(otherState.room.seats.find((seat) => seat.userId === "mafia")?.memoRole, null);
});

test("기자 기사로 공개된 직업은 모두의 메모에 고정된다", async () => {
  const game = createTestGame();
  seedPlayers(game, [
    { userId: "reporter", role: "reporter", displayName: "기자" },
    { userId: "target", role: "doctor", displayName: "대상" },
    { userId: "other", role: "citizen", displayName: "다른이" },
  ]);
  game.phase = "discussion";
  game.dayNumber = 2;
  game.pendingArticle = {
    actorId: "reporter",
    targetId: "target",
    role: "doctor",
    publishFromDay: 2,
  };
  game["sendOrUpdateStatus"] = async () => undefined;
  game["getPublicChannel"] = async () =>
    ({
      async send() {
        return undefined;
      },
    }) as any;

  await game.publishReporterArticle({} as any, "reporter");

  const otherState = buildDashboardState(game, "other").state!;
  const targetSeat = otherState.room.seats.find((seat) => seat.userId === "target");

  assert.equal(targetSeat?.memoRole, "doctor");
  assert.equal(targetSeat?.memoLocked, true);
  assert.equal(targetSeat?.memoLockedReason, "기자 기사로 확정");
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
