import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Channel,
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
  Guild,
  Message,
  MessageFlags,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextBasedChannel,
} from "discord.js";
import { getLiarCategories } from "../content/categories";
import { LiarGame, phaseLabel } from "../engine/game";
import { InMemoryLiarGameRegistry } from "../engine/registry";
import { LiarMode, LiarResult, LiarVoteResolution, liarModeLabel, liarModeSummary } from "../engine/model";
import { LiarAudioController, NoopLiarAudioController } from "./audio-broadcast";
import { LIAR_CREATE_SUBCOMMAND, LIAR_STATS_SUBCOMMAND, liarCommand, liarKeywordCommand } from "./commands";

const PREFIX_VOTE = "!투표";
const PREFIX_SKIP = "!스킵";
const LOBBY_TIMEOUT_MS = 10 * 60_000;
const CLUE_TIMEOUT_MS = 45_000;
const VOTING_TIMEOUT_MS = 45_000;
const GUESS_TIMEOUT_MS = 30_000;
const DEFAULT_WARNING_MS = 10_000;
const LOBBY_WARNING_MS = 60_000;
const GUIDANCE_COOLDOWN_MS = 7_000;

type LiarStatusPayload = {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: any[];
};

type LiarTextChannel = TextBasedChannel & {
  messages: {
    fetch: (messageId: string) => Promise<{ edit: (payload: LiarStatusPayload) => Promise<unknown> }>;
  };
  send: (payload: LiarStatusPayload) => Promise<{ id: string }>;
};

interface LiarDiscordServiceOptions {
  onUserSeen?: (profile: {
    discordUserId: string;
    displayName: string;
    discordGuildId: string;
    guildName: string;
  }) => Promise<void>;
  onGameEnded?: (game: LiarGame) => Promise<void>;
  loadStats?: (discordUserId: string) => Promise<LiarStatsSummary | null>;
  audioController?: LiarAudioController;
}

interface LiarStatsSummary {
  discordUserId: string;
  latestDisplayName: string;
  lifetime: {
    matchesPlayed: number;
    cancelledMatches: number;
    wins: number;
    losses: number;
    liarMatches: number;
    citizenMatches: number;
    liarWins: number;
    citizenWins: number;
  };
  streaks: {
    currentWinStreak: number;
    bestWinStreak: number;
  };
  categoryStats: Array<{
    categoryId: string;
    categoryLabel: string;
    plays: number;
    wins: number;
    losses: number;
  }>;
  recentMatches: Array<{
    mode: LiarMode;
    guildName: string | null;
    categoryLabel: string;
    status: "completed" | "cancelled";
    winner: "liar" | "citizens" | null;
    endedReason: string | null;
    playerCount: number;
    endedAt: Date;
    wasLiar: boolean;
    wasAccused: boolean;
    isWinner: boolean;
  }>;
}

export class LiarDiscordService {
  private readonly registry = new InMemoryLiarGameRegistry();
  private readonly phaseTimers = new Map<string, NodeJS.Timeout>();
  private readonly warningTimers = new Map<string, NodeJS.Timeout>();
  private readonly guidanceCooldowns = new Map<string, number>();
  private readonly persistedEndedGames = new Set<string>();
  private readonly discussionSkipVotes = new Map<string, Set<string>>();
  private readonly recentEndedGames = new Map<string, LiarGame>();
  private readonly audioController: LiarAudioController;

  constructor(private readonly options: LiarDiscordServiceOptions = {}) {
    this.audioController = options.audioController ?? new NoopLiarAudioController();
  }

  get commandDefinitions(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return [liarCommand.toJSON(), liarKeywordCommand.toJSON()];
  }

  async handleCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.commandName === liarKeywordCommand.name) {
      await this.handleKeywordCommand(interaction);
      return true;
    }

    if (interaction.commandName !== liarCommand.name) {
      return false;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === LIAR_STATS_SUBCOMMAND) {
      await this.handleStatsCommand(interaction);
      return true;
    }

    if (subcommand !== LIAR_CREATE_SUBCOMMAND) {
      throw new Error("지원하지 않는 라이어게임 명령입니다.");
    }

    if (!interaction.guildId || !interaction.guild) {
      throw new Error("서버 안에서만 사용할 수 있습니다.");
    }
    const guildId = interaction.guildId;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let game = this.registry.get(guildId);
    if (game && game.phase !== "ended") {
      throw new Error("이 서버에는 이미 라이어게임이 진행 중입니다.");
    }

    const endedGame = game?.phase === "ended" ? game : null;
    if (endedGame) {
      this.clearGameRuntimeState(endedGame.id);
      await this.safelyRunAudio(() => this.audioController.destroy(endedGame.guildId), endedGame.guildId);
      this.registry.delete(guildId);
    }
    this.forgetRecentEndedGame(guildId);

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const hostVoiceChannelId = member.voice.channelId ?? null;
    if (!hostVoiceChannelId) {
      throw new Error("라이어게임 로비를 만들려면 먼저 음성 채널에 들어가세요.");
    }

    await this.safelyRunAudio(() => this.audioController.destroy(guildId), guildId);
    await this.syncSeenUser(guildId, interaction.guild.name, interaction.user.id, member.displayName);

    let createdGame: LiarGame | null = null;
    try {
      game = this.registry.create({
        guildId,
        guildName: interaction.guild.name,
        channelId: interaction.channelId,
        hostId: interaction.user.id,
        hostDisplayName: member.displayName,
      });
      createdGame = game;

      await this.replyEphemeral(interaction, "라이어게임 로비를 만들었습니다.");
      await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild, hostVoiceChannelId);
      return true;
    } catch (error) {
      const failedGame = createdGame;
      if (failedGame && this.registry.get(guildId)?.id === failedGame.id) {
        this.clearGameRuntimeState(failedGame.id);
        await this.safelyRunAudio(() => this.audioController.destroy(failedGame.guildId), failedGame.guildId);
        this.registry.delete(guildId);
      }

      throw error;
    }
  }

  async handleButton(client: Client, interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith("liar:")) {
      return false;
    }

    if (!interaction.guildId || !interaction.guild) {
      throw new Error("서버 안에서만 사용할 수 있습니다.");
    }

    const [, action, gameId] = interaction.customId.split(":");
    if (action === "rematch") {
      const guildId = interaction.guildId;
      const endedGame = this.getRecentEndedGame(guildId, gameId);
      this.assertGameChannel(interaction.channelId, endedGame);
      this.assertHost(interaction.user.id, endedGame);

      if (this.registry.get(guildId)) {
        throw new Error("이 서버에는 이미 라이어게임이 진행 중입니다.");
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hostVoiceChannelId = member.voice.channelId ?? null;
      if (!hostVoiceChannelId) {
        throw new Error("리매치 로비를 만들려면 먼저 음성 채널에 들어가세요.");
      }

      await this.safelyRunAudio(() => this.audioController.destroy(guildId), guildId);
      await this.syncSeenUser(guildId, interaction.guild.name, interaction.user.id, member.displayName);

      const game = this.registry.create({
        guildId: endedGame.guildId,
        guildName: endedGame.guildName,
        channelId: endedGame.channelId,
        hostId: interaction.user.id,
        hostDisplayName: member.displayName,
        categoryId: endedGame.categoryId,
        mode: endedGame.mode,
      });
      this.forgetRecentEndedGame(guildId, endedGame.id);

      await this.replyEphemeral(interaction, "같은 설정으로 리매치 로비를 만들었습니다.");
      await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild, hostVoiceChannelId);
      return true;
    }

    const game = this.getActiveGame(interaction.guildId, gameId);
    this.assertGameChannel(interaction.channelId, game);

    switch (action) {
      case "join": {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        game.addPlayer(interaction.user.id, member.displayName);
        await this.syncSeenUser(game.guildId, game.guildName, interaction.user.id, member.displayName);
        await this.replyEphemeral(interaction, "라이어게임에 참가했습니다.");
        await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
        await this.safelyRunAudio(
          () =>
            this.audioController.playLobbyJoin(client, game, {
              guild: interaction.guild,
            }),
          game.guildId,
        );
        return true;
      }
      case "leave": {
        const previousHostId = game.hostId;
        game.removePlayer(interaction.user.id);
        await this.replyEphemeral(interaction, "라이어게임 로비에서 나갔습니다.");

        if (game.playerCount === 0) {
          game.forceEnd("참가자가 모두 나가 로비를 닫았습니다.");
          await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
          await this.sendPublicMessage(client, game, "참가자가 모두 나가 로비를 닫았습니다.", interaction.channel ?? null);
          return true;
        }

        await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
        if (previousHostId === interaction.user.id && game.hostId) {
          const newHost = game.getPlayer(game.hostId);
          await this.sendPublicMessage(client, game, `${newHost?.displayName ?? "다음 참가자"} 님이 새 방장이 되었습니다.`, interaction.channel ?? null);
        }
        return true;
      }
      case "modeA":
      case "modeB": {
        this.assertHost(interaction.user.id, game);
        game.setMode(action);
        await this.replyEphemeral(interaction, `규칙 모드를 ${liarModeLabel(game.mode)} 로 바꿨습니다.`);
        await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
        return true;
      }
      case "start": {
        this.assertHost(interaction.user.id, game);
        game.start(Math.random, {
          excludedWordsByCategoryId: this.buildExcludedWordsByCategoryId(game.guildId),
        });
        if (game.secretWord) {
          this.registry.recordUsedWord(game.guildId, game.categoryId, game.secretWord, game.category.words);
        }
        if (game.mode === "modeB" && game.liarAssignedCategoryId && game.liarAssignedWord) {
          const liarCategory = getLiarCategories(game.guildId).find((category) => category.id === game.liarAssignedCategoryId) ?? null;
          if (liarCategory) {
            this.registry.recordUsedWord(game.guildId, liarCategory.id, game.liarAssignedWord, liarCategory.words);
          }
        }
        await this.replyEphemeral(interaction, "라이어게임을 시작했습니다. 각 참가자는 `/제시어` 를 확인하세요.");
        await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
        await this.safelyRunAudio(
          () =>
            this.audioController.playGameStart(client, game, {
              guild: interaction.guild,
            }),
          game.guildId,
        );
        await this.safelyRunAudio(
          () =>
            this.audioController.playTurnCue(client, game, {
              guild: interaction.guild,
            }),
          game.guildId,
        );
        await this.sendPublicMessage(
          client,
          game,
          [
            game.mode === "modeA"
              ? `라이어게임이 시작되었습니다. 카테고리는 ${game.category.label} 입니다.`
              : "라이어게임이 시작되었습니다. 이번 판은 크로스 카테고리 모드로 진행됩니다.",
            `규칙 모드: ${liarModeLabel(game.mode)} (${liarModeSummary(game.mode)})`,
            "각 참가자는 `/제시어` 로 자기 정보를 확인하세요.",
            "설명은 차례가 된 사람이 채널에 일반 메시지로 한 줄만 입력하면 됩니다.",
            "설명 순서:",
            game.describeTurnOrder(),
            `첫 차례는 ${game.getCurrentSpeaker()?.displayName ?? "알 수 없음"} 님입니다.`,
          ].join("\n"),
          interaction.channel ?? null,
        );
        return true;
      }
      case "begin-vote": {
        this.assertHost(interaction.user.id, game);
        game.beginVote();
        await this.replyEphemeral(interaction, "투표를 시작했습니다.");
        await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
        await this.sendPublicMessage(
          client,
          game,
          "투표를 시작합니다. 각 참가자는 상태 카드의 선택 메뉴 또는 `!투표 @대상` 형식으로 한 번만 투표하세요.",
          interaction.channel ?? null,
        );
        return true;
      }
      case "end": {
        this.assertHost(interaction.user.id, game);
        const result = game.forceEnd("방장이 게임을 종료했습니다.");
        await this.replyEphemeral(interaction, "라이어게임을 종료했습니다.");
        await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
        await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, result), interaction.channel ?? null);
        return true;
      }
      case "tally": {
        this.assertHost(interaction.user.id, game);
        const resolution = game.tallyVotes();
        await this.replyEphemeral(interaction, "현재까지의 투표를 집계했습니다.");
        await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild);
        await this.announceVoteResolution(client, game, resolution, interaction.channel ?? null);
        return true;
      }
      default:
        throw new Error("지원하지 않는 라이어게임 버튼입니다.");
    }
  }

  async handleSelect(client: Client, interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith("liar-category:") && !interaction.customId.startsWith("liar-vote:")) {
      return false;
    }

    if (!interaction.guildId) {
      throw new Error("서버 안에서만 사용할 수 있습니다.");
    }

    const [kind, gameId] = interaction.customId.split(":");
    const game = this.getActiveGame(interaction.guildId, gameId);
    this.assertGameChannel(interaction.channelId, game);

    if (kind === "liar-vote") {
      if (game.phase !== "voting") {
        throw new Error("지금은 투표 단계가 아닙니다.");
      }

      if (!game.isParticipant(interaction.user.id)) {
        throw new Error("현재 라이어게임 참가자만 투표할 수 있습니다.");
      }

      const targetId = interaction.values[0];
      const targetPlayer = game.getPlayer(targetId);
      if (!targetPlayer) {
        throw new Error("투표 대상을 찾을 수 없습니다.");
      }

      await this.submitVote(client, game, interaction.user.id, targetId, interaction.channel ?? null);
      await this.replyEphemeral(interaction, `${targetPlayer.displayName} 님에게 투표했습니다.`);
      return true;
    }

    this.assertHost(interaction.user.id, game);

    if (game.mode === "modeB") {
      throw new Error("모드B에서는 카테고리를 직접 고르지 않습니다.");
    }

    game.setCategory(interaction.values[0]);
    await this.replyEphemeral(interaction, `카테고리를 ${game.category.label} 로 바꿨습니다.`);
    await this.resetPhaseState(client, game, interaction.channel ?? null, interaction.guild ?? null);
    return true;
  }

  async handleMemberLeave(client: Client, guildId: string, userId: string): Promise<boolean> {
    const game = this.registry.get(guildId);
    if (!game || !game.isParticipant(userId) || game.phase === "ended") {
      return false;
    }

    const player = game.getPlayer(userId);
    if (game.phase === "lobby") {
      const previousHostId = game.hostId;
      game.removePlayer(userId);

      if (game.playerCount === 0) {
        const result = game.forceEnd("참가자가 모두 나가 로비를 닫았습니다.");
        await this.resetPhaseState(client, game);
        await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, result));
        return true;
      }

      await this.resetPhaseState(client, game);
      const lines = [`${player?.displayName ?? "참가자"} 님이 서버에서 나가 로비에서 제외되었습니다.`];
      if (previousHostId === userId && game.hostId) {
        const nextHost = game.getPlayer(game.hostId);
        lines.push(`${nextHost?.displayName ?? "다음 참가자"} 님이 새 방장이 되었습니다.`);
      }
      await this.sendPublicMessage(client, game, lines.join("\n"));
      return true;
    }

    const result = game.forceEnd(`${player?.displayName ?? "참가자"} 님이 서버에서 나가 게임을 종료했습니다.`);
    await this.resetPhaseState(client, game);
    await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, result));
    return true;
  }

  async handleVoiceStateUpdate(client: Client, guildId: string, userId: string, channelId: string | null): Promise<boolean> {
    const game = this.registry.get(guildId);
    if (!game || game.phase === "ended" || game.hostId !== userId) {
      return false;
    }

    await this.safelyRunAudio(
      () =>
        this.audioController.syncPhase(client, game, {
          hostVoiceChannelId: channelId,
        }),
      game.guildId,
    );
    return true;
  }

  async handleMessage(client: Client, message: Message): Promise<boolean> {
    if (!message.inGuild() || message.author.bot) {
      return false;
    }

    const game = this.registry.get(message.guildId);
    if (!game || message.channelId !== game.channelId) {
      return false;
    }

    const content = message.content.trim();
    if (!content) {
      return false;
    }

    if (content.startsWith(PREFIX_VOTE)) {
      await this.handleVoteMessage(client, message, game);
      return true;
    }

    if (content === PREFIX_SKIP) {
      await this.handleDiscussionSkipMessage(client, message, game);
      return true;
    }

    if (!game.isParticipant(message.author.id)) {
      return false;
    }

    if (game.phase === "clue") {
      const currentSpeaker = game.getCurrentSpeaker();
      if (!currentSpeaker || currentSpeaker.userId !== message.author.id) {
        await this.suppressParticipantMessage(message);
        await this.sendGuidanceMessage(
          client,
          game,
          message.author.id,
          `지금은 ${currentSpeaker?.displayName ?? "현재 차례 플레이어"} 님의 설명 차례입니다.`,
          `clue:${message.author.id}`,
          message.channel,
        );
        return true;
      }

      const result = game.submitClue(message.author.id, content);
      await this.resetPhaseState(client, game, message.channel);

      if (result.phaseChanged) {
        await this.sendPublicMessage(
          client,
          game,
          `모든 참가자의 설명이 끝났습니다. 이제 ${this.getDiscussionDurationSeconds(game)}초 동안 자유 토론이 진행되고, 시간이 끝나면 자동으로 투표가 시작됩니다.`,
          message.channel,
        );
      } else {
        const nextSpeaker = result.nextSpeakerId ? game.getPlayer(result.nextSpeakerId) : null;
        await this.safelyRunAudio(() => this.audioController.playTurnCue(client, game), game.guildId);
        await this.sendPublicMessage(client, game, `다음 차례는 ${nextSpeaker?.displayName ?? "알 수 없음"} 님입니다.`, message.channel);
      }
      return true;
    }

    if (game.phase === "voting" && game.isParticipant(message.author.id)) {
      await this.suppressParticipantMessage(message);
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        "지금은 투표 단계입니다. 상태 카드의 선택 메뉴 또는 `!투표 @대상` 형식을 사용하세요.",
        `voting:${message.author.id}`,
        message.channel,
      );
      return true;
    }

    if (game.phase === "guess") {
      if (message.author.id !== game.liarId) {
        const liar = game.liarId ? game.getPlayer(game.liarId) : null;
        await this.suppressParticipantMessage(message);
        await this.sendGuidanceMessage(
          client,
          game,
          message.author.id,
          `지금은 ${liar?.displayName ?? "지목된 라이어"} 님만 정답을 입력할 수 있습니다.`,
          `guess:${message.author.id}`,
          message.channel,
        );
        return true;
      }

      const result = game.guessWord(message.author.id, content);
      await this.resetPhaseState(client, game, message.channel);
      await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, result), message.channel);
      return true;
    }

    return false;
  }

  private async handleKeywordCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      throw new Error("서버 안에서만 사용할 수 있습니다.");
    }

    const game = this.registry.get(interaction.guildId);
    if (!game) {
      throw new Error("현재 진행 중인 라이어게임이 없습니다.");
    }

    const keywordView = game.getKeywordView(interaction.user.id);
    await this.replyEphemeral(interaction, {
      embeds: [this.buildKeywordEmbed(game, interaction.user.id, keywordView)],
    });
  }

  private async handleStatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.options.loadStats) {
      throw new Error("현재 라이어 전적 조회를 사용할 수 없습니다.");
    }

    const targetUser = interaction.options.getUser("target");
    const targetUserId = targetUser?.id ?? interaction.user.id;
    const stats = await this.options.loadStats(targetUserId);

    if (!stats || (stats.lifetime.matchesPlayed === 0 && stats.lifetime.cancelledMatches === 0)) {
      await this.replyEphemeral(interaction, `${targetUser?.username ?? interaction.user.username} 님의 라이어 전적이 아직 없습니다.`);
      return;
    }

    await this.replyEphemeral(interaction, this.buildStatsMessage(stats));
  }

  private async handleVoteMessage(client: Client, message: Message, game: LiarGame): Promise<void> {
    if (game.phase !== "voting") {
      await this.sendGuidanceMessage(client, game, message.author.id, "지금은 투표 단계가 아닙니다.", `vote:${message.author.id}`, message.channel);
      return;
    }

    if (!game.isParticipant(message.author.id)) {
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        "현재 라이어게임 참가자만 투표할 수 있습니다.",
        `vote:${message.author.id}`,
        message.channel,
      );
      return;
    }

    if (message.mentions.users.size !== 1) {
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        "`!투표 @대상` 형식으로 한 명만 지목하세요.",
        `vote:${message.author.id}`,
        message.channel,
      );
      return;
    }

    const target = message.mentions.users.first();
    if (!target) {
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        "투표 대상을 찾을 수 없습니다.",
        `vote:${message.author.id}`,
        message.channel,
      );
      return;
    }

    try {
      await this.submitVote(client, game, message.author.id, target.id, message.channel);
    } catch (error) {
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        error instanceof Error ? error.message : "투표를 처리하지 못했습니다.",
        `vote:${message.author.id}`,
        message.channel,
      );
      return;
    }

    return;
  }

  private async handleDiscussionSkipMessage(client: Client, message: Message, game: LiarGame): Promise<void> {
    if (game.phase !== "discussion") {
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        "지금은 자유 토론 단계가 아닙니다.",
        `skip:${message.author.id}`,
        message.channel,
      );
      return;
    }

    if (!game.isParticipant(message.author.id)) {
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        "현재 라이어게임 참가자만 `!스킵` 으로 토론 조기 종료에 동의할 수 있습니다.",
        `skip:${message.author.id}`,
        message.channel,
      );
      return;
    }

    const voters = this.getDiscussionSkipVotes(game.id);
    if (voters.has(message.author.id)) {
      await this.sendGuidanceMessage(
        client,
        game,
        message.author.id,
        "이미 토론 스킵에 동의했습니다.",
        `skip-duplicate:${message.author.id}`,
        message.channel,
      );
      return;
    }

    voters.add(message.author.id);
    const threshold = this.getDiscussionSkipThreshold(game.playerCount);
    const voter = game.getPlayer(message.author.id);

    if (voters.size >= threshold) {
      game.beginVote();
      await this.resetPhaseState(client, game, message.channel);
      await this.sendPublicMessage(
        client,
        game,
        `${voter?.displayName ?? message.member?.displayName ?? message.author.username} 님의 동의로 토론 스킵이 과반(${voters.size}/${game.playerCount})에 도달했습니다. 이제 \`!투표 @대상\` 형식으로 투표하세요.`,
        message.channel,
      );
      return;
    }

    await this.syncStatusMessage(client, game, message.channel);
    await this.sendPublicMessage(
      client,
      game,
      `${voter?.displayName ?? message.member?.displayName ?? message.author.username} 님이 토론 스킵에 동의했습니다. (${voters.size}/${threshold})`,
      message.channel,
    );
  }

  private async submitVote(
    client: Client,
    game: LiarGame,
    voterId: string,
    targetId: string,
    preferredChannel: Channel | null = null,
  ): Promise<void> {
    const voteResult = game.submitVote(voterId, targetId);
    const voter = game.getPlayer(voterId);
    const targetPlayer = game.getPlayer(targetId);

    await this.sendPublicMessage(
      client,
      game,
      `${voter?.displayName ?? voterId} 님이 ${targetPlayer?.displayName ?? targetId} 님에게 투표했습니다. (${voteResult.progress}/${game.playerCount})`,
      preferredChannel,
    );

    if (voteResult.completed && voteResult.resolution) {
      await this.resetPhaseState(client, game, preferredChannel);
      await this.announceVoteResolution(client, game, voteResult.resolution, preferredChannel);
      return;
    }

    await this.syncStatusMessage(client, game, preferredChannel);
  }

  private getActiveGame(guildId: string, gameId: string): LiarGame {
    const game = this.registry.get(guildId);
    if (!game || game.id !== gameId) {
      throw new Error("더 이상 유효하지 않은 라이어게임 컨트롤입니다.");
    }

    return game;
  }

  private getRecentEndedGame(guildId: string, gameId: string): LiarGame {
    const game = this.recentEndedGames.get(guildId);
    if (!game || game.id !== gameId || game.phase !== "ended") {
      throw new Error("더 이상 유효하지 않은 리매치 컨트롤입니다.");
    }

    return game;
  }

  private getDiscussionSkipVotes(gameId: string): Set<string> {
    let votes = this.discussionSkipVotes.get(gameId);
    if (!votes) {
      votes = new Set<string>();
      this.discussionSkipVotes.set(gameId, votes);
    }

    return votes;
  }

  private async resetPhaseState(
    client: Client,
    game: LiarGame,
    preferredChannel: Channel | null = null,
    preferredGuild: Guild | null = null,
    preferredHostVoiceChannelId: string | null | undefined = undefined,
  ): Promise<void> {
    const shouldDeleteAfterSync = game.phase === "ended";
    if (game.phase !== "discussion") {
      this.discussionSkipVotes.delete(game.id);
    }

    if (shouldDeleteAfterSync) {
      this.clearGuidanceCooldowns(game.id);
      await this.persistEndedGame(game);
      this.rememberRecentEndedGame(game);
    }
    this.schedulePhaseAutomation(client, game);
    await this.safelyRunAudio(
      () =>
        this.audioController.syncPhase(client, game, {
          guild: preferredGuild,
          hostVoiceChannelId: preferredHostVoiceChannelId,
        }),
      game.guildId,
    );
    await this.syncStatusMessage(client, game, preferredChannel);

    if (shouldDeleteAfterSync && game.result?.winner === "cancelled") {
      await this.safelyRunAudio(() => this.audioController.destroy(game.guildId), game.guildId);
    }

    if (shouldDeleteAfterSync && this.registry.get(game.guildId)?.id === game.id) {
      this.registry.delete(game.guildId);
    }
  }

  private schedulePhaseAutomation(client: Client, game: LiarGame): void {
    this.clearPhaseAutomation(game.id);

    const durationMs = this.getPhaseDurationMs(game);
    if (!durationMs || game.phase === "ended") {
      game.setPhaseDeadline(null);
      return;
    }

    const deadlineAt = Date.now() + durationMs;
    game.setPhaseDeadline(deadlineAt);

    const timeout = setTimeout(() => {
      void this.handlePhaseTimeout(client, game.guildId, game.id);
    }, durationMs);
    timeout.unref?.();
    this.phaseTimers.set(game.id, timeout);

    const warningLeadMs = this.getWarningLeadMs(game.phase, durationMs);
    if (warningLeadMs === null || durationMs <= warningLeadMs) {
      return;
    }

    const warningTimeout = setTimeout(() => {
      void this.handlePhaseWarning(client, game.guildId, game.id);
    }, durationMs - warningLeadMs);
    warningTimeout.unref?.();
    this.warningTimers.set(game.id, warningTimeout);
  }

  private clearPhaseAutomation(gameId: string): void {
    const phaseTimer = this.phaseTimers.get(gameId);
    if (phaseTimer) {
      clearTimeout(phaseTimer);
      this.phaseTimers.delete(gameId);
    }

    const warningTimer = this.warningTimers.get(gameId);
    if (warningTimer) {
      clearTimeout(warningTimer);
      this.warningTimers.delete(gameId);
    }
  }

  private clearGuidanceCooldowns(gameId: string): void {
    for (const key of [...this.guidanceCooldowns.keys()]) {
      if (key.startsWith(`${gameId}:`)) {
        this.guidanceCooldowns.delete(key);
      }
    }
  }

  private clearGameRuntimeState(gameId: string): void {
    this.clearPhaseAutomation(gameId);
    this.clearGuidanceCooldowns(gameId);
    this.discussionSkipVotes.delete(gameId);
    this.persistedEndedGames.delete(gameId);
  }

  private rememberRecentEndedGame(game: LiarGame): void {
    const previous = this.recentEndedGames.get(game.guildId);
    if (previous && previous.id !== game.id) {
      this.clearGameRuntimeState(previous.id);
    }

    this.recentEndedGames.set(game.guildId, game);
  }

  private forgetRecentEndedGame(guildId: string, gameId?: string): void {
    const existing = this.recentEndedGames.get(guildId);
    if (!existing) {
      return;
    }

    if (gameId && existing.id !== gameId) {
      return;
    }

    this.clearGameRuntimeState(existing.id);
    this.recentEndedGames.delete(guildId);
  }

  private async handlePhaseWarning(client: Client, guildId: string, gameId: string): Promise<void> {
    const game = this.registry.get(guildId);
    if (!game || game.id !== gameId || game.phase === "ended") {
      return;
    }

    const warning = this.buildPhaseWarning(game);
    if (!warning) {
      return;
    }

    await this.syncStatusMessage(client, game);
    await this.sendPublicMessage(client, game, warning);
  }

  private async handlePhaseTimeout(client: Client, guildId: string, gameId: string): Promise<void> {
    const game = this.registry.get(guildId);
    if (!game || game.id !== gameId || game.phase === "ended") {
      return;
    }

    switch (game.phase) {
      case "lobby": {
        const result = game.forceEnd("로비 대기 시간이 지나 게임을 닫았습니다.");
        await this.resetPhaseState(client, game);
        await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, result));
        return;
      }
      case "clue": {
        const skipped = game.skipCurrentSpeaker();
        const skippedPlayer = skipped.skippedSpeakerId ? game.getPlayer(skipped.skippedSpeakerId) : null;
        await this.resetPhaseState(client, game);

        if (skipped.phaseChanged) {
          await this.sendPublicMessage(
            client,
            game,
            `${skippedPlayer?.displayName ?? "현재 차례 플레이어"} 님의 설명 시간이 끝났습니다. 모든 차례가 지나 자유 토론을 시작합니다. ${this.getDiscussionDurationSeconds(game)}초 뒤 자동으로 투표가 시작됩니다.`,
          );
          return;
        }

        const nextSpeaker = skipped.nextSpeakerId ? game.getPlayer(skipped.nextSpeakerId) : null;
        await this.safelyRunAudio(() => this.audioController.playTurnCue(client, game), game.guildId);
        await this.sendPublicMessage(
          client,
          game,
          `${skippedPlayer?.displayName ?? "현재 차례 플레이어"} 님의 설명 시간이 끝나 차례를 넘깁니다. 다음 차례는 ${nextSpeaker?.displayName ?? "알 수 없음"} 님입니다.`,
        );
        return;
      }
      case "discussion": {
        game.beginVote();
        await this.resetPhaseState(client, game);
        await this.sendPublicMessage(client, game, "토론 시간이 끝났습니다. 이제 `!투표 @대상` 형식으로 투표하세요.");
        return;
      }
      case "voting": {
        const resolution = game.resolveVotingTimeout();
        await this.resetPhaseState(client, game);
        await this.announceVoteResolution(client, game, resolution);
        return;
      }
      case "guess": {
        const result = game.resolveGuessTimeout();
        await this.resetPhaseState(client, game);
        await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, result));
        return;
      }
      default:
        return;
    }
  }

  private getPhaseDurationMs(game: LiarGame): number | null {
    switch (game.phase) {
      case "lobby":
        return LOBBY_TIMEOUT_MS;
      case "clue":
        return CLUE_TIMEOUT_MS;
      case "discussion":
        return Math.max(60_000, Math.min(120_000, game.playerCount * 15_000));
      case "voting":
        return VOTING_TIMEOUT_MS;
      case "guess":
        return GUESS_TIMEOUT_MS;
      default:
        return null;
    }
  }

  private getWarningLeadMs(phase: LiarGame["phase"], durationMs: number): number | null {
    if (phase === "ended") {
      return null;
    }

    if (phase === "lobby") {
      return durationMs > LOBBY_WARNING_MS ? LOBBY_WARNING_MS : null;
    }

    return durationMs > DEFAULT_WARNING_MS ? DEFAULT_WARNING_MS : null;
  }

  private getDiscussionDurationSeconds(game: LiarGame): number {
    return Math.floor(Math.max(60_000, Math.min(120_000, game.playerCount * 15_000)) / 1_000);
  }

  private getDiscussionSkipThreshold(playerCount: number): number {
    return Math.floor(playerCount / 2) + 1;
  }

  private buildPhaseWarning(game: LiarGame): string | null {
    switch (game.phase) {
      case "lobby":
        return "로비가 1분 뒤 자동으로 닫힙니다.";
      case "clue": {
        const speaker = game.getCurrentSpeaker();
        return `${speaker?.displayName ?? "현재 차례 플레이어"} 님의 설명 시간이 10초 남았습니다.`;
      }
      case "discussion":
        return "토론 종료까지 10초 남았습니다.";
      case "voting":
        return "투표 종료까지 10초 남았습니다.";
      case "guess": {
        const liar = game.liarId ? game.getPlayer(game.liarId) : null;
        return `${liar?.displayName ?? "라이어"} 님의 정답 입력 시간이 10초 남았습니다.`;
      }
      default:
        return null;
    }
  }

  private buildStatusPayload(game: LiarGame): LiarStatusPayload {
    return {
      embeds: [this.buildStatusEmbed(game)],
      components: this.buildStatusComponents(game),
    };
  }

  private buildStatusEmbed(game: LiarGame): EmbedBuilder {
    const descriptionLines = [
      `상태: ${phaseLabel(game.phase)}`,
      `규칙 모드: ${liarModeLabel(game.mode)}`,
      `카테고리: ${game.describePublicCategory()}`,
      game.phase === "ended" && game.endedAt
        ? `종료: <t:${Math.floor(game.endedAt / 1_000)}:R>`
        : game.phaseDeadlineAt
          ? `마감: <t:${Math.floor(game.phaseDeadlineAt / 1_000)}:R>`
          : undefined,
    ].filter((line): line is string => Boolean(line));

    const fields =
      game.phase === "ended"
        ? [
            {
              name: "결과 요약",
              value: this.buildEndedSummaryFieldValue(game),
            },
            {
              name: "공개 정보",
              value: this.buildEndedRevealFieldValue(game),
            },
            {
              name: `참가자 (${game.playerCount}/8)`,
              value: this.buildEndedParticipantsFieldValue(game),
              inline: true,
            },
            {
              name: "투표 요약",
              value: this.buildVoteSummaryFieldValue(game),
              inline: true,
            },
            {
              name: "다음 단계",
              value: this.buildEndedGuideFieldValue(game),
            },
          ]
        : game.phase === "lobby"
        ? [
            {
              name: "참가 현황",
              value: this.buildParticipantsFieldValue(game),
            },
            {
              name: "지금 할 일",
              value: this.buildCurrentActionFieldValue(game),
            },
            {
              name: "진행 요약",
              value: this.buildPhaseProgressFieldValue(game),
            },
          ]
        : [
            {
              name: "참가 현황",
              value: this.buildParticipantsFieldValue(game),
              inline: true,
            },
            {
              name: "진행 요약",
              value: this.buildPhaseProgressFieldValue(game),
              inline: true,
            },
            {
              name: "지금 할 일",
              value: this.buildCurrentActionFieldValue(game),
            },
          ];

    return new EmbedBuilder()
      .setColor(this.getStatusColor(game))
      .setTitle(game.phase === "lobby" ? "라이어게임 로비" : game.phase === "ended" ? "라이어게임 결과" : "라이어게임")
      .setDescription(descriptionLines.join("\n"))
      .addFields(fields)
      .setFooter({ text: `게임 ID: ${game.id}` });
  }

  private buildStatusComponents(game: LiarGame): any[] {
    if (game.phase === "ended") {
      return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`liar:rematch:${game.id}`).setLabel("리매치").setStyle(ButtonStyle.Success),
        ),
      ];
    }

    const rows: any[] = [];
    const controlRow = new ActionRowBuilder<ButtonBuilder>();

    if (game.phase === "lobby") {
      const cannotStartReason = game.getStartConfigurationError();
      controlRow.addComponents(
        new ButtonBuilder().setCustomId(`liar:join:${game.id}`).setLabel("참가").setStyle(ButtonStyle.Success).setDisabled(game.playerCount >= 8),
        new ButtonBuilder().setCustomId(`liar:leave:${game.id}`).setLabel("나가기").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`liar:start:${game.id}`)
          .setLabel("시작")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(game.playerCount < 4 || Boolean(cannotStartReason)),
        new ButtonBuilder().setCustomId(`liar:end:${game.id}`).setLabel("종료").setStyle(ButtonStyle.Danger),
      );
      rows.push(controlRow);

      const modeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`liar:modeA:${game.id}`)
          .setLabel("모드A")
          .setStyle(game.mode === "modeA" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`liar:modeB:${game.id}`)
          .setLabel("모드B")
          .setStyle(game.mode === "modeB" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      );
      rows.push(modeRow);

      if (game.mode === "modeA") {
        const categoryRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`liar-category:${game.id}`)
            .setPlaceholder(`카테고리 선택 (현재: ${game.category.label})`)
            .addOptions(
              getLiarCategories(game.guildId)
                .filter((category) => category.modes.modeA && category.wordsMeta.some((word) => word.modeAAllowed))
                .map((category) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(category.label)
                  .setValue(category.id)
                  .setDefault(category.id === game.categoryId),
              ),
            ),
        );
        rows.push(categoryRow);
      }
      return rows;
    }

    if (game.phase === "discussion") {
      controlRow.addComponents(
        new ButtonBuilder().setCustomId(`liar:begin-vote:${game.id}`).setLabel("지금 투표 시작").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`liar:end:${game.id}`).setLabel("종료").setStyle(ButtonStyle.Danger),
      );
      rows.push(controlRow);
      return rows;
    }

    if (game.phase === "voting") {
      const voteSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`liar-vote:${game.id}`)
          .setPlaceholder("투표 대상 선택")
          .addOptions(
            [...game.players.values()]
              .sort((left, right) => left.joinedAt - right.joinedAt)
              .map((player) => new StringSelectMenuOptionBuilder().setLabel(player.displayName).setValue(player.userId)),
          ),
      );
      rows.push(voteSelectRow);

      controlRow.addComponents(
        new ButtonBuilder().setCustomId(`liar:tally:${game.id}`).setLabel("지금 집계").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`liar:end:${game.id}`).setLabel("종료").setStyle(ButtonStyle.Danger),
      );
      rows.push(controlRow);
      return rows;
    }

    controlRow.addComponents(
      new ButtonBuilder().setCustomId(`liar:end:${game.id}`).setLabel("종료").setStyle(ButtonStyle.Danger),
    );
    rows.push(controlRow);
    return rows;
  }

  private buildResultAnnouncement(game: LiarGame, result: LiarResult): string {
    const title =
      result.winner === "citizens"
        ? "시민팀 승리"
        : result.winner === "liar"
          ? "라이어 승리"
          : "게임 종료";
    const modeLine = `규칙 모드: ${liarModeLabel(game.mode)}`;
    const categoryLine =
      game.mode === "modeB"
        ? `카테고리: 시민 ${game.category.label}${game.liarAssignedCategoryLabel ? ` · 라이어 ${game.liarAssignedCategoryLabel}` : ""}`
        : `카테고리: ${game.category.label}`;
    const wordLine = game.secretWord ? `정답 제시어: ${game.secretWord}` : null;
    const liarAssignedWordLine =
      game.mode === "modeB" && game.liarAssignedWord ? `라이어에게 주어진 제시어: ${game.liarAssignedWord}` : null;
    const liarLine = game.liarId ? `라이어: ${game.getPlayer(game.liarId)?.displayName ?? game.liarId}` : null;
    const accusedLine = game.accusedUserId
      ? `최종 지목: ${game.getPlayer(game.accusedUserId)?.displayName ?? game.accusedUserId}`
      : null;
    const voteSummaryLine = this.buildCompactVoteSummary(game);
    return [title, result.reason, modeLine, categoryLine, wordLine, liarAssignedWordLine, liarLine, accusedLine, voteSummaryLine]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  private async announceVoteResolution(
    client: Client,
    game: LiarGame,
    resolution: LiarVoteResolution,
    preferredChannel: Channel | null = null,
  ): Promise<void> {
    if (resolution.tiedUserIds.length > 1 || !resolution.accusedUserId) {
      if (resolution.result) {
        await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, resolution.result), preferredChannel);
      }
      return;
    }

    const accused = game.getPlayer(resolution.accusedUserId);
    if (resolution.phase === "guess") {
      await this.sendPublicMessage(
        client,
        game,
        `${accused?.displayName ?? "지목된 플레이어"} 님이 라이어로 지목되었습니다. 이제 해당 플레이어는 ${Math.floor(GUESS_TIMEOUT_MS / 1_000)}초 안에 채널에 정답 단어를 한 번 입력하세요.`,
        preferredChannel,
      );
      return;
    }

    if (resolution.result) {
      await this.sendPublicMessage(client, game, this.buildResultAnnouncement(game, resolution.result), preferredChannel);
    }
  }

  private async replyEphemeral(
    interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    payload: string | LiarStatusPayload,
  ): Promise<void> {
    const normalizedPayload = typeof payload === "string" ? { content: payload } : payload;
    if (interaction.deferred && interaction.isChatInputCommand()) {
      await interaction.editReply(normalizedPayload);
      return;
    }

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ ...normalizedPayload, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ ...normalizedPayload, flags: MessageFlags.Ephemeral });
  }

  private assertHost(userId: string, game: LiarGame): void {
    if (userId !== game.hostId) {
      throw new Error("방장만 사용할 수 있는 기능입니다.");
    }
  }

  private assertGameChannel(channelId: string, game: LiarGame): void {
    if (channelId !== game.channelId) {
      throw new Error("이 라이어게임은 생성된 채널에서만 진행할 수 있습니다.");
    }
  }

  private async syncStatusMessage(client: Client, game: LiarGame, preferredChannel: Channel | null = null): Promise<void> {
    const channel = await this.resolveTextChannel(client, game.channelId, preferredChannel);
    const payload = this.buildStatusPayload(game);

    if (!game.statusMessageId) {
      const message = await channel.send(payload);
      game.statusMessageId = message.id;
      return;
    }

    try {
      const existing = await channel.messages.fetch(game.statusMessageId);
      await existing.edit(payload);
    } catch {
      const message = await channel.send(payload);
      game.statusMessageId = message.id;
    }
  }

  private async suppressParticipantMessage(message: Message): Promise<void> {
    try {
      await message.delete();
    } catch {
      return;
    }
  }

  private async sendGuidanceMessage(
    client: Client,
    game: LiarGame,
    userId: string,
    content: string,
    keySuffix: string,
    preferredChannel: Channel | null = null,
  ): Promise<void> {
    const key = `${game.id}:${keySuffix}`;
    const now = Date.now();
    const previous = this.guidanceCooldowns.get(key) ?? 0;
    if (now - previous < GUIDANCE_COOLDOWN_MS) {
      return;
    }

    this.guidanceCooldowns.set(key, now);
    await this.sendPublicMessage(client, game, `<@${userId}> ${content}`, preferredChannel);
  }

  private buildStatsMessage(stats: LiarStatsSummary): string {
    const matchesPlayed = stats.lifetime.matchesPlayed;
    const winRate = matchesPlayed === 0 ? 0 : Math.round((stats.lifetime.wins / matchesPlayed) * 100);
    const liarLosses = Math.max(0, stats.lifetime.liarMatches - stats.lifetime.liarWins);
    const citizenLosses = Math.max(0, stats.lifetime.citizenMatches - stats.lifetime.citizenWins);
    const lines = [
      `라이어 전적: ${stats.latestDisplayName}`,
      `완료 ${matchesPlayed}판 · ${stats.lifetime.wins}승 ${stats.lifetime.losses}패 · 승률 ${winRate}% · 취소 ${stats.lifetime.cancelledMatches}판`,
      `역할 전적: 라이어 ${stats.lifetime.liarMatches}판 ${stats.lifetime.liarWins}승 ${liarLosses}패 · 시민 ${stats.lifetime.citizenMatches}판 ${stats.lifetime.citizenWins}승 ${citizenLosses}패`,
      `연승: 현재 ${stats.streaks.currentWinStreak}연승 · 최고 ${stats.streaks.bestWinStreak}연승`,
    ];

    if (stats.categoryStats.length > 0) {
      lines.push("카테고리 전적:");
      for (const [index, category] of stats.categoryStats.slice(0, 3).entries()) {
        lines.push(`${index + 1}. ${category.categoryLabel} · ${category.plays}판 ${category.wins}승 ${category.losses}패`);
      }
    }

    if (stats.recentMatches.length > 0) {
      lines.push("최근 경기:");
      for (const [index, match] of stats.recentMatches.slice(0, 5).entries()) {
        const resultLabel = match.status === "cancelled" ? "취소" : match.isWinner ? "승리" : "패배";
        const roleLabel = match.wasLiar ? "라이어" : "시민";
        const accusedLabel = match.wasAccused ? "지목" : "미지목";
        lines.push(
          `${index + 1}. ${resultLabel} · ${liarModeLabel(match.mode)} · ${roleLabel} · ${match.categoryLabel} · ${accusedLabel} · ${this.formatDate(match.endedAt)}${
            match.guildName ? ` · ${match.guildName}` : ""
          }`,
        );
      }
    }

    return lines.join("\n");
  }

  private formatDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private buildParticipantsFieldValue(game: LiarGame): string {
    return [...game.players.values()]
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map((player, index) => {
        const tags = [
          player.userId === game.hostId ? "방장" : null,
          this.getParticipantPhaseTag(game, player.userId),
        ].filter((tag): tag is string => Boolean(tag));
        return `${index + 1}. ${player.displayName}${tags.length > 0 ? ` (${tags.join(", ")})` : ""}`;
      })
      .join("\n");
  }

  private buildKeywordEmbed(game: LiarGame, userId: string, keywordView: ReturnType<LiarGame["getKeywordView"]>): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(this.getKeywordColor(game, keywordView))
      .setTitle("개인 제시어")
      .setDescription(
        [
          `현재 단계: ${phaseLabel(game.phase)}`,
          `규칙 모드: ${liarModeLabel(game.mode)}`,
          "이 정보는 본인에게만 보입니다.",
        ].join("\n"),
      )
      .addFields([
        {
          name: "상태",
          value: this.buildKeywordStatusFieldValue(keywordView),
          inline: true,
        },
        {
          name: "카테고리",
          value: keywordView.categoryLabel,
          inline: true,
        },
        {
          name: "제시어",
          value: keywordView.keyword ?? "공개되지 않음",
        },
        {
          name: "지금 할 일",
          value: this.buildKeywordActionFieldValue(game, userId),
        },
      ]);
  }

  private buildKeywordStatusFieldValue(keywordView: ReturnType<LiarGame["getKeywordView"]>): string {
    if (keywordView.mode === "modeB") {
      return "역할 비공개";
    }

    return keywordView.isLiar ? "라이어" : "시민";
  }

  private buildKeywordActionFieldValue(game: LiarGame, userId: string): string {
    switch (game.phase) {
      case "clue": {
        const currentSpeaker = game.getCurrentSpeaker();
        if (currentSpeaker?.userId === userId) {
          return "지금 당신 차례입니다. 채널에 일반 메시지 한 줄을 입력하세요.";
        }

        if (game.clues.some((clue) => clue.userId === userId)) {
          return "당신 설명은 이미 제출되었습니다. 다른 참가자 차례를 기다리세요.";
        }

        return "아직 당신 차례가 아닙니다. 순서를 기다리세요.";
      }
      case "discussion":
        return [
          "자유 토론 중입니다. 단서 차이를 비교하며 의심 대상을 압박하세요.",
          `합의되면 과반이 \`${PREFIX_SKIP}\` 을 입력해 투표로 넘길 수 있습니다.`,
        ].join("\n");
      case "voting":
        return game.votes.has(userId)
          ? "이미 투표를 제출했습니다. 다른 참가자의 제출을 기다리세요."
          : `지금 상태 카드의 선택 메뉴 또는 \`${PREFIX_VOTE} @대상\` 형식으로 한 번 투표하세요.`;
      case "guess":
        return userId === game.liarId
          ? `지금 정답 단어를 채널에 한 번 입력하세요. 제한 시간은 ${Math.floor(GUESS_TIMEOUT_MS / 1_000)}초입니다.`
          : "지목된 라이어의 추리를 기다리세요.";
      case "ended":
        return "게임이 끝났습니다. 결과 카드와 공개 정보를 확인하세요.";
      default:
        return this.buildCurrentActionFieldValue(game);
    }
  }

  private buildLobbyGuideFieldValue(game: LiarGame): string {
    const lines = [
      "4명 이상이 되면 방장이 시작할 수 있습니다.",
      "참가/나가기는 아래 버튼으로 처리합니다.",
      "오디오는 방장이 있는 음성 채널로 공용 브로드캐스트됩니다.",
      game.mode === "modeA"
        ? "아래 모드 버튼에서 모드를 고르고, 모드A일 때만 카테고리 메뉴가 열립니다."
        : "아래 모드 버튼에서 규칙을 바꾸며, 모드B의 시민/라이어 카테고리는 시작 시 자동 배정됩니다.",
      liarModeSummary(game.mode),
    ];
    const cannotStartReason = game.getStartConfigurationError();
    if (cannotStartReason) {
      lines.push(`시작 제한: ${cannotStartReason}`);
    }

    return lines.join("\n");
  }

  private getParticipantPhaseTag(game: LiarGame, userId: string): string | null {
    switch (game.phase) {
      case "lobby":
        return "대기";
      case "clue": {
        const speaker = game.getCurrentSpeaker();
        if (speaker?.userId === userId) {
          return "현재";
        }
        return game.clues.some((clue) => clue.userId === userId) ? "완료" : "대기";
      }
      case "discussion":
        return "토론중";
      case "voting":
        return game.votes.has(userId) ? "투표완료" : "미투표";
      case "guess":
        if (userId === game.liarId) {
          return "추리중";
        }
        if (userId === game.accusedUserId) {
          return "지목";
        }
        return "대기";
      case "ended":
        return null;
      default:
        return null;
    }
  }

  private buildCurrentActionFieldValue(game: LiarGame): string {
    switch (game.phase) {
      case "lobby": {
        const cannotStartReason = game.getStartConfigurationError();
        return [
          game.playerCount < 4
            ? `현재 ${game.playerCount}명입니다. \`참가\` 버튼으로 4명 이상 모아야 시작할 수 있습니다.`
            : cannotStartReason
              ? `현재는 시작할 수 없습니다. ${cannotStartReason}`
              : "방장은 아래 `시작` 버튼으로 바로 게임을 열 수 있습니다.",
          game.mode === "modeA"
            ? "방장은 `모드A/모드B` 버튼과 카테고리 메뉴를 확인하세요."
            : "방장은 `모드A/모드B` 버튼으로 규칙을 바꿀 수 있습니다.",
        ].join("\n");
      }
      case "clue": {
        const speaker = game.getCurrentSpeaker();
        return [
          `${speaker?.displayName ?? "현재 차례 플레이어"} 님만 지금 채널에 일반 메시지 한 줄을 입력하세요.`,
          "다른 참가자는 기다리면서 `/제시어` 를 다시 확인할 수 있습니다.",
        ].join("\n");
      }
      case "discussion":
        return [
          "자유 토론 중입니다. 의심되는 사람을 압박하고 단서를 비교하세요.",
          `합의되면 참가자 과반이 \`${PREFIX_SKIP}\` 을 입력해 즉시 투표로 넘길 수 있습니다.`,
        ].join("\n");
      case "voting": {
        const remainingVotes = Math.max(0, game.playerCount - game.votes.size);
        return [
          "모든 참가자는 상태 카드의 선택 메뉴 또는 `!투표 @대상` 형식으로 정확히 한 번 투표하세요.",
          remainingVotes > 0 ? `아직 ${remainingVotes}명이 투표하지 않았습니다.` : "모든 표가 제출되면 즉시 집계됩니다.",
        ].join("\n");
      }
      case "guess": {
        const liar = game.liarId ? game.getPlayer(game.liarId) : null;
        return [
          `${liar?.displayName ?? "지목된 라이어"} 님만 채널에 정답 단어를 한 번 입력할 수 있습니다.`,
          `제한 시간은 ${Math.floor(GUESS_TIMEOUT_MS / 1_000)}초입니다.`,
        ].join("\n");
      }
      case "ended":
        return this.buildEndedGuideFieldValue(game);
      default:
        return "현재 게임 상태를 확인하세요.";
    }
  }

  private buildEndedSummaryFieldValue(game: LiarGame): string {
    const winnerLabel =
      game.result?.winner === "citizens"
        ? "시민팀 승리"
        : game.result?.winner === "liar"
          ? "라이어 승리"
          : "취소 종료";
    const lines = [winnerLabel];
    if (game.result?.reason) {
      lines.push(game.result.reason);
    }
    if (game.accusedUserId) {
      lines.push(`최종 지목: ${game.getPlayer(game.accusedUserId)?.displayName ?? game.accusedUserId}`);
    }
    return lines.join("\n");
  }

  private buildEndedRevealFieldValue(game: LiarGame): string {
    return [
      game.mode === "modeB"
        ? `카테고리: 시민 ${game.category.label}${game.liarAssignedCategoryLabel ? ` · 라이어 ${game.liarAssignedCategoryLabel}` : ""}`
        : `카테고리: ${game.category.label}`,
      game.secretWord ? `정답 제시어: ${game.secretWord}` : "정답 제시어: 없음",
      game.mode === "modeB" && game.liarAssignedWord ? `라이어 제시어: ${game.liarAssignedWord}` : undefined,
      game.liarId ? `라이어: ${game.getPlayer(game.liarId)?.displayName ?? game.liarId}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  private buildEndedParticipantsFieldValue(game: LiarGame): string {
    return [...game.players.values()]
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map((player, index) => {
        const badges = [
          player.userId === game.hostId ? "방장" : null,
          player.userId === game.liarId ? "라이어" : null,
          player.userId === game.accusedUserId ? "지목" : null,
        ].filter((badge): badge is string => Boolean(badge));
        return `${index + 1}. ${player.displayName}${badges.length > 0 ? ` (${badges.join(", ")})` : ""}`;
      })
      .join("\n");
  }

  private buildVoteSummaryFieldValue(game: LiarGame): string {
    if (game.votes.size === 0) {
      return "제출된 투표가 없습니다.";
    }

    return [...game.players.values()]
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map((player) => {
        const vote = game.votes.get(player.userId);
        const targetName = vote ? (game.getPlayer(vote.targetId)?.displayName ?? vote.targetId) : "미제출";
        return `${player.displayName} -> ${targetName}`;
      })
      .join("\n");
  }

  private buildCompactVoteSummary(game: LiarGame): string | null {
    if (game.votes.size === 0) {
      return null;
    }

    return `투표: ${[...game.players.values()]
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map((player) => {
        const vote = game.votes.get(player.userId);
        const targetName = vote ? (game.getPlayer(vote.targetId)?.displayName ?? vote.targetId) : "미제출";
        return `${player.displayName}->${targetName}`;
      })
      .join(", ")}`;
  }

  private buildEndedGuideFieldValue(game: LiarGame): string {
    if (game.result?.winner === "cancelled") {
      return "방장이 음성 채널에 들어와 있으면 아래 `리매치` 버튼으로 같은 설정의 새 로비를 다시 열 수 있습니다.";
    }

    return [
      "결과를 확인했다면 아래 `리매치` 버튼으로 같은 설정의 새 로비를 다시 열 수 있습니다.",
      "리매치는 방장만 사용할 수 있고, 방장은 음성 채널에 들어와 있어야 합니다.",
    ].join("\n");
  }

  private buildPhaseProgressFieldValue(game: LiarGame): string {
    switch (game.phase) {
      case "lobby": {
        const cannotStartReason = game.getStartConfigurationError();
        return [
          `참가 인원: ${game.playerCount}/8`,
          `현재 규칙: ${liarModeLabel(game.mode)}`,
          game.mode === "modeA" ? `현재 카테고리: ${game.category.label}` : "카테고리: 크로스 카테고리 자동 배정",
          cannotStartReason ? `시작 상태: 대기 (${cannotStartReason})` : "시작 상태: 가능",
        ].join("\n");
      }
      case "clue": {
        const speaker = game.getCurrentSpeaker();
        return [
          `현재 차례: ${speaker?.displayName ?? "없음"}`,
          `설명 순서: ${game.getCompletedClueTurns() + 1}/${game.turnOrder.length}`,
          `완료된 설명: ${game.clues.length}/${game.turnOrder.length}`,
          `남은 시간: 약 ${game.getRemainingPhaseSeconds() ?? 0}초`,
        ].join("\n");
      }
      case "discussion":
        return [
          "자유 토론 진행 중",
          `남은 시간: 약 ${game.getRemainingPhaseSeconds() ?? 0}초`,
          `스킵 동의: ${this.discussionSkipVotes.get(game.id)?.size ?? 0}/${this.getDiscussionSkipThreshold(game.playerCount)}`,
        ].join("\n");
      case "voting":
        return [
          `제출된 표: ${game.votes.size}/${game.playerCount}`,
          `남은 투표: ${Math.max(0, game.playerCount - game.votes.size)}명`,
          `남은 시간: 약 ${game.getRemainingPhaseSeconds() ?? 0}초`,
        ].join("\n");
      case "guess": {
        const liar = game.liarId ? game.getPlayer(game.liarId) : null;
        return [
          `지목된 라이어: ${liar?.displayName ?? "알 수 없음"}`,
          `최종 지목: ${game.accusedUserId ? (game.getPlayer(game.accusedUserId)?.displayName ?? game.accusedUserId) : "없음"}`,
          `남은 시간: 약 ${game.getRemainingPhaseSeconds() ?? 0}초`,
        ].join("\n");
      }
      case "ended":
        return game.result?.reason ?? "게임이 종료되었습니다.";
      default:
        return game.describeStatus();
    }
  }

  private buildPhaseGuideFieldValue(game: LiarGame): string {
    switch (game.phase) {
      case "clue":
        return [
          "현재 차례인 참가자만 채널에 일반 메시지 한 줄을 입력하세요.",
          `설명 제한 시간: ${Math.floor(CLUE_TIMEOUT_MS / 1_000)}초`,
        ].join("\n");
      case "discussion":
        return [
          "자유 토론 중입니다. 시간이 끝나면 자동으로 투표가 시작됩니다.",
          `참가자 과반이 \`${PREFIX_SKIP}\` 을 입력하면 즉시 투표 단계로 넘어갑니다.`,
        ].join("\n");
      case "voting":
        return [
          "투표 형식: 상태 카드의 선택 메뉴 또는 `!투표 @대상`",
          "시간이 끝나면 현재 표로 자동 집계됩니다.",
          "방장은 `지금 집계` 버튼으로 먼저 마감할 수 있습니다.",
        ].join("\n");
      case "guess": {
        const liar = game.liarId ? game.getPlayer(game.liarId) : null;
        return `${liar?.displayName ?? "지목된 라이어"} 님은 채널에 일반 메시지로 정답 단어를 한 번 입력하세요.`;
      }
      case "ended":
        return this.buildEndedGuideFieldValue(game);
      default:
        return "현재 게임 상태를 확인하세요.";
    }
  }

  private getStatusColor(game: LiarGame): number {
    switch (game.phase) {
      case "lobby":
        return Colors.Blurple;
      case "clue":
        return Colors.DarkBlue;
      case "discussion":
      case "voting":
        return Colors.Gold;
      case "guess":
        return Colors.Orange;
      case "ended":
        return game.result?.winner === "citizens"
          ? Colors.Green
          : game.result?.winner === "liar"
            ? Colors.Red
            : Colors.DarkButNotBlack;
      default:
        return Colors.Blurple;
    }
  }

  private getKeywordColor(game: LiarGame, keywordView: ReturnType<LiarGame["getKeywordView"]>): number {
    if (keywordView.mode === "modeA" && keywordView.isLiar) {
      return Colors.Orange;
    }

    return this.getStatusColor(game);
  }

  private buildExcludedWordsByCategoryId(guildId: string): ReadonlyMap<string, readonly string[]> {
    const entries = getLiarCategories(guildId).map((category) => [
      category.id,
      this.registry.getRecentWords(guildId, category.id, category.words),
    ] as const);
    return new Map(entries);
  }

  private async syncSeenUser(guildId: string, guildName: string, userId: string, displayName: string): Promise<void> {
    if (!this.options.onUserSeen) {
      return;
    }

    await this.options.onUserSeen({
      discordUserId: userId,
      displayName,
      discordGuildId: guildId,
      guildName,
    });
  }

  private async safelyRunAudio(task: () => Promise<void>, guildId: string): Promise<void> {
    try {
      await task();
    } catch (error) {
      console.error(`liar audio operation failed in guild ${guildId}`, error);
    }
  }

  private async persistEndedGame(game: LiarGame): Promise<void> {
    if (!this.options.onGameEnded || this.persistedEndedGames.has(game.id)) {
      return;
    }

    this.persistedEndedGames.add(game.id);
    try {
      await this.options.onGameEnded(game);
    } catch (error) {
      this.persistedEndedGames.delete(game.id);
      throw error;
    }
  }

  private async sendPublicMessage(client: Client, game: LiarGame, content: string, preferredChannel: Channel | null = null): Promise<void> {
    const channel = await this.resolveTextChannel(client, game.channelId, preferredChannel);
    await channel.send({ content });
  }

  private async resolveTextChannel(client: Client, channelId: string, preferredChannel: Channel | null = null): Promise<LiarTextChannel> {
    const candidate = preferredChannel ?? (await client.channels.fetch(channelId));
    if (!candidate || !candidate.isTextBased()) {
      throw new Error("텍스트 채널을 찾을 수 없습니다.");
    }

    return candidate as LiarTextChannel;
  }
}
