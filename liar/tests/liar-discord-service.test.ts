import assert from "node:assert/strict";
import { test } from "node:test";
import { LiarDiscordService } from "../src/discord/service";
import { LiarGame } from "../src/engine/game";

function createFakeChannel() {
  const sent: Array<{ content?: string; embeds?: any[]; components?: any[] }> = [];
  const edited: Array<{ content?: string; embeds?: any[]; components?: any[] }> = [];
  return {
    sent,
    edited,
    isTextBased() {
      return true;
    },
    async send(payload: { content?: string; embeds?: any[]; components?: any[] }) {
      sent.push(payload);
      return { id: `message-${sent.length}` };
    },
    messages: {
      async fetch() {
        return {
          async edit(payload: { content?: string; embeds?: any[]; components?: any[] }) {
            edited.push(payload);
          },
        };
      },
    },
  };
}

function createFakeMessage(overrides: Partial<any>) {
  const deleted = { value: false };
  const message = {
    author: { id: "host", bot: false, username: "방장" },
    member: { displayName: "방장" },
    channel: overrides.channel,
    channelId: "channel-1",
    content: "",
    guildId: "guild-1",
    mentions: { users: { size: 0, first: () => null } },
    inGuild() {
      return true;
    },
    async delete() {
      deleted.value = true;
    },
    ...overrides,
  };

  return { message, deleted };
}

function createFakeCommandInteraction(commandName: string, overrides: Partial<any> = {}) {
  const replies: Array<{ content: string; flags?: number }> = [];
  const interaction = {
    commandName,
    user: { id: "host", username: "방장" },
    options: {
      getSubcommand: () => null,
      getUser: () => null,
    },
    deferred: false,
    replied: false,
    isChatInputCommand() {
      return true;
    },
    async deferReply() {
      interaction.deferred = true;
    },
    async editReply(payload: { content: string; flags?: number }) {
      replies.push(payload);
    },
    async reply(payload: { content: string; flags?: number }) {
      replies.push(payload);
    },
    async followUp(payload: { content: string; flags?: number }) {
      replies.push(payload);
    },
    ...overrides,
  };

  return { interaction, replies };
}

function createFakeSelectInteraction(customId: string, overrides: Partial<any> = {}) {
  const replies: Array<{ content: string; flags?: number }> = [];
  const interaction = {
    customId,
    guildId: "guild-1",
    channelId: "channel-1",
    channel: overrides.channel,
    user: { id: "host", username: "방장" },
    values: [],
    deferred: false,
    replied: false,
    async reply(payload: { content: string; flags?: number }) {
      replies.push(payload);
    },
    async followUp(payload: { content: string; flags?: number }) {
      replies.push(payload);
    },
    ...overrides,
  };

  return { interaction, replies };
}

function createFakeButtonInteraction(customId: string, overrides: Partial<any> = {}) {
  const replies: Array<{ content: string; flags?: number }> = [];
  const interaction = {
    customId,
    guildId: "guild-1",
    guild: {
      members: {
        fetch: async () => ({ displayName: "방장" }),
      },
    },
    channelId: "channel-1",
    channel: overrides.channel,
    user: { id: "host", username: "방장" },
    deferred: false,
    replied: false,
    async reply(payload: { content: string; flags?: number }) {
      replies.push(payload);
    },
    async followUp(payload: { content: string; flags?: number }) {
      replies.push(payload);
    },
    ...overrides,
  };

  return { interaction, replies };
}

function createServiceWithGame() {
  const service = new LiarDiscordService() as any;
  const game = service.registry.create({
    guildId: "guild-1",
    guildName: "테스트 길드",
    channelId: "channel-1",
    hostId: "host",
    hostDisplayName: "방장",
    categoryId: "food",
  }) as LiarGame;
  game.addPlayer("p1", "민준");
  game.addPlayer("p2", "서윤");
  game.addPlayer("p3", "하준");
  return { service: service as LiarDiscordService, game };
}

function createServiceWithCallbacks() {
  const endedGames: string[] = [];
  const seenUsers: Array<{ discordUserId: string; displayName: string; discordGuildId: string; guildName: string }> = [];
  const service = new LiarDiscordService({
    onUserSeen: async (profile) => {
      seenUsers.push(profile);
    },
    onGameEnded: async (game) => {
      endedGames.push(game.id);
    },
  }) as any;

  const game = service.registry.create({
    guildId: "guild-1",
    guildName: "테스트 길드",
    channelId: "channel-1",
    hostId: "host",
    hostDisplayName: "방장",
    categoryId: "food",
  }) as LiarGame;
  game.addPlayer("p1", "민준");
  game.addPlayer("p2", "서윤");
  game.addPlayer("p3", "하준");
  return { service: service as LiarDiscordService, game, endedGames, seenUsers };
}

test("현재 차례 플레이어의 일반 메시지는 설명 제출로 처리된다", async () => {
  const { service, game } = createServiceWithGame();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  const currentSpeaker = game.getCurrentSpeaker()!;
  const { message } = createFakeMessage({
    author: { id: currentSpeaker.userId, bot: false, username: currentSpeaker.displayName },
    member: { displayName: currentSpeaker.displayName },
    channel,
    content: "첫 단서입니다",
  });

  const handled = await service.handleMessage(client, message as any);

  assert.equal(handled, true);
  assert.equal(game.clues.length, 1);
  assert.equal(game.clues[0].content, "첫 단서입니다");
  assert.ok(channel.sent.some((payload) => typeof payload.content === "string" && payload.content.includes("다음 차례")));
});

test("!투표 prefix 는 마지막 표에서 바로 집계까지 진행한다", async () => {
  const { service, game } = createServiceWithGame();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;

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
  const { message } = createFakeMessage({
    author: { id: "p3", bot: false, username: "하준" },
    member: { displayName: "하준" },
    channel,
    content: "!투표 <@host>",
    mentions: {
      users: {
        size: 1,
        first: () => ({ id: "host", username: "방장" }),
      },
    },
  });

  const handled = await service.handleMessage(client, message as any);

  assert.equal(handled, true);
  assert.equal(game.phase, "guess");
  assert.equal(game.accusedUserId, "host");
  assert.ok(channel.sent.some((payload) => typeof payload.content === "string" && payload.content.includes("라이어로 지목되었습니다")));
});

test("설명 단계에서 비차례 참가자의 메시지는 정리되고 안내된다", async () => {
  const { service, game } = createServiceWithGame();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  const currentSpeaker = game.getCurrentSpeaker()!;
  const intruderId = currentSpeaker.userId === "p1" ? "p2" : "p1";
  const intruder = game.getPlayer(intruderId)!;
  const { message, deleted } = createFakeMessage({
    author: { id: intruder.userId, bot: false, username: intruder.displayName },
    member: { displayName: intruder.displayName },
    channel,
    content: "제가 먼저 말할게요",
  });

  const handled = await service.handleMessage(client, message as any);

  assert.equal(handled, true);
  assert.equal(deleted.value, true);
  assert.equal(game.clues.length, 0);
  assert.ok(channel.sent.some((payload) => typeof payload.content === "string" && payload.content.includes("설명 차례입니다")));
});

test("게임 시작 뒤 참가자가 서버를 나가면 게임이 취소 종료된다", async () => {
  const { service, game } = createServiceWithGame();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);

  const handled = await service.handleMemberLeave(client, "guild-1", "p1");

  assert.equal(handled, true);
  assert.equal(game.phase, "ended");
  assert.equal(game.result?.winner, "cancelled");
  assert.match(game.result?.reason ?? "", /서버에서 나가 게임을 종료/);
  assert.ok(channel.sent.some((payload) => typeof payload.content === "string" && payload.content.includes("게임 종료")));
});

test("관전자 일반 메시지는 설명 단계에서 그대로 둔다", async () => {
  const { service, game } = createServiceWithGame();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;

  const rolls = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  game.start(() => rolls.shift() ?? 0);
  const { message, deleted } = createFakeMessage({
    author: { id: "spectator", bot: false, username: "구경꾼" },
    member: { displayName: "구경꾼" },
    channel,
    content: "관전자 채팅",
  });

  const handled = await service.handleMessage(client, message as any);

  assert.equal(handled, false);
  assert.equal(deleted.value, false);
  assert.equal(channel.sent.length, 0);
});

test("종료된 게임은 onGameEnded 콜백을 한 번만 호출한다", async () => {
  const { service, game, endedGames } = createServiceWithCallbacks();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;

  game.forceEnd("종료 테스트");
  await (service as any).resetPhaseState(client, game, channel);
  await (service as any).resetPhaseState(client, game, channel);

  assert.deepEqual(endedGames, [game.id]);
});

test("로비의 모드 버튼으로 modeB 를 고를 수 있다", async () => {
  const { service, game } = createServiceWithGame();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;
  const { interaction, replies } = createFakeButtonInteraction(`liar:modeB:${game.id}`, { channel });

  const handled = await service.handleButton(client, interaction as any);

  assert.equal(handled, true);
  assert.equal(game.mode, "modeB");
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /모드B/);
});

test("modeB 에서는 카테고리 선택 메뉴를 직접 사용할 수 없다", async () => {
  const { service, game } = createServiceWithGame();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;
  game.setMode("modeB");
  const { interaction } = createFakeSelectInteraction(`liar-category:${game.id}`, {
    channel,
    values: ["animal"],
  });

  await assert.rejects(() => service.handleSelect(client, interaction as any), /모드B에서는 카테고리를 직접 고르지 않습니다/);
});

test("modeA 일 때만 카테고리 선택 메뉴가 렌더링된다", async () => {
  const { service, game } = createServiceWithGame();
  const modeAComponents = (service as any).buildStatusPayload(game).components;
  assert.equal(modeAComponents.length, 3);

  game.setMode("modeB");
  const modeBComponents = (service as any).buildStatusPayload(game).components;
  assert.equal(modeBComponents.length, 2);
});

test("/liar create 는 새 로비 임베드 상태 메시지를 띄운다", async () => {
  const service = new LiarDiscordService();
  const channel = createFakeChannel();
  const client = { channels: { fetch: async () => channel } } as any;
  const { interaction, replies } = createFakeCommandInteraction("liar", {
    guildId: "guild-1",
    guild: {
      id: "guild-1",
      name: "테스트 길드",
      members: {
        fetch: async () => ({ displayName: "방장" }),
      },
    },
    channelId: "channel-1",
    channel,
    options: {
      getSubcommand: () => "create",
      getUser: () => null,
    },
  });

  const handled = await service.handleCommand(client, interaction as any);

  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /로비를 만들었습니다/);
  assert.ok(channel.sent.some((payload) => payload.embeds?.[0]?.data?.title === "라이어게임 로비"));
});

test("/liar stats 는 저장된 전적 요약을 ephemeral 로 보여준다", async () => {
  const service = new LiarDiscordService({
    loadStats: async () => ({
      discordUserId: "host",
      latestDisplayName: "방장",
      lifetime: {
        matchesPlayed: 8,
        cancelledMatches: 1,
        wins: 5,
        losses: 3,
        liarMatches: 3,
        citizenMatches: 5,
        liarWins: 2,
        citizenWins: 3,
      },
      streaks: {
        currentWinStreak: 2,
        bestWinStreak: 4,
      },
      categoryStats: [
        {
          categoryId: "food",
          categoryLabel: "음식",
          plays: 4,
          wins: 3,
          losses: 1,
        },
      ],
      recentMatches: [
        {
          mode: "modeA",
          guildName: "테스트 길드",
          categoryLabel: "음식",
          status: "completed",
          winner: "citizens",
          endedReason: "시민팀 승리",
          playerCount: 4,
          endedAt: new Date("2026-03-27T00:00:00.000Z"),
          wasLiar: false,
          wasAccused: true,
          isWinner: true,
        },
      ],
    }),
  });
  const { interaction, replies } = createFakeCommandInteraction("liar", {
    options: {
      getSubcommand: () => "stats",
      getUser: () => null,
    },
  });

  const handled = await service.handleCommand({} as any, interaction as any);

  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /완료 8판/);
  assert.match(replies[0].content, /연승: 현재 2연승/);
  assert.match(replies[0].content, /카테고리 전적/);
  assert.match(replies[0].content, /최근 경기/);
});
