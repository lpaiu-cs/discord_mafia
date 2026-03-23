import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  Partials,
  StringSelectMenuInteraction,
} from "discord.js";
import { config } from "./config";
import { buildDashboardReply } from "./discord/dashboard";
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

const manager = new GameManager((game) => {
  void publicBaseUrlProvider.stop(game.id).catch((error) => {
    console.error(`failed to stop public base url provider for ended game ${game.id}`, error);
  });
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
        await publicBaseUrlProvider.stop(game.id);
        manager.delete(interaction.guildId);
      }

      const ruleset = (interaction.options.getString("ruleset") ?? config.ruleset) as Ruleset;
      game = createGame(manager, interaction, ruleset);
      await interaction.reply({ content: "로비를 만들었습니다.", ephemeral: true });
      await game.sendOrUpdateLobby(client);
      return;
    }
    case "join": {
      if (!game) {
        throw new Error("현재 채널에 로비가 없습니다.");
      }

      const member = await interaction.guild!.members.fetch(interaction.user.id);
      game.addPlayer(member);
      await game.sendOrUpdateLobby(client);
      await replyWithDashboardLink(interaction, game);
      return;
    }
    case "leave": {
      if (!game) {
        throw new Error("현재 채널에 로비가 없습니다.");
      }

      game.removePlayer(interaction.user.id);
      await game.sendOrUpdateLobby(client);
      await interaction.reply({ content: "로비에서 나갔습니다.", ephemeral: true });
      return;
    }
    case "start": {
      if (!game) {
        throw new Error("현재 채널에 로비가 없습니다.");
      }

      if (interaction.user.id !== game.hostId) {
        throw new Error("게임 시작은 방장만 할 수 있습니다.");
      }

      await interaction.reply({ content: "게임을 시작합니다. Discord는 로비만 담당하고 실제 진행은 웹 대시보드에서 이뤄집니다.", ephemeral: true });
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

      await replyWithDashboardLink(interaction, game);
      return;
    }
    case "status": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }

      if (game.phase === "lobby") {
        await game.sendOrUpdateLobby(client);
      } else {
        await game.sendOrUpdateStatus(client);
      }
      await interaction.reply({ content: "현재 상태를 다시 표시했습니다.", ephemeral: true });
      return;
    }
    case "reveal": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }

      if (interaction.user.id !== game.hostId) {
        throw new Error("역할 공개는 방장만 볼 수 있습니다.");
      }

      await interaction.reply({ content: `\`\`\`\n${game.describeAssignments()}\n\`\`\``, ephemeral: true });
      return;
    }
    case "advance": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }

      if (interaction.user.id !== game.hostId) {
        throw new Error("강제 진행은 방장만 할 수 있습니다.");
      }

      await interaction.reply({ content: "현재 단계를 넘깁니다.", ephemeral: true });
      await game.forceAdvance(client);
      return;
    }
    case "end": {
      if (!game) {
        throw new Error("현재 진행 중인 게임이 없습니다.");
      }

      if (interaction.user.id !== game.hostId) {
        throw new Error("게임 종료는 방장만 할 수 있습니다.");
      }

      await interaction.reply({ content: "게임을 종료합니다.", ephemeral: true });
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

  if (kind === "lobby") {
    await handleLobbyButton(interaction, gameId, tokenOrAction as "join" | "leave" | "start");
    return;
  }

  if (kind === "dashboard" && tokenOrAction === "refresh") {
    if (!game.hasParticipant(interaction.user.id)) {
      throw new Error("현재 게임 참가자만 새 링크를 발급받을 수 있습니다.");
    }

    await replyWithDashboardLink(interaction, game);
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

  const payload = interaction.inGuild()
    ? { content: `오류: ${message}`, ephemeral: true }
    : { content: `오류: ${message}` };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

void client.login(config.token);

async function replyWithDashboardLink(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  game: MafiaGame,
): Promise<void> {
  const joinUrl = await dashboardAccess.issueJoinUrl(game.id, interaction.user.id);
  const payload = buildDashboardReply(game.id, joinUrl, config.joinTicketTtlSeconds);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
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

  const member = await guild.members.fetch(interaction.user.id);

  if (action === "join") {
    game.addPlayer(member);
    await game.sendOrUpdateLobby(client);
    await replyWithDashboardLink(interaction, game);
    return;
  }

  if (action === "leave") {
    game.removePlayer(interaction.user.id);
    await game.sendOrUpdateLobby(client);
    await interaction.reply({ content: "로비에서 나갔습니다.", ephemeral: true });
    return;
  }

  if (interaction.user.id !== game.hostId) {
    throw new Error("게임 시작은 방장만 할 수 있습니다.");
  }

  await interaction.reply({ content: "게임을 시작합니다. 이제부터는 웹 대시보드에서 진행하세요.", ephemeral: true });
  await game.start(client);
}
