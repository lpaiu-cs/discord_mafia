import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, Guild, GuildMember, StringSelectMenuInteraction } from "discord.js";
import { MafiaGame } from "../src/game/game";
import { PhaseContext, PlayerState, Role, Ruleset } from "../src/game/model";
import { getRoleSummary } from "../src/game/rules";

type InternalGame = MafiaGame & Record<string, any>;

interface PlayerSeed {
  userId: string;
  displayName?: string;
  role: Role;
  originalRole?: Role;
  alive?: boolean;
  isContacted?: boolean;
  loverId?: string;
  ascended?: boolean;
  soldierUsed?: boolean;
  reporterUsed?: boolean;
  priestUsed?: boolean;
  terrorMarkId?: string;
}

function createTestGame(ruleset: Ruleset = "balance"): InternalGame {
  const guild = { id: "guild-1" } as Guild;
  const host = { id: "host", displayName: "host" } as GuildMember;
  const game = new MafiaGame(guild, "public-channel", host, ruleset, () => undefined) as InternalGame;
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
    originalRole: seed.originalRole ?? seed.role,
    alive: seed.alive ?? true,
    deadReason: seed.alive === false ? "seeded dead" : undefined,
    isContacted: seed.isContacted ?? false,
    loverId: seed.loverId,
    ascended: seed.ascended ?? false,
    soldierUsed: seed.soldierUsed ?? false,
    reporterUsed: seed.reporterUsed ?? false,
    priestUsed: seed.priestUsed ?? false,
    terrorMarkId: seed.terrorMarkId,
    voteLockedToday: false,
    timeAdjustUsedOnDay: null,
  };
}

function setNightAction(game: InternalGame, actorId: string, action: string, targetId: string, submittedAt = Date.now()): void {
  game.nightActions.set(actorId, { actorId, action, targetId, submittedAt });
}

function setBonusNightAction(game: InternalGame, actorId: string, action: string, targetId: string, submittedAt = Date.now()): void {
  game.bonusNightActions.set(actorId, { actorId, action, targetId, submittedAt });
}

function phaseContext(token = 1): PhaseContext {
  return { token, startedAt: Date.now(), deadlineAt: Date.now() + 60_000 };
}

async function resolveNight(game: InternalGame) {
  const dms: Array<{ userId: string; payload: unknown }> = [];
  game["safeSendDm"] = async (_client: Client, userId: string, payload: unknown) => {
    dms.push({ userId, payload });
  };
  game["syncSecretChannels"] = async () => undefined;
  const summary = await game["resolveNight"]({} as Client);
  return { summary, dms };
}

test("역할 카드 설명은 현재 엔진 동작과 맞아야 한다", () => {
  assert.match(getRoleSummary("spy", "balance"), /같은 밤에 한 번 더 조사/);
  assert.match(getRoleSummary("beastman", "balance"), /다른 마피아팀 생존자가 없으면/);
  assert.match(getRoleSummary("beastman", "balance"), /의사\/군인\/연인 효과를 무시/);
  assert.match(getRoleSummary("soldier", "balance"), /스파이의 정체를 알고 조사 결과를 막습니다/);
  assert.match(getRoleSummary("medium", "balance"), /죽은 사람 한 명의 직업을 알아내 성불/);
  assert.match(getRoleSummary("priest", "balance"), /밤에 죽은 플레이어 한 명을 부활/);
});

test("승리 조건은 정치인 표 가중치와 무관하게 머릿수로만 계산한다", () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "politician", displayName: "정치인", role: "politician" },
  ]);

  assert.equal(game["getWinner"](), "마피아팀");
});

test("연인 희생은 비공개로 처리되고 실제 마피아 사망자 기준으로 도굴과 접선이 판정된다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "lover-a", displayName: "연인A", role: "lover", loverId: "lover-b" },
    { userId: "lover-b", displayName: "연인B", role: "lover", loverId: "lover-a" },
    { userId: "graverobber", displayName: "도굴꾼", role: "graverobber" },
    { userId: "beastman", displayName: "짐승인간", role: "beastman" },
  ]);
  game.phase = "night";
  game.nightNumber = 1;
  setNightAction(game, "mafia", "mafiaKill", "lover-a", 1);
  setNightAction(game, "beastman", "beastMark", "lover-a", 2);

  const { summary } = await resolveNight(game);

  assert.equal(game.getPlayer("lover-a")?.alive, true);
  assert.equal(game.getPlayer("lover-b")?.alive, false);
  assert.ok(summary.publicLines.some((line) => line.includes("연인B 님이 밤사이 사망했습니다.")));
  assert.ok(summary.publicLines.every((line) => !line.includes("연인의 희생")));
  assert.ok(summary.privateLines.some((line) => line.userId === "lover-a" && line.line.includes("마피아 님이 당신을 노린 마피아")));
  assert.equal(game.getPlayer("beastman")?.isContacted, false);
  assert.equal(game.getPlayer("graverobber")?.role, "lover");
  assert.equal(game.getPlayer("lover-b")?.role, "citizen");
  assert.equal(game.getPlayer("lover-a")?.loverId, "graverobber");
  assert.deepEqual(game.loverPair, ["graverobber", "lover-a"]);
});

test("의사 치료로 실제 사망이 없으면 도굴과 짐승인간 접선이 발생하지 않는다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "doctor", displayName: "의사", role: "doctor" },
    { userId: "target", displayName: "시민", role: "citizen" },
    { userId: "graverobber", displayName: "도굴꾼", role: "graverobber" },
    { userId: "beastman", displayName: "짐승인간", role: "beastman" },
  ]);
  game.phase = "night";
  game.nightNumber = 1;
  setNightAction(game, "mafia", "mafiaKill", "target", 1);
  setNightAction(game, "doctor", "doctorProtect", "target", 2);
  setNightAction(game, "beastman", "beastMark", "target", 3);

  const { summary } = await resolveNight(game);

  assert.equal(game.getPlayer("target")?.alive, true);
  assert.equal(game.getPlayer("graverobber")?.role, "graverobber");
  assert.equal(game.getPlayer("beastman")?.isContacted, false);
  assert.ok(summary.publicLines.includes("의사의 치료로 아무도 죽지 않았습니다."));
});

test("접선된 짐승인간만 남으면 밤 프롬프트가 beastKill로 바뀐다", () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "beastman", displayName: "짐승인간", role: "beastman", isContacted: true },
    { userId: "citizen", displayName: "시민", role: "citizen" },
  ]);
  game.phase = "night";

  const prompt = game["getNightPrompt"]("beastman");

  assert.ok(prompt);
  assert.equal(prompt?.action, "beastKill");
  assert.deepEqual(prompt?.targets, ["citizen"]);
});

test("짐승인간 단독 킬은 실제로 발동하고 의사, 군인, 연인 희생을 모두 무시한다", async () => {
  const simpleGame = createTestGame("balance");
  seedPlayers(simpleGame, [
    { userId: "beastman", displayName: "짐승인간", role: "beastman", isContacted: true },
    { userId: "citizen", displayName: "시민", role: "citizen" },
  ]);
  simpleGame.phase = "night";
  setNightAction(simpleGame, "beastman", "beastKill", "citizen", 1);

  const simple = await resolveNight(simpleGame);

  assert.equal(simpleGame.getPlayer("citizen")?.alive, false);
  assert.ok(simple.summary.publicLines.includes("시민 님이 밤사이 사망했습니다."));

  const soldierGame = createTestGame("balance");
  seedPlayers(soldierGame, [
    { userId: "beastman", displayName: "짐승인간", role: "beastman", isContacted: true },
    { userId: "doctor", displayName: "의사", role: "doctor" },
    { userId: "soldier", displayName: "군인", role: "soldier" },
  ]);
  soldierGame.phase = "night";
  setNightAction(soldierGame, "beastman", "beastKill", "soldier", 1);
  setNightAction(soldierGame, "doctor", "doctorProtect", "soldier", 2);

  await resolveNight(soldierGame);

  assert.equal(soldierGame.getPlayer("soldier")?.alive, false);
  assert.equal(soldierGame.getPlayer("soldier")?.soldierUsed, false);

  const loverGame = createTestGame("balance");
  seedPlayers(loverGame, [
    { userId: "beastman", displayName: "짐승인간", role: "beastman", isContacted: true },
    { userId: "lover-a", displayName: "연인A", role: "lover", loverId: "lover-b" },
    { userId: "lover-b", displayName: "연인B", role: "lover", loverId: "lover-a" },
  ]);
  loverGame.phase = "night";
  setNightAction(loverGame, "beastman", "beastKill", "lover-a", 1);

  await resolveNight(loverGame);

  assert.equal(loverGame.getPlayer("lover-a")?.alive, false);
  assert.equal(loverGame.getPlayer("lover-b")?.alive, true);
});

test("영매와 성직자는 밤 시작 선택 UI가 없고 후속 DM으로만 처리된다", () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "priest", displayName: "성직자", role: "priest" },
    { userId: "medium", displayName: "영매", role: "medium" },
    { userId: "corpse", displayName: "망자", role: "citizen", alive: false },
    { userId: "alive", displayName: "생존자", role: "citizen" },
  ]);

  const priestPrompt = game["getNightPrompt"]("priest");
  const mediumPrompt = game["getNightPrompt"]("medium");

  assert.equal(priestPrompt, null);
  assert.equal(mediumPrompt, null);
});

test("영매는 성불되지 않은 망자만 후속 대상으로 받고 직업을 확인한다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "medium", displayName: "영매", role: "medium" },
    { userId: "corpse", displayName: "망자", role: "citizen", alive: false },
    { userId: "ascended", displayName: "성불망자", role: "doctor", alive: false, ascended: true },
    { userId: "alive", displayName: "생존자", role: "police" },
  ]);
  game.phase = "night";

  let capturedTargetIds: string[] = [];
  game["requestAftermathTarget"] = async (
    _client: Client,
    actorId: string,
    action: string,
    _title: string,
    _description: string,
    targetIds: string[],
  ) => {
    assert.equal(actorId, "medium");
    assert.equal(action, "mediumAscend");
    capturedTargetIds = targetIds;
    return "corpse";
  };

  const { summary } = await resolveNight(game);

  assert.deepEqual(capturedTargetIds, ["corpse"]);
  assert.equal(game.getPlayer("corpse")?.ascended, true);
  assert.ok(summary.privateLines.some((line) => line.userId === "medium" && line.line.includes("망자 님의 직업은 시민")));
});

test("성직자는 이번 밤 사망자만 후속 대상으로 받고 그 대상을 부활시킨다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "priest", displayName: "성직자", role: "priest" },
    { userId: "corpse", displayName: "망자", role: "citizen", alive: false },
    { userId: "target", displayName: "시민", role: "citizen" },
  ]);
  game.phase = "night";
  setNightAction(game, "mafia", "mafiaKill", "target", 1);

  let capturedTargetIds: string[] = [];
  game["requestAftermathTarget"] = async (
    _client: Client,
    actorId: string,
    action: string,
    _title: string,
    _description: string,
    targetIds: string[],
  ) => {
    assert.equal(actorId, "priest");
    assert.equal(action, "priestRevive");
    capturedTargetIds = targetIds;
    return "target";
  };

  const revived = await resolveNight(game);

  assert.deepEqual(capturedTargetIds, ["target"]);
  assert.equal(game.getPlayer("target")?.alive, true);
  assert.equal(game.getPlayer("priest")?.priestUsed, true);
  assert.ok(revived.summary.publicLines.some((line) => line.includes("성직자의 힘으로 부활했습니다.")));
});

test("공개 사망 결과는 웹 공개 채팅에도 시스템 메시지로 누적된다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "target", displayName: "시민", role: "citizen" },
  ]);
  game.phase = "night";
  setNightAction(game, "mafia", "mafiaKill", "target", 1);

  await resolveNight(game);

  const publicSystemLines = game.webChats.public.filter((message) => message.kind === "system").map((message) => message.content);
  assert.ok(publicSystemLines.some((line) => line.includes("시민 님이 밤사이 사망했습니다.")));
});

test("밸런스 규칙에서는 영매가 먼저 성불한 밤 사망자를 성직자가 되살릴 수 없다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "medium", displayName: "영매", role: "medium" },
    { userId: "priest", displayName: "성직자", role: "priest" },
    { userId: "target", displayName: "시민", role: "citizen" },
  ]);
  game.phase = "night";
  setNightAction(game, "mafia", "mafiaKill", "target", 1);

  game["requestAftermathTarget"] = async (
    _client: Client,
    actorId: string,
    action: string,
  ) => {
    if (actorId === "medium" && action === "mediumAscend") {
      return "target";
    }

    if (actorId === "priest" && action === "priestRevive") {
      return "target";
    }

    return null;
  };

  const { summary } = await resolveNight(game);

  assert.equal(game.getPlayer("target")?.alive, false);
  assert.equal(game.getPlayer("target")?.ascended, true);
  assert.equal(game.getPlayer("priest")?.priestUsed, true);
  assert.ok(summary.privateLines.some((line) => line.userId === "priest" && line.line.includes("영매가 먼저 성불시킨 대상")));
});

test("스파이는 마피아를 맞히면 같은 밤에 추가 조사 메시지를 받고 두 번째 조사 결과까지 받는다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "spy", displayName: "스파이", role: "spy" },
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "citizen", displayName: "시민", role: "citizen" },
  ]);
  game.phase = "night";
  game.phaseContext = phaseContext(7);
  game["syncSecretChannels"] = async () => undefined;

  const firstInteraction = createSelectInteraction(`night:${game.id}:7:spy:spyInspect`, "spy", "mafia");
  await game.handleNightSelect({} as Client, firstInteraction as StringSelectMenuInteraction);

  assert.equal(game.getPlayer("spy")?.isContacted, true);
  assert.equal(game.spyBonusGrantedTonight.has("spy"), true);
  assert.equal(firstInteraction.updatedPayload?.embeds?.[0]?.toJSON().title, "스파이 추가 조사");

  const secondInteraction = createSelectInteraction(`night:${game.id}:7:spy:spyInspectBonus`, "spy", "citizen");
  await game.handleNightSelect({} as Client, secondInteraction as StringSelectMenuInteraction);

  assert.ok(game.bonusNightActions.has("spy"));
  assert.equal(secondInteraction.updatedPayload?.embeds?.[0]?.toJSON().title, "스파이 추가 조사");

  const { summary } = await resolveNight(game);
  const spyLines = summary.privateLines.filter((line) => line.userId === "spy" && line.line.startsWith("조사 결과:"));
  assert.equal(spyLines.length, 2);
  assert.ok(spyLines.some((line) => line.line.includes("마피아")));
  assert.ok(spyLines.some((line) => line.line.includes("시민")));
});

test("군인은 스파이 조사 시 직업 정체를 알고 스파이는 조사 결과를 끝까지 확인하지 못한다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "spy", displayName: "스파이", role: "spy" },
    { userId: "soldier", displayName: "군인", role: "soldier" },
  ]);
  game.phase = "night";
  setNightAction(game, "spy", "spyInspect", "soldier", 1);

  const { summary } = await resolveNight(game);

  assert.ok(summary.privateLines.some((line) => line.userId === "spy" && line.line.includes("조사 결과를 끝까지 확인하지 못했습니다")));
  assert.ok(summary.privateLines.some((line) => line.userId === "soldier" && line.line.includes("스파이 님이 당신을 조사했습니다")));
});

test("밸런스 규칙에서는 마담이 유혹한 정치인의 2표와 투표 면역이 모두 꺼진다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "politician", displayName: "정치인", role: "politician" },
    { userId: "citizen-1", displayName: "시민1", role: "citizen" },
    { userId: "citizen-2", displayName: "시민2", role: "citizen" },
  ]);
  game.phase = "trial";
  game.currentTrialTargetId = "politician";
  game.pendingSeductionTargetId = "politician";
  game.phaseContext = phaseContext(3);
  game.trialVotes.set("mafia", "yes");
  game.trialVotes.set("citizen-1", "yes");
  game["syncSecretChannels"] = async () => undefined;
  game["beginNight"] = async () => undefined;
  game["sendPhaseMessage"] = async () => undefined;
  game["sendOrUpdateStatus"] = async () => undefined;
  game["lockOrDeleteSecretChannels"] = async () => undefined;

  await game["finishTrial"]({} as Client);

  assert.equal(game.getPlayer("politician")?.alive, false);
});

test("기자는 공개 가능 시점 이후 낮에 직접 기사를 공개한다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "reporter", displayName: "기자", role: "reporter" },
    { userId: "target", displayName: "대상", role: "doctor" },
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

  const sentPayloads: any[] = [];
  game["getPublicChannel"] = async () =>
    ({
      async send(payload: unknown) {
        sentPayloads.push(payload);
        return payload;
      },
    }) as any;

  const interaction = {
    customId: `reporter:${game.id}:2:reporter:publish`,
    user: { id: "reporter" },
    replyPayload: undefined as any,
    async reply(payload: unknown) {
      this.replyPayload = payload;
      return payload;
    },
  };

  await game.handleReporterPublish({} as Client, interaction as any);

  assert.equal(game.pendingArticle, null);
  assert.ok(game.lastPublicLines.some((line) => line.includes("기자 기사: 대상 님의 직업은 의사입니다.")));
  assert.equal(sentPayloads[0]?.embeds?.[0]?.toJSON().title, "기자 기사");
  assert.equal(interaction.replyPayload?.content, "기사를 공개했습니다.");
});

test("기자 publishFromDay는 첫째 낮 엠바고만 예외로 하고 바로 다음 낮부터 열린다", async () => {
  const cases = [
    { dayNumber: 0, expected: 2 },
    { dayNumber: 1, expected: 2 },
    { dayNumber: 2, expected: 3 },
  ];

  for (const { dayNumber, expected } of cases) {
    const game = createTestGame("balance");
    seedPlayers(game, [
      { userId: "reporter", displayName: "기자", role: "reporter" },
      { userId: "target", displayName: "대상", role: "doctor" },
    ]);
    game.phase = "night";
    game.dayNumber = dayNumber;
    setNightAction(game, "reporter", "reporterArticle", "target", 1);

    const { summary } = await resolveNight(game);

    assert.equal(game.pendingArticle?.publishFromDay, expected);
    assert.ok(summary.privateLines.some((line) => line.userId === "reporter" && line.line.includes(`${expected}번째 낮`)));
  }
});

test("망자는 밤에 마피아와 연인 비밀대화를 보고 망자 채널은 밤에만 열린다", async () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "lover-a", displayName: "연인A", role: "lover", loverId: "lover-b" },
    { userId: "lover-b", displayName: "연인B", role: "lover", loverId: "lover-a" },
    { userId: "medium", displayName: "영매", role: "medium" },
    { userId: "dead", displayName: "망자", role: "citizen", alive: false },
  ]);
  game.secretChannels.mafiaId = "mafia-channel";
  game.secretChannels.loverId = "lover-channel";
  game.secretChannels.graveyardId = "graveyard-channel";

  const channels = {
    "mafia-channel": createFakeChannel(),
    "lover-channel": createFakeChannel(),
    "graveyard-channel": createFakeChannel(),
  };

  game["fetchSecretTextChannel"] = async (_client: Client, channelId?: string) => {
    if (!channelId) {
      return null;
    }
    return channels[channelId as keyof typeof channels] as any;
  };

  game.phase = "night";
  await game["syncSecretChannels"]({} as Client);

  assert.equal(channels["mafia-channel"].edits.get("dead")?.ViewChannel, true);
  assert.equal(channels["mafia-channel"].edits.get("dead")?.SendMessages, false);
  assert.equal(channels["lover-channel"].edits.get("dead")?.ViewChannel, true);
  assert.equal(channels["graveyard-channel"].edits.get("dead")?.ViewChannel, true);
  assert.equal(channels["graveyard-channel"].edits.get("dead")?.SendMessages, true);
  assert.equal(channels["graveyard-channel"].edits.get("medium")?.ViewChannel, true);
  assert.equal(channels["graveyard-channel"].edits.get("medium")?.SendMessages, true);

  game.phase = "discussion";
  await game["syncSecretChannels"]({} as Client);

  assert.equal(channels["mafia-channel"].edits.get("dead")?.ViewChannel, false);
  assert.equal(channels["lover-channel"].edits.get("dead")?.ViewChannel, false);
  assert.equal(channels["graveyard-channel"].edits.get("dead")?.ViewChannel, false);
  assert.equal(channels["graveyard-channel"].edits.get("medium")?.ViewChannel, false);
});

function createSelectInteraction(customId: string, userId: string, targetId: string) {
  return {
    customId,
    user: { id: userId },
    values: [targetId],
    updatedPayload: undefined as any,
    async update(payload: unknown) {
      this.updatedPayload = payload;
      return payload;
    },
  };
}

function createFakeChannel() {
  const edits = new Map<string, Record<string, boolean>>();
  return {
    edits,
    permissionOverwrites: {
      edit: async (userId: string, permissions: Record<string, boolean>) => {
        edits.set(userId, permissions);
      },
    },
  };
}
