import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
  Guild,
  GuildMember,
  Message,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextBasedChannel,
  TextChannel,
} from "discord.js";
import { config } from "../config";
import {
  NightActionRecord,
  NightActionType,
  PendingArticle,
  PendingTrialBurn,
  Phase,
  PhaseContext,
  PlayerState,
  ResolutionSummary,
  Role,
  Ruleset,
  SecretChannelIds,
  getTeam,
  isMafiaTeam,
} from "./model";
import { assignRoles, getRoleLabel, getRoleSummary, getTeamLabel, normalizeStolenRole } from "./rules";

type TimeAdjust = "add" | "cut";

const PHASE_LABELS: Record<Phase, string> = {
  lobby: "로비",
  night: "밤",
  discussion: "낮 토론",
  vote: "투표",
  defense: "최후의 반론",
  trial: "찬반 투표",
  ended: "종료",
};

const NIGHT_SECONDS = 25;
const DISCUSSION_SECONDS_PER_PLAYER = 15;
const VOTE_SECONDS = 15;
const DEFENSE_SECONDS = 15;

interface PromptDefinition {
  action: NightActionType;
  title: string;
  description: string;
  targets: string[];
}

export class GameManager {
  private readonly games = new Map<string, MafiaGame>();

  get(guildId: string): MafiaGame | undefined {
    return this.games.get(guildId);
  }

  findByGameId(gameId: string): MafiaGame | undefined {
    return [...this.games.values()].find((game) => game.id === gameId);
  }

  create(guild: Guild, channelId: string, host: GuildMember, ruleset: Ruleset): MafiaGame {
    const existing = this.games.get(guild.id);
    if (existing) {
      throw new Error("이 서버에는 이미 진행 중인 마피아 게임이 있습니다.");
    }

    const game = new MafiaGame(guild, channelId, host, ruleset, (guildId) => {
      this.games.delete(guildId);
    });
    this.games.set(guild.id, game);
    return game;
  }

  delete(guildId: string): void {
    this.games.delete(guildId);
  }
}

export class MafiaGame {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly hostId: string;
  readonly ruleset: Ruleset;

  readonly players = new Map<string, PlayerState>();
  readonly secretChannels: SecretChannelIds = {};
  readonly contactedIds = new Set<string>();
  readonly nightActions = new Map<string, NightActionRecord>();
  readonly bonusNightActions = new Map<string, NightActionRecord>();
  readonly spyBonusGrantedTonight = new Set<string>();
  readonly dayVotes = new Map<string, string>();
  readonly trialVotes = new Map<string, "yes" | "no">();
  readonly pendingTrialBurns = new Map<string, PendingTrialBurn>();
  readonly deadOrder: string[] = [];

  phase: Phase = "lobby";
  phaseContext: PhaseContext | null = null;
  dayNumber = 0;
  nightNumber = 0;
  currentTrialTargetId: string | null = null;
  blockedTonightTargetId: string | null = null;
  pendingSeductionTargetId: string | null = null;
  bulliedToday = new Set<string>();
  bulliedNextDay = new Set<string>();
  pendingArticle: PendingArticle | null = null;
  lastPublicLines: string[] = ["게임이 생성되었습니다."];
  lobbyMessageId: string | null = null;
  statusMessageId: string | null = null;
  phaseMessageId: string | null = null;
  phaseTimer: NodeJS.Timeout | null = null;
  loverPair: [string, string] | null = null;

  constructor(
    guild: Guild,
    channelId: string,
    host: GuildMember,
    ruleset: Ruleset,
    private readonly onEnded: (guildId: string) => void,
  ) {
    this.id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
      .toString()
      .padStart(4, "0")}`;
    this.guildId = guild.id;
    this.channelId = channelId;
    this.hostId = host.id;
    this.ruleset = ruleset;
    this.players.set(host.id, createPlayer(host));
  }

  get size(): number {
    return this.players.size;
  }

  get alivePlayers(): PlayerState[] {
    return [...this.players.values()].filter((player) => player.alive);
  }

  get deadPlayers(): PlayerState[] {
    return [...this.players.values()].filter((player) => !player.alive);
  }

  getPlayer(userId: string): PlayerState | undefined {
    return this.players.get(userId);
  }

  getPlayerOrThrow(userId: string): PlayerState {
    const player = this.players.get(userId);
    if (!player) {
      throw new Error("게임 참가자를 찾을 수 없습니다.");
    }

    return player;
  }

  addPlayer(member: GuildMember): void {
    if (this.phase !== "lobby") {
      throw new Error("게임이 이미 시작되었습니다.");
    }

    if (member.user.bot) {
      throw new Error("봇 계정은 참가할 수 없습니다.");
    }

    if (this.players.has(member.id)) {
      throw new Error("이미 참가한 플레이어입니다.");
    }

    if (this.players.size >= 8) {
      throw new Error("최대 8명까지만 참가할 수 있습니다.");
    }

    this.players.set(member.id, createPlayer(member));
    this.lastPublicLines = [`${member.displayName} 님이 로비에 참가했습니다.`];
  }

  removePlayer(userId: string): void {
    if (this.phase !== "lobby") {
      throw new Error("게임이 이미 시작되었습니다.");
    }

    if (userId === this.hostId) {
      throw new Error("방장은 로비를 종료한 뒤에만 나갈 수 있습니다.");
    }

    const player = this.getPlayer(userId);
    if (!player) {
      throw new Error("참가 중인 플레이어가 아닙니다.");
    }

    this.players.delete(userId);
    this.lastPublicLines = [`${player.displayName} 님이 로비에서 나갔습니다.`];
  }

  async sendOrUpdateLobby(client: Client): Promise<void> {
    const channel = await this.getPublicChannel(client);
    const payload = {
      embeds: [this.buildLobbyEmbed()],
      components: [this.buildLobbyControls()],
    };

    if (this.lobbyMessageId) {
      const message = await this.fetchMessage(channel, this.lobbyMessageId);
      if (message) {
        await message.edit(payload);
        return;
      }
    }

    const message = await channel.send(payload);
    this.lobbyMessageId = message.id;
  }

  async start(client: Client): Promise<void> {
    if (this.phase !== "lobby") {
      throw new Error("이미 시작된 게임입니다.");
    }

    if (this.players.size < 4 || this.players.size > 8) {
      throw new Error("게임 시작 인원은 4명 이상 8명 이하입니다.");
    }

    const { roles } = assignRoles(this.players.size);
    const seats = shuffle([...this.players.values()]);

    seats.forEach((seat, index) => {
      const role = roles[index];
      seat.role = role;
      seat.originalRole = role;
      seat.alive = true;
      seat.deadReason = undefined;
      seat.ascended = false;
      seat.soldierUsed = false;
      seat.reporterUsed = false;
      seat.priestUsed = false;
      seat.terrorMarkId = undefined;
      seat.voteLockedToday = false;
      seat.timeAdjustUsedOnDay = null;
      seat.loverId = undefined;
      seat.isContacted = role === "mafia";

      if (seat.isContacted) {
        this.contactedIds.add(seat.userId);
      }
    });

    this.assignLovers();
    await this.prepareSecretChannels(client);
    await this.sendRoleCards(client);

    this.phase = "night";
    this.lastPublicLines = ["게임이 시작되었습니다.", `시즌4 ${this.ruleset === "balance" ? "밸런스" : "초기"} 규칙으로 진행합니다.`];
    await this.sendOrUpdateStatus(client);
    await this.beginNight(client);
  }

  async forceAdvance(client: Client): Promise<void> {
    switch (this.phase) {
      case "night":
        await this.finishNight(client);
        return;
      case "discussion":
        await this.finishDiscussion(client);
        return;
      case "vote":
        await this.finishVote(client);
        return;
      case "defense":
        await this.finishDefense(client);
        return;
      case "trial":
        await this.finishTrial(client);
        return;
      default:
        throw new Error("지금은 강제 진행할 단계가 없습니다.");
    }
  }

  async end(client: Client, reason: string): Promise<void> {
    this.clearTimer();
    this.phase = "ended";
    this.phaseContext = null;
    this.lastPublicLines = [reason];
    await this.sendOrUpdateStatus(client);
    await this.lockOrDeleteSecretChannels(client);
    this.onEnded(this.guildId);
  }

  describeAssignments(): string {
    const lines = [...this.players.values()]
      .map((player) => `- ${player.displayName}: ${getRoleLabel(player.role)} (${getTeamLabel(player.role)})`)
      .sort();
    return lines.join("\n");
  }

  async handleLobbyButton(client: Client, interaction: ButtonInteraction, action: "join" | "leave" | "start"): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("서버 안에서만 사용할 수 있습니다.");
    }

    const member = await guild.members.fetch(interaction.user.id);

    if (action === "join") {
      this.addPlayer(member);
      await this.sendOrUpdateLobby(client);
      await interaction.reply({ content: "로비에 참가했습니다.", ephemeral: true });
      return;
    }

    if (action === "leave") {
      this.removePlayer(interaction.user.id);
      await this.sendOrUpdateLobby(client);
      await interaction.reply({ content: "로비에서 나갔습니다.", ephemeral: true });
      return;
    }

    if (interaction.user.id !== this.hostId) {
      throw new Error("게임 시작은 방장만 할 수 있습니다.");
    }

    await interaction.reply({ content: "게임을 시작합니다. DM을 확인해 주세요.", ephemeral: true });
    await this.start(client);
  }

  async handleVoteSelect(client: Client, interaction: StringSelectMenuInteraction): Promise<void> {
    this.requirePhase("vote");
    this.requirePhaseToken(interaction.customId);

    const player = this.assertAliveParticipant(interaction.user.id);
    if (this.bulliedToday.has(player.userId)) {
      throw new Error("협박당한 플레이어는 오늘 투표할 수 없습니다.");
    }

    const [targetId] = interaction.values;
    if (!this.players.has(targetId)) {
      throw new Error("투표 대상을 찾을 수 없습니다.");
    }

    this.dayVotes.set(player.userId, targetId);
    await interaction.reply({ content: `${this.getPlayerOrThrow(targetId).displayName} 님에게 투표했습니다.`, ephemeral: true });
    await this.sendOrUpdateStatus(client);
  }

  async handleTrialVote(client: Client, interaction: ButtonInteraction, vote: "yes" | "no"): Promise<void> {
    this.requirePhase("trial");
    this.requirePhaseToken(interaction.customId);

    const player = this.assertAliveParticipant(interaction.user.id);
    if (this.bulliedToday.has(player.userId)) {
      throw new Error("협박당한 플레이어는 찬반 투표도 할 수 없습니다.");
    }

    this.trialVotes.set(player.userId, vote);
    await interaction.reply({
      content: vote === "yes" ? "처형 찬성에 투표했습니다." : "처형 반대에 투표했습니다.",
      ephemeral: true,
    });
    await this.sendOrUpdateStatus(client);
  }

  async handleTimeAdjust(client: Client, interaction: ButtonInteraction, direction: TimeAdjust): Promise<void> {
    this.requirePhase("discussion");
    this.requirePhaseToken(interaction.customId);

    const player = this.assertAliveParticipant(interaction.user.id);
    if (player.timeAdjustUsedOnDay === this.dayNumber) {
      throw new Error("토론 시간 조절은 하루에 한 번만 가능합니다.");
    }

    if (!this.phaseContext) {
      throw new Error("토론 시간이 없습니다.");
    }

    const delta = direction === "add" ? 15_000 : -15_000;
    player.timeAdjustUsedOnDay = this.dayNumber;
    this.phaseContext.deadlineAt = Math.max(Date.now() + 5_000, this.phaseContext.deadlineAt + delta);
    this.restartTimer(client, this.phaseContext.deadlineAt - Date.now(), () => this.finishDiscussion(client));
    await this.sendOrUpdateStatus(client);

    await interaction.reply({
      content: direction === "add" ? "토론 시간을 15초 늘렸습니다." : "토론 시간을 15초 줄였습니다.",
      ephemeral: true,
    });
  }

  async handleReporterPublish(client: Client, interaction: ButtonInteraction): Promise<void> {
    const [kind, gameId, dayRaw, actorId, action] = interaction.customId.split(":");
    if (kind !== "reporter" || gameId !== this.id || action !== "publish") {
      throw new Error("기자 기사 공개 메시지가 아닙니다.");
    }

    if (interaction.user.id !== actorId) {
      throw new Error("이 메시지는 본인만 사용할 수 있습니다.");
    }

    if (this.phase === "night" || this.phase === "lobby" || this.phase === "ended") {
      throw new Error("기사는 낮에만 공개할 수 있습니다.");
    }

    if (Number.parseInt(dayRaw, 10) !== this.dayNumber) {
      throw new Error("이미 지나간 낮의 기사 공개 버튼입니다.");
    }

    if (!this.pendingArticle || this.pendingArticle.actorId !== actorId || this.dayNumber < this.pendingArticle.publishFromDay) {
      throw new Error("지금 공개할 수 있는 기사가 없습니다.");
    }

    const articleLine = `기자 기사: ${this.getPlayerOrThrow(this.pendingArticle.targetId).displayName} 님의 직업은 ${getRoleLabel(this.pendingArticle.role)}입니다.`;
    const channel = await this.getPublicChannel(client);
    await channel.send({
      embeds: [
        new EmbedBuilder().setColor(Colors.Blurple).setTitle("기자 기사").setDescription(articleLine),
      ],
    });

    this.pendingArticle = null;
    this.lastPublicLines = [...this.lastPublicLines, articleLine];
    await this.sendOrUpdateStatus(client);
    await interaction.reply({ content: "기사를 공개했습니다.", ephemeral: true });
  }

  async handleNightSelect(client: Client, interaction: StringSelectMenuInteraction): Promise<void> {
    const [kind, gameId, tokenRaw, actorId, action] = interaction.customId.split(":");
    if (gameId !== this.id) {
      throw new Error("다른 게임의 메시지입니다.");
    }

    if (interaction.user.id !== actorId) {
      throw new Error("이 메시지는 본인만 사용할 수 있습니다.");
    }

    if (Number.parseInt(tokenRaw, 10) !== this.phaseContext?.token) {
      throw new Error("이미 지나간 단계의 선택지입니다.");
    }

    const actor = this.assertAliveParticipant(actorId);
    const [targetId] = interaction.values;

    if (kind === "night") {
      if (action === "spyInspectBonus") {
        const primaryAction = this.nightActions.get(actorId);
        if (!primaryAction || primaryAction.action !== "spyInspect" || !this.spyBonusGrantedTonight.has(actorId)) {
          throw new Error("추가 조사 권한이 없습니다.");
        }

        const record: NightActionRecord = {
          actorId,
          action: "spyInspect",
          targetId,
          submittedAt: Date.now(),
        };
        this.bonusNightActions.set(actorId, record);
        await interaction.update(this.buildSpyBonusPayload(actor, primaryAction.targetId, record.targetId));
        return;
      }

      const record: NightActionRecord = {
        actorId,
        action: action as NightActionType,
        targetId,
        submittedAt: Date.now(),
      };
      this.nightActions.set(actorId, record);

      if (record.action === "spyInspect" && actor.role === "spy" && !actor.isContacted) {
        const target = this.getPlayerOrThrow(targetId);
        if (target.role === "mafia") {
          this.contactPlayer(actorId);
          this.spyBonusGrantedTonight.add(actorId);
          await this.syncSecretChannels(client);
          await interaction.update(this.buildSpyBonusPayload(actor, record.targetId));
          return;
        }
      }

      await interaction.update(this.buildDirectActionPayload(actor, record.targetId));
      return;
    }

    if (kind === "madam") {
      if (this.phase !== "vote") {
        throw new Error("지금은 유혹을 선택할 수 없습니다.");
      }

      this.pendingSeductionTargetId = targetId;
      if (this.isAliveRole(targetId, "mafia")) {
        this.contactPlayer(actorId);
      }

      await interaction.update(this.buildMadamPayload(actor, targetId));
      await this.sendOrUpdateStatus(client);
      return;
    }

    if (kind === "terror") {
      this.pendingTrialBurns.set(actorId, { actorId, targetId });
      await interaction.update(this.buildTerrorBurnPayload(actor, targetId));
      return;
    }

    throw new Error("알 수 없는 선택 상호작용입니다.");
  }

  async sendOrUpdateStatus(client: Client): Promise<void> {
    const channel = await this.getPublicChannel(client);
    const payload = { embeds: [this.buildStatusEmbed()] };

    if (this.statusMessageId) {
      const message = await this.fetchMessage(channel, this.statusMessageId);
      if (message) {
        await message.edit(payload);
        return;
      }
    }

    const message = await channel.send(payload);
    this.statusMessageId = message.id;
  }

  private async beginNight(client: Client): Promise<void> {
    this.clearTimer();
    this.phase = "night";
    this.nightNumber += 1;
    this.currentTrialTargetId = null;
    this.dayVotes.clear();
    this.trialVotes.clear();
    this.pendingTrialBurns.clear();
    this.nightActions.clear();
    this.bonusNightActions.clear();
    this.spyBonusGrantedTonight.clear();
    this.blockedTonightTargetId = this.pendingSeductionTargetId;
    this.pendingSeductionTargetId = null;
    this.phaseContext = this.newPhaseContext(NIGHT_SECONDS * 1_000);
    this.lastPublicLines = [
      `${this.nightNumber}번째 밤이 시작되었습니다.`,
      this.blockedTonightTargetId
        ? `${this.getPlayerOrThrow(this.blockedTonightTargetId).displayName} 님은 오늘 밤 유혹 상태입니다.`
        : "이번 밤에 유혹 대상은 없습니다.",
    ];

    await this.syncSecretChannels(client);
    await this.sendNightPrompts(client);
    await this.sendPhaseMessage(client, {
      title: `${this.nightNumber}번째 밤`,
      description: "개인 DM으로 행동을 제출해 주세요. 공개 채널에서는 결과만 안내합니다.",
    });
    await this.sendOrUpdateStatus(client);
    this.restartTimer(client, NIGHT_SECONDS * 1_000, () => this.finishNight(client));
  }

  private async finishNight(client: Client): Promise<void> {
    this.requirePhase("night");
    this.clearTimer();

    const summary = await this.resolveNight(client);
    this.dayNumber += 1;
    this.bulliedToday = new Set(this.bulliedNextDay);
    this.bulliedNextDay.clear();
    this.blockedTonightTargetId = null;
    await this.syncSecretChannels(client);

    const winner = this.getWinner();
    if (winner) {
      this.phase = "ended";
      this.phaseContext = null;
      this.lastPublicLines = [...summary.publicLines, `${winner} 승리`];
      await this.sendPhaseMessage(client, {
        title: "게임 종료",
        description: `${winner} 승리`,
        extraLines: summary.publicLines,
      });
      await this.sendOrUpdateStatus(client);
      await this.lockOrDeleteSecretChannels(client);
      this.onEnded(this.guildId);
      return;
    }

    await this.beginDiscussion(client, summary.publicLines);
  }

  private async beginDiscussion(client: Client, morningLines: string[]): Promise<void> {
    this.clearTimer();
    this.phase = "discussion";
    const duration = Math.max(this.alivePlayers.length, 1) * DISCUSSION_SECONDS_PER_PLAYER * 1_000;
    this.phaseContext = this.newPhaseContext(duration);
    this.lastPublicLines = morningLines;

    await this.syncSecretChannels(client);
    await this.sendPhaseMessage(client, {
      title: `${this.dayNumber}번째 낮`,
      description: "토론 시간입니다. 살아 있는 플레이어는 한 번씩 시간을 늘리거나 줄일 수 있습니다.",
      components: [this.buildTimeControls()],
      extraLines: morningLines,
    });
    await this.sendReporterPublishPrompt(client);
    await this.sendOrUpdateStatus(client);
    this.restartTimer(client, duration, () => this.finishDiscussion(client));
  }

  private async finishDiscussion(client: Client): Promise<void> {
    this.requirePhase("discussion");
    this.clearTimer();
    await this.beginVote(client);
  }

  private async beginVote(client: Client): Promise<void> {
    this.phase = "vote";
    this.phaseContext = this.newPhaseContext(VOTE_SECONDS * 1_000);
    this.dayVotes.clear();
    this.lastPublicLines = ["투표 시간입니다."];

    await this.sendVotePrompt(client);
    await this.sendMadamPrompt(client);
    await this.sendOrUpdateStatus(client);
    this.restartTimer(client, VOTE_SECONDS * 1_000, () => this.finishVote(client));
  }

  private async finishVote(client: Client): Promise<void> {
    this.requirePhase("vote");
    this.clearTimer();

    const tallied = new Map<string, number>();
    for (const [voterId, targetId] of this.dayVotes.entries()) {
      const voter = this.getPlayer(voterId);
      if (!voter || !voter.alive || this.bulliedToday.has(voterId)) {
        continue;
      }

      tallied.set(targetId, (tallied.get(targetId) ?? 0) + this.getVoteWeight(voter));
    }

    const ranked = [...tallied.entries()].sort((left, right) => right[1] - left[1]);
    if (ranked.length === 0) {
      this.lastPublicLines = ["아무도 투표하지 않아 바로 다음 밤으로 넘어갑니다."];
      await this.beginNight(client);
      return;
    }

    const [topTargetId, topVotes] = ranked[0];
    const isTie = ranked.length > 1 && ranked[1][1] === topVotes;
    if (isTie) {
      this.lastPublicLines = ["동률 최다 득표가 발생해 처형 없이 다음 밤으로 넘어갑니다."];
      await this.beginNight(client);
      return;
    }

    this.currentTrialTargetId = topTargetId;
    this.lastPublicLines = [
      `${this.getPlayerOrThrow(topTargetId).displayName} 님이 최다 득표(${topVotes}표)를 받아 최후의 반론에 올라갑니다.`,
    ];
    await this.beginDefense(client, topTargetId);
  }

  private async beginDefense(client: Client, targetId: string): Promise<void> {
    this.phase = "defense";
    this.phaseContext = this.newPhaseContext(DEFENSE_SECONDS * 1_000);
    this.currentTrialTargetId = targetId;

    await this.sendPhaseMessage(client, {
      title: "최후의 반론",
      description: `${this.getPlayerOrThrow(targetId).displayName} 님만 발언하는 단계입니다.`,
      extraLines: this.lastPublicLines,
    });

    if (this.isAliveRole(targetId, "terrorist")) {
      await this.sendTerrorBurnPrompt(client, targetId);
    }

    await this.sendOrUpdateStatus(client);
    this.restartTimer(client, DEFENSE_SECONDS * 1_000, () => this.finishDefense(client));
  }

  private async finishDefense(client: Client): Promise<void> {
    this.requirePhase("defense");
    this.clearTimer();
    await this.beginTrial(client);
  }

  private async beginTrial(client: Client): Promise<void> {
    if (!this.currentTrialTargetId) {
      throw new Error("찬반 투표 대상이 없습니다.");
    }

    this.phase = "trial";
    this.phaseContext = this.newPhaseContext(config.trialVoteSeconds * 1_000);
    this.trialVotes.clear();

    await this.sendPhaseMessage(client, {
      title: "찬반 투표",
      description: `${this.getPlayerOrThrow(this.currentTrialTargetId).displayName} 님을 처형할지 결정합니다.`,
      components: [this.buildTrialControls()],
      extraLines: this.lastPublicLines,
    });
    await this.sendOrUpdateStatus(client);
    this.restartTimer(client, config.trialVoteSeconds * 1_000, () => this.finishTrial(client));
  }

  private async finishTrial(client: Client): Promise<void> {
    this.requirePhase("trial");
    this.clearTimer();

    if (!this.currentTrialTargetId) {
      throw new Error("처형 대상이 없습니다.");
    }

    const totalWeight = this.alivePlayers.reduce((sum, player) => sum + this.getVoteWeight(player), 0);
    let yesWeight = 0;
    for (const player of this.alivePlayers) {
      if (this.bulliedToday.has(player.userId)) {
        continue;
      }

      if (this.trialVotes.get(player.userId) === "yes") {
        yesWeight += this.getVoteWeight(player);
      }
    }

    const convict = yesWeight >= Math.ceil(totalWeight / 2);
    const target = this.getPlayerOrThrow(this.currentTrialTargetId);
    const lines: string[] = [`찬성 ${yesWeight} / 전체 ${totalWeight} 표`];

    if (!convict) {
      lines.push("반대가 더 많아 처형되지 않았습니다.");
      this.lastPublicLines = lines;
      await this.beginNight(client);
      return;
    }

    if (target.role === "politician" && !this.isPoliticianEffectBlocked(target.userId)) {
      lines.push("정치인은 투표 처형되지 않습니다.");
      this.lastPublicLines = lines;
      await this.beginNight(client);
      return;
    }

    this.killPlayer(target.userId, "낮 투표 처형");
    lines.push(`${target.displayName} 님이 처형되었습니다.`);

    if (target.role === "terrorist") {
      const burn = this.pendingTrialBurns.get(target.userId);
      if (burn) {
        const burnTarget = this.getPlayer(burn.targetId);
        if (burnTarget && burnTarget.alive && getTeam(burnTarget.role) !== getTeam(target.role)) {
          this.killPlayer(burnTarget.userId, "테러리스트 산화");
          lines.push(`${burnTarget.displayName} 님이 테러리스트의 산화에 휘말렸습니다.`);
        }
      }
    }

    this.lastPublicLines = lines;
    await this.syncSecretChannels(client);
    const winner = this.getWinner();
    if (winner) {
      this.phase = "ended";
      this.phaseContext = null;
      this.lastPublicLines = [...lines, `${winner} 승리`];
      await this.sendPhaseMessage(client, {
        title: "게임 종료",
        description: `${winner} 승리`,
        extraLines: lines,
      });
      await this.sendOrUpdateStatus(client);
      await this.lockOrDeleteSecretChannels(client);
      this.onEnded(this.guildId);
      return;
    }

    await this.beginNight(client);
  }

  private async resolveNight(client: Client): Promise<ResolutionSummary> {
    const summary: ResolutionSummary = { publicLines: [], privateLines: [] };
    const nightDeathIds = new Set<string>();
    const markNightDeath = (userId: string, reason: string): void => {
      const player = this.getPlayer(userId);
      if (!player || !player.alive) {
        return;
      }

      this.killPlayer(userId, reason);
      nightDeathIds.add(userId);
    };

    const mafiaVotes = [...this.nightActions.values()].filter((action) => action.action === "mafiaKill");
    const mafiaResult = this.resolveMafiaKill(mafiaVotes);
    const protectedId = this.findActorTarget("doctorProtect");
    const beastAction = this.findActionByRole("beastman");
    const priestAction = this.findActionByRole("priest");
    const mediumAction = this.findActionByRole("medium");
    const thugAction = this.findActionByRole("thug");
    const reporterAction = this.findActionByRole("reporter");
    const spyAction = this.findActionByRole("spy");
    const policeAction = this.findActionByRole("police");
    const detectiveAction = this.findActionByRole("detective");
    const terroristAction = this.findActionByRole("terrorist");

    if (terroristAction) {
      this.getPlayerOrThrow(terroristAction.actorId).terrorMarkId = terroristAction.targetId;
    }

    const spyActions = [spyAction, this.findBonusActionByRole("spy")].filter((action): action is NightActionRecord => Boolean(action));
    for (const action of spyActions) {
      this.appendSpyInspectionResult(summary, action);
    }

    if (policeAction) {
      const target = this.getPlayerOrThrow(policeAction.targetId);
      summary.privateLines.push({
        userId: policeAction.actorId,
        line: `조사 결과: ${target.displayName} 님은 ${target.role === "mafia" ? "마피아입니다." : "마피아가 아닙니다."}`,
      });
    }

    if (detectiveAction) {
      const trackedAction = this.findSubmittedActionForActor(detectiveAction.targetId);
      summary.privateLines.push({
        userId: detectiveAction.actorId,
        line: trackedAction
          ? `${this.getPlayerOrThrow(detectiveAction.targetId).displayName} 님은 ${this.getPlayerOrThrow(trackedAction.targetId).displayName} 님을 선택했습니다.`
          : `${this.getPlayerOrThrow(detectiveAction.targetId).displayName} 님은 오늘 밤 눈에 띄는 행동을 하지 않았습니다.`,
      });
    }

    if (thugAction) {
      this.bulliedNextDay.add(thugAction.targetId);
    }

    let mafiaVictimId: string | null = mafiaResult.targetId;
    let mafiaVictimResolved = false;
    let actualMafiaVictimId: string | null = null;

    if (mafiaVictimId) {
      const target = this.getPlayerOrThrow(mafiaVictimId);
      if (target.role === "beastman" && this.ruleset === "balance") {
        this.contactPlayer(target.userId);
        mafiaVictimId = null;
        mafiaVictimResolved = true;
        summary.privateLines.push({
          userId: target.userId,
          line: "회피가 발동해 살아남았고, 즉시 마피아팀과 접선했습니다.",
        });
      }
    }

    if (mafiaVictimId && !mafiaVictimResolved) {
      const redirected = this.resolveLoverRedirect(mafiaVictimId, summary, mafiaResult.killerId);
      const finalVictimId = redirected ?? mafiaVictimId;
      const finalVictim = this.getPlayerOrThrow(finalVictimId);
      const soldierBlocked =
        this.ruleset === "balance" &&
        this.blockedTonightTargetId === finalVictimId &&
        finalVictim.role === "soldier";

      if (protectedId === finalVictimId) {
        summary.publicLines.push("의사의 치료로 아무도 죽지 않았습니다.");
      } else if (finalVictim.role === "soldier" && !finalVictim.soldierUsed && !soldierBlocked) {
        finalVictim.soldierUsed = true;
        summary.publicLines.push("군인의 방탄이 발동해 아무도 죽지 않았습니다.");
      } else {
        markNightDeath(finalVictimId, "마피아 처형");
        actualMafiaVictimId = finalVictimId;
        summary.publicLines.push(`${finalVictim.displayName} 님이 밤사이 사망했습니다.`);

        if (finalVictim.role === "terrorist" && finalVictim.terrorMarkId && finalVictim.terrorMarkId === mafiaResult.killerId) {
          const killer = mafiaResult.killerId ? this.getPlayer(mafiaResult.killerId) : undefined;
          if (killer && killer.alive) {
            markNightDeath(killer.userId, "테러리스트 자폭");
            summary.publicLines.push(`${killer.displayName} 님이 테러리스트의 자폭에 휘말렸습니다.`);
          }
        }
      }
    }

    if (
      actualMafiaVictimId &&
      beastAction &&
      beastAction.action === "beastMark" &&
      beastAction.targetId === actualMafiaVictimId
    ) {
      this.contactPlayer(beastAction.actorId);
      summary.privateLines.push({
        userId: beastAction.actorId,
        line: "표시한 대상이 실제로 마피아에게 살해되어 마피아팀과 접선했습니다.",
      });
    }

    if (beastAction && beastAction.action === "beastKill" && this.getAliveMafia().length === 0) {
      const target = this.getPlayer(beastAction.targetId);
      if (target && target.alive) {
        markNightDeath(target.userId, "짐승인간 처형");
        summary.publicLines.push(`${target.displayName} 님이 밤사이 사망했습니다.`);
      }
    }

    if (this.nightNumber === 1) {
      this.applyGraverobber(summary, actualMafiaVictimId);
    }

    if (reporterAction) {
      const target = this.getPlayer(reporterAction.targetId);
      const actor = this.getPlayerOrThrow(reporterAction.actorId);
      actor.reporterUsed = true;

      if (target && target.alive) {
        this.pendingArticle = {
          actorId: reporterAction.actorId,
          targetId: target.userId,
          role: target.role,
          publishFromDay: this.dayNumber + 2,
        };
        summary.privateLines.push({
          userId: reporterAction.actorId,
          line: `${target.displayName} 님의 기사를 준비했습니다. 공개 가능 시점은 ${this.dayNumber + 2}번째 낮입니다.`,
        });
      } else {
        summary.privateLines.push({
          userId: reporterAction.actorId,
          line: "취재 대상이 밤사이 사망해 기사 작성에 실패했습니다.",
        });
      }
    }

    if (mediumAction) {
      const target = this.getPlayerOrThrow(mediumAction.targetId);
      if (!target.alive) {
        target.ascended = true;
        summary.privateLines.push({
          userId: mediumAction.actorId,
          line: `${target.displayName} 님의 직업은 ${getRoleLabel(target.role)}였습니다.`,
        });
      } else {
        summary.privateLines.push({
          userId: mediumAction.actorId,
          line: "선택한 대상이 밤 종료 시점에 사망 상태가 아니라 성불에 실패했습니다.",
        });
      }
    }

    if (priestAction) {
      const actor = this.getPlayerOrThrow(priestAction.actorId);
      const target = this.getPlayer(priestAction.targetId);
      if (target) {
        if (!nightDeathIds.has(target.userId)) {
          summary.privateLines.push({
            userId: actor.userId,
            line: "선택한 대상이 이번 밤에 사망하지 않아 부활이 발동하지 않았습니다.",
          });
        } else {
          actor.priestUsed = true;
          const blockedByMedium = this.ruleset === "balance" && target.ascended;
          if (blockedByMedium) {
            summary.privateLines.push({
              userId: actor.userId,
              line: "영매가 먼저 성불시킨 대상이라 부활이 실패했습니다.",
            });
          } else if (!target.alive) {
            this.revivePlayer(target.userId);
            summary.publicLines.push(`${target.displayName} 님이 성직자의 힘으로 부활했습니다.`);
          }
        }
      }
    }

    if (summary.publicLines.length === 0) {
      summary.publicLines.push("조용하게 밤이 지나갔습니다.");
    }

    for (const line of summary.privateLines) {
      await this.safeSendDm(client, line.userId, line.line);
    }

    await this.syncSecretChannels(client);
    this.lastPublicLines = summary.publicLines;
    return summary;
  }

  private resolveMafiaKill(records: NightActionRecord[]): { targetId: string | null; killerId: string | null } {
    const eligible = records.filter((record) => {
      const actor = this.getPlayer(record.actorId);
      return actor && actor.alive && actor.role === "mafia" && !this.isBlockedTonight(actor.userId);
    });

    if (eligible.length === 0) {
      return { targetId: null, killerId: null };
    }

    const tallied = new Map<string, number>();
    for (const record of eligible) {
      tallied.set(record.targetId, (tallied.get(record.targetId) ?? 0) + 1);
    }

    const ranked = [...tallied.entries()].sort((left, right) => right[1] - left[1]);
    if (ranked.length === 0) {
      return { targetId: null, killerId: null };
    }

    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
      return { targetId: null, killerId: null };
    }

    const targetId = ranked[0][0];
    const killerId =
      eligible
        .filter((record) => record.targetId === targetId)
        .sort((left, right) => left.submittedAt - right.submittedAt)[0]?.actorId ?? null;

    return { targetId, killerId };
  }

  private resolveLoverRedirect(targetId: string, summary: ResolutionSummary, killerId: string | null): string | null {
    const target = this.getPlayerOrThrow(targetId);
    if (target.role !== "lover" || !target.loverId) {
      return null;
    }

    const partner = this.getPlayer(target.loverId);
    if (!partner || !partner.alive) {
      return null;
    }

    if (this.ruleset === "balance" && this.blockedTonightTargetId === partner.userId) {
      return null;
    }

    if (killerId) {
      summary.privateLines.push({
        userId: target.userId,
        line: `${this.getPlayerOrThrow(killerId).displayName} 님이 당신을 노린 마피아였습니다.`,
      });
    }
    return partner.userId;
  }

  private applyGraverobber(summary: ResolutionSummary, mafiaVictimId: string | null): void {
    if (!mafiaVictimId) {
      return;
    }

    const graverobber = this.alivePlayers.find((player) => player.role === "graverobber");
    const victim = this.getPlayer(mafiaVictimId);
    if (!graverobber || !victim) {
      return;
    }

    const stolenRole = victim.role;
    graverobber.role = stolenRole;
    victim.role = normalizeStolenRole(stolenRole, this.ruleset);
    summary.privateLines.push({
      userId: graverobber.userId,
      line: `도굴 성공: ${victim.displayName} 님의 직업 ${getRoleLabel(stolenRole)}를 얻었습니다.`,
    });

    if (stolenRole === "lover" && victim.loverId) {
      const partnerId = victim.loverId;
      victim.loverId = undefined;
      graverobber.loverId = partnerId;
      const partner = this.getPlayer(partnerId);
      if (partner) {
        partner.loverId = graverobber.userId;
        this.loverPair = [graverobber.userId, partner.userId];
      }
    }
  }

  private appendSpyInspectionResult(summary: ResolutionSummary, action: NightActionRecord): void {
    const target = this.getPlayerOrThrow(action.targetId);
    if (target.role === "soldier") {
      summary.privateLines.push({
        userId: action.actorId,
        line: `${target.displayName} 님은 군인이어서 조사 결과를 끝까지 확인하지 못했습니다.`,
      });
      summary.privateLines.push({
        userId: target.userId,
        line: `${this.getPlayerOrThrow(action.actorId).displayName} 님이 당신을 조사했습니다. 군인의 효과로 조사 부가효과가 무효화됩니다.`,
      });
      return;
    }

    summary.privateLines.push({
      userId: action.actorId,
      line: `조사 결과: ${target.displayName} 님은 ${getRoleLabel(target.role)}입니다.`,
    });
  }

  private async sendVotePrompt(client: Client): Promise<void> {
    await this.sendPhaseMessage(client, {
      title: "투표 시간",
      description: "드롭다운으로 한 명을 선택해 주세요.",
      components: [this.buildVoteControls()],
      extraLines: this.bulliedToday.size > 0 ? [`협박 대상: ${this.formatNames([...this.bulliedToday])}`] : undefined,
    });
  }

  private async sendMadamPrompt(client: Client): Promise<void> {
    const madam = this.alivePlayers.find((player) => player.role === "madam");
    if (!madam) {
      return;
    }

    const targets = this.alivePlayers.filter((player) => player.userId !== madam.userId).map((player) => player.userId);
    if (targets.length === 0) {
      return;
    }

    const user = await client.users.fetch(madam.userId);
    const dm = await user.createDM();
    await dm.send(this.buildMadamPayload(madam));
  }

  private async sendReporterPublishPrompt(client: Client): Promise<void> {
    if (!this.pendingArticle || this.dayNumber < this.pendingArticle.publishFromDay) {
      return;
    }

    const reporter = this.getPlayer(this.pendingArticle.actorId);
    if (!reporter || !reporter.alive) {
      return;
    }

    const user = await client.users.fetch(reporter.userId);
    const dm = await user.createDM();
    await dm.send(this.buildReporterPublishPayload());
  }

  private async sendTerrorBurnPrompt(client: Client, targetId: string): Promise<void> {
    const target = this.getPlayerOrThrow(targetId);
    const choices = this.alivePlayers.filter((player) => player.userId !== targetId).map((player) => player.userId);
    if (choices.length === 0) {
      return;
    }

    const user = await client.users.fetch(target.userId);
    const dm = await user.createDM();
    await dm.send(this.buildTerrorBurnPayload(target));
  }

  private async sendNightPrompts(client: Client): Promise<void> {
    for (const player of this.alivePlayers) {
      const prompt = this.getNightPrompt(player.userId);
      if (!prompt) {
        if (this.isBlockedTonight(player.userId)) {
          await this.safeSendDm(client, player.userId, "오늘 밤에는 유혹 상태라 능력을 사용할 수 없습니다.");
        }
        continue;
      }

      const user = await client.users.fetch(player.userId);
      const dm = await user.createDM();
      await dm.send(this.buildDirectActionPayload(player));
    }
  }

  private getNightPrompt(userId: string): PromptDefinition | null {
    const player = this.getPlayerOrThrow(userId);
    if (!player.alive) {
      return null;
    }

    if (this.isBlockedTonight(userId) && hasActiveNightAction(player.role)) {
      return null;
    }

    switch (player.role) {
      case "mafia":
        return {
          action: "mafiaKill",
          title: "마피아 처형 대상 선택",
          description: "밤이 끝날 때 가장 많이 선택된 대상이 처형됩니다.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "spy":
        return {
          action: "spyInspect",
          title: "스파이 조사",
          description: "조사할 플레이어 한 명을 선택하세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "beastman":
        if (player.isContacted && this.getAliveMafia().length === 0) {
          return {
            action: "beastKill",
            title: "짐승인간 처형 대상",
            description: "마피아가 전멸한 뒤에는 혼자 대상을 처형할 수 있습니다.",
            targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
          };
        }

        return {
          action: "beastMark",
          title: "짐승인간 표식",
          description: "표식을 남길 대상을 고르세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "police":
        return {
          action: "policeInspect",
          title: "경찰 조사",
          description: "마피아 여부를 확인할 대상을 고르세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "doctor":
        return {
          action: "doctorProtect",
          title: "의사 치료",
          description: "살릴 플레이어를 선택하세요. 자기 자신도 선택할 수 있습니다.",
          targets: this.alivePlayers.map((target) => target.userId),
        };
      case "medium": {
        return {
          action: "mediumAscend",
          title: "영매 성불",
          description: "밤이 끝났을 때 죽은 상태인 플레이어 한 명을 성불시켜 직업을 확인합니다.",
          targets: [...this.players.values()].filter((target) => !target.ascended).map((target) => target.userId),
        };
      }
      case "thug":
        return {
          action: "thugThreaten",
          title: "건달 협박",
          description: "내일 투표권을 빼앗을 플레이어를 고르세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "reporter":
        if (player.reporterUsed) {
          return null;
        }
        return {
          action: "reporterArticle",
          title: "기자 취재",
          description: "취재할 플레이어를 선택하세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "detective":
        return {
          action: "detectiveTrack",
          title: "탐정 조사",
          description: "행동 대상을 추적할 플레이어를 선택하세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "terrorist":
        return {
          action: "terrorMark",
          title: "테러리스트 자폭 표식",
          description: "오늘 밤 당신을 쏠 것 같은 대상을 선택하세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "priest": {
        if (player.priestUsed) {
          return null;
        }
        return {
          action: "priestRevive",
          title: "성직자 부활",
          description: "이번 밤에 사망하면 되살릴 플레이어 한 명을 선택하세요.",
          targets: this.alivePlayers.map((target) => target.userId),
        };
      }
      default:
        return null;
    }
  }

  private async prepareSecretChannels(client: Client): Promise<void> {
    const guild = await client.guilds.fetch(this.guildId);
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const hiddenBase = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];

    const category = await guild.channels.create({
      name: `mafia-${this.id}`,
      type: ChannelType.GuildCategory,
    });
    this.secretChannels.categoryId = category.id;

    const mafiaChannel = await guild.channels.create({
      name: "mafia-team",
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: hiddenBase,
    });
    this.secretChannels.mafiaId = mafiaChannel.id;

    if (this.loverPair) {
      const loverChannel = await guild.channels.create({
        name: "lovers",
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: hiddenBase,
      });
      this.secretChannels.loverId = loverChannel.id;
    }

    const graveyard = await guild.channels.create({
      name: "graveyard",
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: hiddenBase,
    });
    this.secretChannels.graveyardId = graveyard.id;

    await this.syncSecretChannels(client);
  }

  private async lockOrDeleteSecretChannels(client: Client): Promise<void> {
    const guild = await client.guilds.fetch(this.guildId);
    const ids = [this.secretChannels.mafiaId, this.secretChannels.loverId, this.secretChannels.graveyardId].filter(
      (value): value is string => Boolean(value),
    );

    if (config.autoDeleteSecretChannels) {
      for (const id of ids) {
        const channel = await guild.channels.fetch(id);
        if (channel) {
          await channel.delete().catch(() => undefined);
        }
      }
      if (this.secretChannels.categoryId) {
        const category = await guild.channels.fetch(this.secretChannels.categoryId);
        if (category) {
          await category.delete().catch(() => undefined);
        }
      }
      return;
    }

    for (const id of ids) {
      const channel = await guild.channels.fetch(id);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
          ViewChannel: false,
          SendMessages: false,
        });
      }
    }
  }

  private async syncSecretChannels(client: Client): Promise<void> {
    const mafiaChannel = await this.fetchSecretTextChannel(client, this.secretChannels.mafiaId);
    const loverChannel = await this.fetchSecretTextChannel(client, this.secretChannels.loverId);
    const graveyardChannel = await this.fetchSecretTextChannel(client, this.secretChannels.graveyardId);
    const deadIds = this.deadPlayers.map((player) => player.userId);

    if (mafiaChannel) {
      const mafiaIds = this.alivePlayers
        .filter((player) => player.role === "mafia" || player.isContacted)
        .map((player) => player.userId);
      const visibleIds = this.phase === "night" ? [...new Set([...mafiaIds, ...deadIds])] : mafiaIds;
      const sendIds = new Set(this.phase === "night" ? mafiaIds : []);
      await this.syncChannelMembers(mafiaChannel, visibleIds, false, sendIds);
    }

    if (loverChannel && this.loverPair) {
      const loverIds = this.loverPair.filter((userId) => this.getPlayer(userId)?.alive) as string[];
      const visibleIds = this.phase === "night" ? [...new Set([...loverIds, ...deadIds])] : loverIds;
      const sendIds = new Set(this.phase === "night" ? loverIds : []);
      await this.syncChannelMembers(loverChannel, visibleIds, false, sendIds);
    }

    if (graveyardChannel) {
      const visibleIds = new Set<string>();
      const sendIds = new Set<string>();

      if (this.phase === "night") {
        for (const player of this.deadPlayers) {
          visibleIds.add(player.userId);
          if (!player.ascended) {
            sendIds.add(player.userId);
          }
        }

        const medium = this.alivePlayers.find((player) => player.role === "medium");
        if (medium) {
          visibleIds.add(medium.userId);
          sendIds.add(medium.userId);
        }
      }

      await this.syncChannelMembers(graveyardChannel, [...visibleIds], false, sendIds);
    }
  }

  private async syncChannelMembers(
    channel: TextChannel,
    visibleIds: string[],
    sendEnabled: boolean,
    sendIds: Set<string> | null = null,
  ): Promise<void> {
    const desiredVisible = new Set(visibleIds);
    const desiredSend = sendIds ?? new Set(visibleIds.filter(() => sendEnabled));

    for (const player of this.players.values()) {
      await channel.permissionOverwrites.edit(player.userId, {
        ViewChannel: desiredVisible.has(player.userId),
        ReadMessageHistory: desiredVisible.has(player.userId),
        SendMessages: desiredSend.has(player.userId),
      });
    }
  }

  private async sendRoleCards(client: Client): Promise<void> {
    for (const player of this.players.values()) {
      await this.safeSendDm(client, player.userId, {
        embeds: [this.buildRoleEmbed(player)],
      });
    }
  }

  private buildRoleEmbed(player: PlayerState): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(isMafiaTeam(player.role) ? Colors.DarkRed : Colors.Blurple)
      .setTitle(`당신의 직업은 ${getRoleLabel(player.role)}입니다.`)
      .setDescription(getRoleSummary(player.role, this.ruleset))
      .addFields([
        { name: "팀", value: getTeamLabel(player.role), inline: true },
        { name: "규칙셋", value: this.ruleset === "balance" ? "시즌4 밸런스" : "시즌4 초기", inline: true },
      ]);

    if (player.role === "mafia") {
      const allies = this.alivePlayers.filter((seat) => seat.role === "mafia" && seat.userId !== player.userId);
      embed.addFields([
        {
          name: "동료 마피아",
          value: allies.length > 0 ? allies.map((ally) => ally.displayName).join(", ") : "없음",
        },
      ]);
    }

    if (player.role === "lover" && player.loverId) {
      embed.addFields([{ name: "연인", value: this.getPlayerOrThrow(player.loverId).displayName }]);
    }

    if ((player.role === "mafia" || player.isContacted) && this.secretChannels.mafiaId) {
      embed.addFields([{ name: "비밀 채널", value: `<#${this.secretChannels.mafiaId}>` }]);
    }

    if (player.role === "lover" && this.secretChannels.loverId) {
      embed.addFields([{ name: "연인 채널", value: `<#${this.secretChannels.loverId}>` }]);
    }

    if (player.role === "medium" && this.secretChannels.graveyardId) {
      embed.addFields([{ name: "망자 채널", value: `<#${this.secretChannels.graveyardId}>` }]);
    }

    return embed;
  }

  private buildLobbyEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle("마피아42 시즌4 로비")
      .setDescription(`규칙셋: ${this.ruleset === "balance" ? "시즌4 밸런스" : "시즌4 초기"}`)
      .addFields([
        {
          name: `참가자 (${this.players.size}/8)`,
          value: [...this.players.values()]
            .map((player, index) => `${index + 1}. ${player.displayName}${player.userId === this.hostId ? " (방장)" : ""}`)
            .join("\n"),
        },
        {
          name: "안내",
          value: "4명 이상이 되면 방장이 시작할 수 있습니다. 개인 DM이 열려 있어야 게임을 진행할 수 있습니다.",
        },
      ])
      .setFooter({ text: `게임 ID: ${this.id}` });
  }

  private buildStatusEmbed(): EmbedBuilder {
    const alive = this.alivePlayers
      .map((player, index) => `${index + 1}. ${player.displayName}${this.bulliedToday.has(player.userId) ? " (협박)" : ""}`)
      .join("\n") || "없음";
    const dead = this.deadPlayers
      .map((player) => `${player.displayName}${player.ascended ? " (성불)" : ""}`)
      .join("\n") || "없음";

    return new EmbedBuilder()
      .setColor(this.phase === "night" ? Colors.DarkBlue : this.phase === "ended" ? Colors.DarkButNotBlack : Colors.Gold)
      .setTitle(`마피아42 시즌4 ${this.ruleset === "balance" ? "밸런스" : "초기"} 게임`)
      .setDescription(
        [
          `상태: ${PHASE_LABELS[this.phase]}`,
          `밤: ${this.nightNumber} / 낮: ${this.dayNumber}`,
          this.phaseContext ? `마감: <t:${Math.floor(this.phaseContext.deadlineAt / 1000)}:R>` : "마감: 없음",
          this.currentTrialTargetId ? `현재 대상: ${this.getPlayerOrThrow(this.currentTrialTargetId).displayName}` : undefined,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
      )
      .addFields([
        { name: "생존", value: alive, inline: true },
        { name: "사망", value: dead, inline: true },
        { name: "최근 알림", value: this.lastPublicLines.join("\n") },
      ])
      .setFooter({ text: `게임 ID: ${this.id}` });
  }

  private buildLobbyControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`lobby:${this.id}:join`).setLabel("참가").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`lobby:${this.id}:leave`).setLabel("나가기").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`lobby:${this.id}:start`).setLabel("시작").setStyle(ButtonStyle.Primary),
    );
  }

  private buildVoteControls(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`vote:${this.id}:${this.phaseContext?.token ?? 0}`)
        .setPlaceholder("투표 대상을 선택하세요")
        .addOptions(
          this.alivePlayers.map((player) => ({
            label: player.displayName,
            value: player.userId,
          })),
        ),
    );
  }

  private buildTrialControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`trial:${this.id}:${this.phaseContext?.token ?? 0}:yes`).setLabel("찬성").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`trial:${this.id}:${this.phaseContext?.token ?? 0}:no`).setLabel("반대").setStyle(ButtonStyle.Secondary),
    );
  }

  private buildTimeControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`time:${this.id}:${this.phaseContext?.token ?? 0}:cut`).setLabel("-15초").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`time:${this.id}:${this.phaseContext?.token ?? 0}:add`).setLabel("+15초").setStyle(ButtonStyle.Success),
    );
  }

  private buildDirectActionPayload(player: PlayerState, selectedTargetId?: string) {
    const prompt = this.getNightPrompt(player.userId);
    if (!prompt) {
      return {
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Grey)
            .setTitle("오늘 밤 행동 없음")
            .setDescription("이번 밤에 사용할 수 있는 능력이 없습니다."),
        ],
      };
    }

    return {
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.DarkBlue)
          .setTitle(prompt.title)
          .setDescription(prompt.description)
          .addFields([
            {
              name: "현재 선택",
              value: selectedTargetId ? this.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
            },
          ]),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`night:${this.id}:${this.phaseContext?.token ?? 0}:${player.userId}:${prompt.action}`)
            .setPlaceholder("대상을 선택하세요")
            .addOptions(
              prompt.targets.map((targetId) => ({
                label: this.getPlayerOrThrow(targetId).displayName,
                value: targetId,
              })),
            ),
        ),
      ],
    };
  }

  private buildSpyBonusPayload(player: PlayerState, firstTargetId: string, secondTargetId?: string) {
    const targets = this.alivePlayers.filter((target) => target.userId !== player.userId).map((target) => target.userId);
    const contactLine = this.secretChannels.mafiaId ? `접선에 성공했습니다. 마피아 채널: <#${this.secretChannels.mafiaId}>` : "접선에 성공했습니다.";

    return {
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.DarkBlue)
          .setTitle("스파이 추가 조사")
          .setDescription(`첫 조사로 마피아를 찾아 ${contactLine} 같은 밤에 한 번 더 조사할 수 있습니다.`)
          .addFields([
            { name: "1차 선택", value: this.getPlayerOrThrow(firstTargetId).displayName },
            { name: "2차 선택", value: secondTargetId ? this.getPlayerOrThrow(secondTargetId).displayName : "아직 선택하지 않음" },
          ]),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`night:${this.id}:${this.phaseContext?.token ?? 0}:${player.userId}:spyInspectBonus`)
            .setPlaceholder("추가 조사 대상을 선택하세요")
            .addOptions(
              targets.map((targetId) => ({
                label: this.getPlayerOrThrow(targetId).displayName,
                value: targetId,
              })),
            ),
        ),
      ],
    };
  }

  private buildMadamPayload(player: PlayerState, selectedTargetId?: string) {
    const targets = this.alivePlayers.filter((target) => target.userId !== player.userId);
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Purple)
          .setTitle("마담 유혹 선택")
          .setDescription("투표 시간 동안 한 명을 유혹해 오늘 밤 효과를 막습니다.")
          .addFields([
            {
              name: "현재 선택",
              value: selectedTargetId ? this.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
            },
          ]),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`madam:${this.id}:${this.phaseContext?.token ?? 0}:${player.userId}:select`)
            .setPlaceholder("유혹 대상을 선택하세요")
            .addOptions(targets.map((target) => ({ label: target.displayName, value: target.userId }))),
        ),
      ],
    };
  }

  private buildReporterPublishPayload() {
    if (!this.pendingArticle) {
      throw new Error("공개할 기사가 없습니다.");
    }

    return {
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Blurple)
          .setTitle("기자 기사 공개")
          .setDescription(
            `${this.getPlayerOrThrow(this.pendingArticle.targetId).displayName} 님의 기사를 준비했습니다. 낮 동안 직접 공개할 수 있습니다.`,
          ),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`reporter:${this.id}:${this.dayNumber}:${this.pendingArticle.actorId}:publish`)
            .setLabel("기사 공개")
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    };
  }

  private buildTerrorBurnPayload(player: PlayerState, selectedTargetId?: string) {
    const targets = this.alivePlayers.filter((target) => target.userId !== player.userId);
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.DarkRed)
          .setTitle("테러리스트 산화 대상")
          .setDescription("처형될 경우 함께 끌고 갈 대상을 선택하세요.")
          .addFields([
            {
              name: "현재 선택",
              value: selectedTargetId ? this.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
            },
          ]),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`terror:${this.id}:${this.phaseContext?.token ?? 0}:${player.userId}:burn`)
            .setPlaceholder("산화 대상을 선택하세요")
            .addOptions(targets.map((target) => ({ label: target.displayName, value: target.userId }))),
        ),
      ],
    };
  }

  private async sendPhaseMessage(
    client: Client,
    options: {
      title: string;
      description: string;
      components?: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>;
      extraLines?: string[];
    },
  ): Promise<void> {
    const channel = await this.getPublicChannel(client);
    const embed = new EmbedBuilder()
      .setColor(this.phase === "night" ? Colors.DarkBlue : Colors.Gold)
      .setTitle(options.title)
      .setDescription(options.description);

    if (options.extraLines && options.extraLines.length > 0) {
      embed.addFields([{ name: "알림", value: options.extraLines.join("\n") }]);
    }

    const payload = {
      embeds: [embed],
      components: options.components ?? [],
    };

    if (this.phaseMessageId) {
      const previous = await this.fetchMessage(channel, this.phaseMessageId);
      if (previous) {
        await previous.edit(payload);
        return;
      }
    }

    const message = await channel.send(payload);
    this.phaseMessageId = message.id;
  }

  private assignLovers(): void {
    const lovers = [...this.players.values()].filter((player) => player.role === "lover");
    if (lovers.length === 2) {
      lovers[0].loverId = lovers[1].userId;
      lovers[1].loverId = lovers[0].userId;
      this.loverPair = [lovers[0].userId, lovers[1].userId];
    }
  }

  private contactPlayer(userId: string): void {
    const player = this.getPlayer(userId);
    if (!player) {
      return;
    }

    player.isContacted = true;
    this.contactedIds.add(userId);
  }

  private isBlockedTonight(userId: string): boolean {
    return this.blockedTonightTargetId === userId;
  }

  private isAliveRole(userId: string, role: Role): boolean {
    const player = this.getPlayer(userId);
    return Boolean(player && player.alive && player.role === role);
  }

  private getAliveMafia(): PlayerState[] {
    return this.alivePlayers.filter((player) => isMafiaTeam(player.role));
  }

  private getVoteWeight(player: PlayerState): number {
    if (player.role === "politician" && this.isPoliticianEffectBlocked(player.userId)) {
      return 1;
    }

    return player.role === "politician" ? 2 : 1;
  }

  private getWinner(): string | null {
    const alive = this.alivePlayers;
    const mafiaHeads = alive.filter((player) => isMafiaTeam(player.role)).length;
    const citizenHeads = alive.filter((player) => !isMafiaTeam(player.role)).length;

    if (mafiaHeads === 0) {
      return "시민팀";
    }

    if (mafiaHeads >= citizenHeads) {
      return "마피아팀";
    }

    return null;
  }

  private killPlayer(userId: string, reason: string): void {
    const player = this.getPlayerOrThrow(userId);
    if (!player.alive) {
      return;
    }

    player.alive = false;
    player.deadReason = reason;
    this.deadOrder.push(userId);
  }

  private revivePlayer(userId: string): void {
    const player = this.getPlayerOrThrow(userId);
    player.alive = true;
    player.deadReason = undefined;
    player.ascended = false;
  }

  private findActionByRole(role: Role): NightActionRecord | undefined {
    const actor = this.alivePlayers.find((player) => player.role === role);
    if (!actor) {
      return undefined;
    }

    return this.nightActions.get(actor.userId);
  }

  private findBonusActionByRole(role: Role): NightActionRecord | undefined {
    const actor = this.alivePlayers.find((player) => player.role === role);
    if (!actor) {
      return undefined;
    }

    return this.bonusNightActions.get(actor.userId);
  }

  private findSubmittedActionForActor(userId: string): NightActionRecord | undefined {
    const actions = [this.nightActions.get(userId), this.bonusNightActions.get(userId)].filter(
      (action): action is NightActionRecord => Boolean(action),
    );

    if (actions.length === 0) {
      return undefined;
    }

    return actions.sort((left, right) => right.submittedAt - left.submittedAt)[0];
  }

  private findActorTarget(actionType: NightActionType): string | null {
    return [...this.nightActions.values()].find((action) => action.action === actionType)?.targetId ?? null;
  }

  private isPoliticianEffectBlocked(userId: string): boolean {
    return this.ruleset === "balance" && this.pendingSeductionTargetId === userId;
  }

  private requirePhase(expected: Phase): void {
    if (this.phase !== expected) {
      throw new Error(`현재 단계는 ${PHASE_LABELS[this.phase]}입니다.`);
    }
  }

  private requirePhaseToken(customId: string): void {
    const tokenRaw = customId.split(":")[2];
    const token = Number.parseInt(tokenRaw, 10);
    if (token !== this.phaseContext?.token) {
      throw new Error("이미 만료된 상호작용입니다.");
    }
  }

  private assertAliveParticipant(userId: string): PlayerState {
    const player = this.getPlayer(userId);
    if (!player || !player.alive) {
      throw new Error("살아 있는 참가자만 사용할 수 있습니다.");
    }

    return player;
  }

  private newPhaseContext(durationMs: number): PhaseContext {
    const token = (this.phaseContext?.token ?? 0) + 1;
    return { token, startedAt: Date.now(), deadlineAt: Date.now() + durationMs };
  }

  private clearTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  private restartTimer(client: Client, durationMs: number, callback: () => Promise<void>): void {
    this.clearTimer();
    this.phaseTimer = setTimeout(() => {
      callback().catch((error: unknown) => {
        console.error("phase timer error", error);
        this.end(client, "타이머 처리 중 오류가 발생해 게임을 종료했습니다.").catch(console.error);
      });
    }, durationMs);
  }

  private async safeSendDm(client: Client, userId: string, payload: string | { embeds: EmbedBuilder[] }): Promise<void> {
    const user = await client.users.fetch(userId);
    await user.send(payload as never);
  }

  private async getPublicChannel(client: Client): Promise<TextChannel> {
    const channel = await client.channels.fetch(this.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("공개 채널을 찾을 수 없습니다.");
    }

    return channel as TextChannel;
  }

  private async fetchSecretTextChannel(client: Client, channelId?: string): Promise<TextChannel | null> {
    if (!channelId) {
      return null;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return null;
    }

    return channel as TextChannel;
  }

  private async fetchMessage(channel: TextBasedChannel, messageId: string): Promise<Message | null> {
    try {
      return await channel.messages.fetch(messageId);
    } catch {
      return null;
    }
  }

  private formatNames(userIds: string[]): string {
    return userIds.map((userId) => this.getPlayerOrThrow(userId).displayName).join(", ");
  }
}

export function createGame(manager: GameManager, interaction: ChatInputCommandInteraction, ruleset: Ruleset): MafiaGame {
  const guild = interaction.guild;
  const member = interaction.member as GuildMember | null;
  if (!guild || !member || !interaction.channelId) {
    throw new Error("서버 텍스트 채널에서만 게임을 만들 수 있습니다.");
  }

  return manager.create(guild, interaction.channelId, member, ruleset);
}

function createPlayer(member: GuildMember): PlayerState {
  return {
    userId: member.id,
    displayName: member.displayName,
    role: "citizen",
    originalRole: "citizen",
    alive: true,
    deadReason: undefined,
    isContacted: false,
    loverId: undefined,
    ascended: false,
    soldierUsed: false,
    reporterUsed: false,
    priestUsed: false,
    terrorMarkId: undefined,
    voteLockedToday: false,
    timeAdjustUsedOnDay: null,
  };
}

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function hasActiveNightAction(role: Role): boolean {
  return [
    "mafia",
    "spy",
    "beastman",
    "police",
    "doctor",
    "medium",
    "thug",
    "reporter",
    "detective",
    "terrorist",
    "priest",
  ].includes(role);
}
