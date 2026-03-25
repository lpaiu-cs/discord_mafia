import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageFlags,
  Partials,
  StringSelectMenuInteraction,
} from "discord.js";
import { config } from "./config";
import { buildDashboardReply, buildDashboardWaitingReply } from "./discord/dashboard";
import { mafiaCommand, registerCommands } from "./discord/commands";
import { GameManager, MafiaGame, createGame } from "./game/game";
import { Ruleset } from "./game/model";
import { DashboardAccessService } from "./web/access";
import { JoinTicketService } from "./web/join-ticket";
import { FixedBaseUrlProvider, QuickTunnelProvider } from "./web/public-base-url";
import { SessionStore } from "./web/session-store";
import { DashboardServer } from "./web/server";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

const endedGameCleanupTimers = new Map<string, NodeJS.Timeout>();
const manager = new GameManager((game) => {
  scheduleEndedGameCleanup(game);
});
const joinTicketService = new JoinTicketService(config.joinTicketSecret);
const sessionStore = new SessionStore(config.webSessionSecret);
const publicBaseUrlProvider =
  config.webMode === "quick_tunnel"
    ? new QuickTunnelProvider(config.webPort, config.quickTunnelEnabled)
    : new FixedBaseUrlProvider(config.publicBaseUrl);
const dashboardAccess = new DashboardAccessService(
  publicBaseUrlProvider,
  joinTicketService,
  config.joinTicketTtlSeconds * 1_000,
);
const dashboardServer = new DashboardServer({
  client,
  gameManager: manager,
  joinTicketService,
  sessionStore,
  port: config.webPort,
  secureCookies: config.secureCookies,
});

void dashboardServer.listen().then((port) => {
  console.log(`dashboard server listening on port ${port}`);
}).catch((error) => {
  console.error("failed to start dashboard server", error);
});

client.once(Events.ClientReady, async (readyClient) => {
  await registerCommands();
  console.log(`logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
      return;
    }
  } catch (error) {
    console.error(error);
    await replyError(interaction, error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.");
  }
});

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== mafiaCommand.name) {
    return;
  }

  if (!interaction.guildId) {
    throw new Error("서버 안에서만 사용할 수 있습니다.");
  }

  const subcommand = interaction.options.getSubcommand();
  let game = manager.get(interaction.guildId);

  switch (subcommand) {
    case "create": {
      if (game && game.phase !== "ended") {
        throw new Error("이 서버에는 이미 게임이 있습니다.");
      }

      if (game?.phase === "ended") {
        cancelEndedGameCleanup(game.id);
        await publicBaseUrlProvider.stop(game.id);
        sessionStore.invalidateGame(game.id);
        manager.delete(interaction.guildId);
      }

      const ruleset = (interaction.options.getString("ruleset") ?? config.ruleset) as Ruleset;
      game = createGame(manager, interaction, ruleset);
      await interaction.reply({ content: "로비를 만들었습니다.", flags: MessageFlags.Ephemeral });
      await game.sendOrUpdateLobby(client);
      return;
    }
    case "join": {
      if (!game) {
        throw new Error("현재 채널에 로비가 없습니다.");
      }
      assertGameChannel(interaction, game);

      await deferEphemeral(interaction);
      const member = await interaction.guild!.members.fetch(interaction.user.id);
      game.addPlayer(member);
      await game.sendOrUpdateLobby(client);
      await replyWithDashboardEntry(interaction, game);
      return;
    }
    case "leave": {
      if (!game) {
        throw new Error("현재 채널에 로비가 없습니다.");
      }
      assertGameChannel(interaction, game);

      await deferEphemeral(interaction);
      game.removePlayer(interaction.user.id);
      await game.sendOrUpdateLobby(client);
      await sendEphemeralReply(interaction, { content: "로비에서 나갔습니다." });
      return;
    }
    case "start": {
      if (!game) {
        throw new Error("현재 채널에 로비가 없습니다.");
      }
      assertGameChannel(interaction, game);

      if (interaction.user.id !== game.hostId) {
        throw new Error("게임 시작은 방장만 할 수 있습니다.");
      }

      await interaction.reply({
        content: "게임을 시작합니다. Discord는 로비만 담당하고 실제 진행은 웹 대시보드에서 이뤄집니다.",
        flags: MessageFlags.Ephemeral,
      });
      await game.start(client);
      return;
    }
    case "dashboard":
    case "rejoin": {
      if (!game) {
        throw new Error("현재 진행 중이거나 대기 중인 게임이 없습니다.");
      }

      if (!game.hasParticipant(interaction.user.id)) {
        throw new Error("현재 게임 참가자만 웹 대시보드 링크를 발급받을 수 있습니다.");
      }

      await replyWithDashboardEntry(interaction, game);
      return;
    }
    case "status": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }
      assertGameChannel(interaction, game);

      await deferEphemeral(interaction);
      if (game.phase === "lobby") {
        await game.sendOrUpdateLobby(client);
      } else {
        await game.sendOrUpdateStatus(client);
      }
      await sendEphemeralReply(interaction, { content: "현재 상태를 다시 표시했습니다." });
      return;
    }
    case "reveal": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }
      assertGameChannel(interaction, game);

      if (interaction.user.id !== game.hostId) {
        throw new Error("역할 공개는 방장만 볼 수 있습니다.");
      }

      await interaction.reply({ content: `\`\`\`\n${game.describeAssignments()}\n\`\`\``, flags: MessageFlags.Ephemeral });
      return;
    }
    case "advance": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }
      assertGameChannel(interaction, game);

      if (interaction.user.id !== game.hostId) {
        throw new Error("강제 진행은 방장만 할 수 있습니다.");
      }

      await interaction.reply({ content: "현재 단계를 넘깁니다.", flags: MessageFlags.Ephemeral });
      await game.forceAdvance(client);
      return;
    }
    case "end": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }
      assertGameChannel(interaction, game);

      if (interaction.user.id !== game.hostId) {
        throw new Error("게임 종료는 방장만 할 수 있습니다.");
      }

      await interaction.reply({ content: "게임을 종료합니다.", flags: MessageFlags.Ephemeral });
      await game.end(client, "방장이 게임을 종료했습니다.");
      return;
    }
    default:
      throw new Error("지원하지 않는 명령입니다.");
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [kind, gameId, tokenOrAction, value] = interaction.customId.split(":");
  const game = manager.findByGameId(gameId);
  if (!game) {
    throw new Error("게임을 찾을 수 없습니다.");
  }

  if (kind !== "dashboard") {
    assertGameChannel(interaction, game);
  }

  if (kind === "lobby") {
    await handleLobbyButton(interaction, gameId, tokenOrAction as "join" | "leave" | "start");
    return;
  }

  if (kind === "dashboard" && (tokenOrAction === "refresh" || tokenOrAction === "open")) {
    if (!game.hasParticipant(interaction.user.id)) {
      throw new Error("현재 게임 참가자만 새 링크를 발급받을 수 있습니다.");
    }

    await replyWithDashboardEntry(interaction, game, tokenOrAction);
    return;
  }

  if (kind === "trial") {
      await game.handleTrialVote(client, interaction, value as "yes" | "no");
      return;
  }

  if (kind === "time") {
    await game.handleTimeAdjust(client, interaction, value as "add" | "cut");
    return;
  }

  if (kind === "reporter") {
    await game.handleReporterPublish(client, interaction);
    return;
  }

  throw new Error("지원하지 않는 버튼입니다.");
}

async function handleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [kind, gameId] = interaction.customId.split(":");
  const game = manager.findByGameId(gameId);
  if (!game) {
    throw new Error("게임을 찾을 수 없습니다.");
  }

  assertGameChannel(interaction, game);

  if (kind === "vote") {
    await game.handleVoteSelect(client, interaction);
    return;
  }

  if (kind === "night" || kind === "aftermath" || kind === "madam" || kind === "terror") {
    await game.handleNightSelect(client, interaction);
    return;
  }

  throw new Error("지원하지 않는 선택 메뉴입니다.");
}

async function replyError(interaction: Interaction, message: string): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  try {
    if (interaction.inGuild()) {
      await sendEphemeralReply(interaction, { content: `오류: ${message}` });
      return;
    }

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `오류: ${message}` });
      return;
    }

    await interaction.reply({ content: `오류: ${message}` });
  } catch (replyError) {
    console.error("failed to send interaction error reply", replyError);
  }
}

void client.login(config.token);

async function replyWithDashboardLink(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  game: MafiaGame,
): Promise<void> {
  await deferEphemeral(interaction);
  const joinUrl = await dashboardAccess.issueJoinUrl(game.id, interaction.user.id);
  const payload = buildDashboardReply(game.id, joinUrl, config.joinTicketTtlSeconds);
  await sendEphemeralReply(interaction, payload);
}

async function replyWithDashboardEntry(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  game: MafiaGame,
  trigger: "open" | "refresh" | "join" | "command" = "command",
): Promise<void> {
  if (game.phase === "lobby") {
    await deferEphemeral(interaction);
    const note =
      trigger === "open"
        ? "아직 게임이 시작되지 않았습니다. 시작 후 같은 메시지에서 다시 누르세요."
        : trigger === "join"
          ? "이 메시지를 열어 둔 뒤 게임이 시작되면 바로 입장하세요."
          : "현재는 로비 단계입니다. 게임 시작 후 입장 링크를 받을 수 있습니다.";
    await sendEphemeralReply(interaction, buildDashboardWaitingReply(game.id, { note }));
    return;
  }

  await replyWithDashboardLink(interaction, game);
}

async function handleLobbyButton(
  interaction: ButtonInteraction,
  gameId: string,
  action: "join" | "leave" | "start",
): Promise<void> {
  const game = manager.findByGameId(gameId);
  if (!game) {
    throw new Error("게임을 찾을 수 없습니다.");
  }

  const guild = interaction.guild;
  if (!guild) {
    throw new Error("서버 안에서만 사용할 수 있습니다.");
  }

  await deferEphemeral(interaction);
  const member = await guild.members.fetch(interaction.user.id);

  if (action === "join") {
    game.addPlayer(member);
    await game.sendOrUpdateLobby(client);
    await replyWithDashboardEntry(interaction, game, "join");
    return;
  }

  if (action === "leave") {
    game.removePlayer(interaction.user.id);
    await game.sendOrUpdateLobby(client);
    await sendEphemeralReply(interaction, { content: "로비에서 나갔습니다." });
    return;
  }

  if (interaction.user.id !== game.hostId) {
    throw new Error("게임 시작은 방장만 할 수 있습니다.");
  }

  await sendEphemeralReply(interaction, { content: "게임을 시작합니다. 이제부터는 웹 대시보드에서 진행하세요." });
  await game.start(client);
}

async function deferEphemeral(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function sendEphemeralReply(
  interaction: ChatInputCommandInteraction | ButtonInteraction | Interaction,
  payload: InteractionReplyOptions,
): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.deferred) {
    await interaction.editReply(stripEphemeralFlags(payload));
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(withEphemeralFlag(payload));
    return;
  }

  await interaction.reply(withEphemeralFlag(payload));
}

function withEphemeralFlag(payload: InteractionReplyOptions): InteractionReplyOptions {
  return {
    ...payload,
    flags: MessageFlags.Ephemeral,
  };
}

function stripEphemeralFlags(payload: InteractionReplyOptions): InteractionEditReplyOptions {
  const { flags: _flags, ...rest } = payload;
  return rest;
}

function assertGameChannel(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  game: MafiaGame,
): void {
  if (!interaction.channelId || interaction.channelId !== game.channelId) {
    throw new Error("이 게임은 생성된 채널에서만 관리할 수 있습니다.");
  }
}

function scheduleEndedGameCleanup(game: MafiaGame): void {
  cancelEndedGameCleanup(game.id);
  const timeout = setTimeout(() => {
    endedGameCleanupTimers.delete(game.id);
    const current = manager.get(game.guildId);
    if (!current || current.id !== game.id || current.phase !== "ended") {
      return;
    }

    void publicBaseUrlProvider.stop(game.id).catch((error) => {
      console.error(`failed to stop public base url provider for ended game ${game.id}`, error);
    });
    sessionStore.invalidateGame(game.id);
    manager.delete(game.guildId);
  }, config.endedGameRetentionSeconds * 1_000);
  endedGameCleanupTimers.set(game.id, timeout);
}

function cancelEndedGameCleanup(gameId: string): void {
  const existing = endedGameCleanupTimers.get(gameId);
  if (!existing) {
    return;
  }

  clearTimeout(existing);
  endedGameCleanupTimers.delete(gameId);
}
