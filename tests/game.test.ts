import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, Guild, GuildMember, StringSelectMenuInteraction } from "discord.js";
import { MafiaGame } from "../src/game/game";
import { PhaseContext, PlayerState, Role, Ruleset } from "../src/game/model";

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

test("성직자는 기존 시체가 아니라 이번 밤에 죽을 수 있는 생존자만 대상으로 잡고 영매는 생존자와 시체를 모두 고를 수 있다", () => {
  const game = createTestGame("balance");
  seedPlayers(game, [
    { userId: "priest", displayName: "성직자", role: "priest" },
    { userId: "medium", displayName: "영매", role: "medium" },
    { userId: "corpse", displayName: "망자", role: "citizen", alive: false },
    { userId: "alive", displayName: "생존자", role: "citizen" },
  ]);

  const priestPrompt = game["getNightPrompt"]("priest");
  const mediumPrompt = game["getNightPrompt"]("medium");

  assert.ok(priestPrompt);
  assert.ok(mediumPrompt);
  assert.deepEqual(new Set(priestPrompt?.targets), new Set(["priest", "medium", "alive"]));
  assert.ok(!priestPrompt?.targets.includes("corpse"));
  assert.ok(mediumPrompt?.targets.includes("corpse"));
  assert.ok(mediumPrompt?.targets.includes("alive"));
});

test("성직자는 같은 밤에 죽은 플레이어를 부활시키고 기존 시체에는 발동하지 않는다", async () => {
  const reviveGame = createTestGame("balance");
  seedPlayers(reviveGame, [
    { userId: "mafia", displayName: "마피아", role: "mafia" },
    { userId: "priest", displayName: "성직자", role: "priest" },
    { userId: "target", displayName: "시민", role: "citizen" },
  ]);
  reviveGame.phase = "night";
  setNightAction(reviveGame, "mafia", "mafiaKill", "target", 1);
  setNightAction(reviveGame, "priest", "priestRevive", "target", 2);

  const revived = await resolveNight(reviveGame);

  assert.equal(reviveGame.getPlayer("target")?.alive, true);
  assert.equal(reviveGame.getPlayer("priest")?.priestUsed, true);
  assert.ok(revived.summary.publicLines.some((line) => line.includes("성직자의 힘으로 부활했습니다.")));

  const staleCorpseGame = createTestGame("balance");
  seedPlayers(staleCorpseGame, [
    { userId: "priest", displayName: "성직자", role: "priest" },
    { userId: "corpse", displayName: "망자", role: "citizen", alive: false },
  ]);
  staleCorpseGame.phase = "night";
  setNightAction(staleCorpseGame, "priest", "priestRevive", "corpse", 1);

  const stale = await resolveNight(staleCorpseGame);

  assert.equal(staleCorpseGame.getPlayer("corpse")?.alive, false);
  assert.equal(staleCorpseGame.getPlayer("priest")?.priestUsed, false);
  assert.ok(stale.summary.privateLines.some((line) => line.userId === "priest" && line.line.includes("이번 밤에 사망하지 않아")));
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
