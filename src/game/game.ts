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
  MessageFlags,
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

export type TimeAdjust = "add" | "cut";
export const DISCUSSION_TIME_ADJUST_SECONDS = 10;

export interface NightSelectionRequest {
  kind: "night" | "aftermath" | "madam" | "terror";
  actorId: string;
  action?: string;
  targetId: string;
  token: number;
}

interface NightSelectionResult {
  payload?: unknown;
}

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: "로비",
  night: "밤",
  discussion: "낮 토론",
  vote: "투표",
  defense: "최후의 반론",
  trial: "찬반 투표",
  ended: "종료",
};

export const NIGHT_SECONDS = 25;
export const FIRST_NIGHT_EXTRA_SECONDS = 15;
export const DISCUSSION_SECONDS_PER_PLAYER = 15;
export const VOTE_SECONDS = 15;
export const DEFENSE_SECONDS = 15;
const AFTERMATH_SELECTION_SECONDS = 15;

const DAY_BREAK_LABELS = ["", "첫째 날", "둘째 날", "셋째 날", "넷째 날", "다섯째 날", "여섯째 날", "일곱째 날", "여덟째 날"];

interface PromptDefinition {
  action: NightActionType;
  title: string;
  description: string;
  targets: string[];
}

export interface AftermathChoice {
  token: number;
  actorId: string;
  action: "mediumAscend" | "priestRevive";
  title: string;
  description: string;
  targetIds: string[];
  resolve: (targetId: string | null) => void;
  timeout: NodeJS.Timeout;
}

export type GameDeliveryMode = "discord-dm" | "web";
export type WebChatChannel = "public" | "mafia" | "lover" | "graveyard";

export interface WebChatMessage {
  id: string;
  channel: WebChatChannel;
  kind: "player" | "system";
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
}

export interface WebPrivateLogEntry {
  id: string;
  line: string;
  createdAt: number;
}

export type AudioCueKey =
  | "beast_howling"
  | "camera_shutter"
  | "explosion"
  | "gunshots"
  | "revive"
  | "doctor_save"
  | "charm"
  | "door"
  | "magical"
  | "punch"
  | "rogerthatover"
  | "gavel";

export interface VisibleAudioCue {
  id: string;
  key: AudioCueKey;
  createdAt: number;
}

interface QueuedAudioCue extends VisibleAudioCue {
  recipientIds: string[] | null;
}

export interface GameRegistry {
  onGameStateChange?: (gameId: string) => void;
  get(guildId: string): MafiaGame | undefined;
  findByGameId(gameId: string): MafiaGame | undefined;
  create(guild: Guild, channelId: string, host: GuildMember, ruleset: Ruleset): MafiaGame;
  delete(guildId: string): void;
}

export class InMemoryGameRegistry implements GameRegistry {
  private readonly games = new Map<string, MafiaGame>();
  public onGameStateChange?: (gameId: string) => void;

  constructor(public readonly onEnded?: (game: MafiaGame) => void) {}

  get(guildId: string): MafiaGame | undefined {
    return this.games.get(guildId);
  }

  findByGameId(gameId: string): MafiaGame | undefined {
    return [...this.games.values()].find((game) => game.id === gameId);
  }

  create(guild: Guild, channelId: string, host: GuildMember, ruleset: Ruleset): MafiaGame {
    const existing = this.games.get(guild.id);
    if (existing && existing.phase !== "ended") {
      throw new Error("이 서버에는 이미 진행 중인 마피아 게임이 있습니다.");
    }

    let game!: MafiaGame;
    game = new MafiaGame(
      guild,
      channelId,
      host,
      ruleset,
      (guildId) => {
        const endedGame = this.games.get(guildId);
        if (endedGame) {
          this.onEnded?.(endedGame);
        }
      },
      config.gameDeliveryMode,
      (g) => this.onGameStateChange?.(g.id),
    );
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
  readonly guildName: string | null;
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
  readonly webChats: Record<WebChatChannel, WebChatMessage[]> = {
    public: [],
    mafia: [],
    lover: [],
    graveyard: [],
  };
  readonly privateLogs = new Map<string, WebPrivateLogEntry[]>();
  readonly audioCues: QueuedAudioCue[] = [];

  phase: Phase = "lobby";
  phaseContext: PhaseContext | null = null;
  createdAt = Date.now();
  startedAt: number | null = null;
  endedAt: number | null = null;
  dayNumber = 0;
  nightNumber = 0;
  currentTrialTargetId: string | null = null;
  blockedTonightTargetId: string | null = null;
  pendingSeductionTargetId: string | null = null;
  bulliedToday = new Set<string>();
  bulliedNextDay = new Set<string>();
  pendingArticle: PendingArticle | null = null;
  lastPublicLines: string[] = ["게임이 생성되었습니다."];
  endedWinner: string | null = null;
  endedReason: string | null = null;
  lobbyMessageId: string | null = null;
  statusMessageId: string | null = null;
  phaseMessageId: string | null = null;
  phaseTimer: NodeJS.Timeout | null = null;
  loverPair: [string, string] | null = null;
  pendingAftermathChoice: AftermathChoice | null = null;
  stateVersion = 1;

  constructor(
    guild: Guild,
    channelId: string,
    host: GuildMember,
    ruleset: Ruleset,
    public readonly onEnded: (guildId: string) => void,
    readonly deliveryMode: GameDeliveryMode = "discord-dm",
    public onStateChange?: (game: MafiaGame) => void,
  ) {
    this.id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
      .toString()
      .padStart(4, "0")}`;
    this.guildId = guild.id;
    this.guildName = typeof guild.name === "string" ? guild.name : null;
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

  hasParticipant(userId: string): boolean {
    return this.players.has(userId);
  }

  bumpStateVersion(): number {
    this.stateVersion += 1;
    this.onStateChange?.(this);
    return this.stateVersion;
  }

  getPrivateLog(userId: string): WebPrivateLogEntry[] {
    return [...(this.privateLogs.get(userId) ?? [])];
  }

  getAudioCuesForUser(userId: string): VisibleAudioCue[] {
    return this.audioCues
      .filter((cue) => cue.recipientIds === null || cue.recipientIds.includes(userId))
      .map(({ id, key, createdAt }) => ({ id, key, createdAt }));
  }

  getNightPromptForPlayer(userId: string): PromptDefinition | null {
    return this.getNightPrompt(userId);
  }

  appendPrivateLog(userId: string, line: string): void {
    const entries = this.privateLogs.get(userId) ?? [];
    entries.push({
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
        .toString()
        .padStart(4, "0")}`,
      line,
      createdAt: Date.now(),
    });
    this.privateLogs.set(userId, entries);
    this.bumpStateVersion();
  }

  public setPublicLines(lines: string[], chatLines: string[] = lines): void {
    this.lastPublicLines = [...lines];
    for (const line of chatLines) {
      this.appendSystemChat("public", line);
    }
    this.bumpStateVersion();
  }

  public appendPublicLine(line: string): void {
    this.lastPublicLines = [...this.lastPublicLines, line];
    this.appendSystemChat("public", line);
    this.bumpStateVersion();
  }

  public appendPublicActivityLog(line: string): void {
    this.appendSystemChat("public", line);
    this.bumpStateVersion();
  }

  public appendSystemChat(channel: WebChatChannel, content: string): WebChatMessage {
    const message: WebChatMessage = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
        .toString()
        .padStart(4, "0")}`,
      channel,
      kind: "system",
      authorId: "system",
      authorName: "시스템",
      content,
      createdAt: Date.now(),
    };
    this.webChats[channel].push(message);
    return message;
  }

  canReadChat(userId: string, channel: WebChatChannel): boolean {
    const player = this.getPlayer(userId);
    if (!player) {
      return false;
    }

    switch (channel) {
      case "public":
        return true;
      case "mafia":
      case "lover":
      case "graveyard":
        return this.getSecretChatAccess(channel).readableIds.has(userId);
      default:
        return false;
    }
  }

  canWriteChat(userId: string, channel: WebChatChannel): boolean {
    const player = this.getPlayer(userId);
    if (!player || !this.canReadChat(userId, channel)) {
      return false;
    }

    switch (channel) {
      case "public":
        if (!player.alive) {
          return false;
        }
        if (this.phase === "discussion") {
          return true;
        }
        if (this.phase === "defense") {
          return this.currentTrialTargetId === userId;
        }
        return false;
      case "mafia":
      case "lover":
      case "graveyard":
        return this.getSecretChatAccess(channel).writableIds.has(userId);
      default:
        return false;
    }
  }

  sendChat(userId: string, channel: WebChatChannel, content: string): WebChatMessage {
    const player = this.getPlayer(userId);
    if (!player) {
      throw new Error("게임 참가자를 찾을 수 없습니다.");
    }

    const normalized = content.trim();
    if (!normalized) {
      throw new Error("메시지를 입력해 주세요.");
    }

    if (normalized.length > 500) {
      throw new Error("메시지는 500자 이하로 입력해 주세요.");
    }

    if (!this.canWriteChat(userId, channel)) {
      throw new Error("현재 이 채팅에 쓸 수 없습니다.");
    }

    const message: WebChatMessage = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
        .toString()
        .padStart(4, "0")}`,
      channel,
      kind: "player",
      authorId: userId,
      authorName: player.displayName,
      content: normalized,
      createdAt: Date.now(),
    };
    this.webChats[channel].push(message);
    this.bumpStateVersion();
    return message;
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
    this.setPublicLines([`${member.displayName} 님이 로비에 참가했습니다.`]);
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
    this.setPublicLines([`${player.displayName} 님이 로비에서 나갔습니다.`]);
  }

  async sendOrUpdateLobby(client: Client): Promise<void> {
    this.bumpStateVersion();
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
    this.endedWinner = null;
    this.endedReason = null;
    this.startedAt = Date.now();
    this.endedAt = null;
    await this.prepareSecretChannels(client);
    await this.sendRoleCards(client);

    this.phase = "night";
    // this.setPublicLines(["게임이 시작되었습니다.", `시즌4 ${this.ruleset === "balance" ? "밸런스" : "초기"} 규칙으로 진행합니다.`]);
    this.setPublicLines(["게임이 시작되었습니다.", "시즌4 밸런스 규칙으로 진행합니다."]);
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
    this.endedWinner = null;
    this.endedReason = reason;
    this.endedAt = Date.now();
    this.setPublicLines([reason]);
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
      await interaction.reply({ content: "로비에 참가했습니다.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === "leave") {
      this.removePlayer(interaction.user.id);
      await this.sendOrUpdateLobby(client);
      await interaction.reply({ content: "로비에서 나갔습니다.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.user.id !== this.hostId) {
      throw new Error("게임 시작은 방장만 할 수 있습니다.");
    }

    await interaction.reply({ content: "게임을 시작합니다. DM을 확인해 주세요.", flags: MessageFlags.Ephemeral });
    await this.start(client);
  }

  async handleVoteSelect(client: Client, interaction: StringSelectMenuInteraction): Promise<void> {
    const [targetId] = interaction.values;
    const content = await this.submitVote(client, interaction.user.id, targetId, this.readPhaseToken(interaction.customId));
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  async submitVote(client: Client, userId: string, targetId: string, token?: number): Promise<string> {
    this.requirePhase("vote");
    this.requirePhaseTokenValue(token);

    const player = this.assertAliveParticipant(userId);
    if (this.bulliedToday.has(player.userId)) {
      throw new Error("협박당한 플레이어는 오늘 투표할 수 없습니다.");
    }

    const target = this.getPlayer(targetId);
    if (!target || !target.alive) {
      throw new Error("살아 있는 투표 대상만 선택할 수 있습니다.");
    }

    if (player.voteLockedToday || this.dayVotes.has(player.userId)) {
      throw new Error("이미 낮 투표를 제출했습니다.");
    }

    player.voteLockedToday = true;
    this.dayVotes.set(player.userId, targetId);
    this.appendPublicActivityLog(`누군가가 ${target.displayName} 님에게 투표했습니다.`);
    await this.sendOrUpdateStatus(client);
    return `${target.displayName} 님에게 투표했습니다.`;
  }

  async handleTrialVote(client: Client, interaction: ButtonInteraction, vote: "yes" | "no"): Promise<void> {
    const content = await this.submitTrialVote(client, interaction.user.id, vote, this.readPhaseToken(interaction.customId));
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  }

  async submitTrialVote(client: Client, userId: string, vote: "yes" | "no", token?: number): Promise<string> {
    this.requirePhase("trial");
    this.requirePhaseTokenValue(token);

    const player = this.assertAliveParticipant(userId);
    if (this.bulliedToday.has(player.userId)) {
      throw new Error("협박당한 플레이어는 찬반 투표도 할 수 없습니다.");
    }

    if (this.trialVotes.has(player.userId)) {
      throw new Error("이미 찬반 투표를 제출했습니다.");
    }

    this.trialVotes.set(player.userId, vote);
    this.appendPublicActivityLog(vote === "yes" ? "누군가가 찬성에 투표했습니다." : "누군가가 반대에 투표했습니다.");
    await this.sendOrUpdateStatus(client);
    return vote === "yes" ? "처형 찬성에 투표했습니다." : "처형 반대에 투표했습니다.";
  }

  async handleTimeAdjust(client: Client, interaction: ButtonInteraction, direction: TimeAdjust): Promise<void> {
    const content = await this.adjustDiscussionTime(client, interaction.user.id, direction, this.readPhaseToken(interaction.customId));
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  }

  async adjustDiscussionTime(client: Client, userId: string, direction: TimeAdjust, token?: number): Promise<string> {
    this.requirePhase("discussion");
    this.requirePhaseTokenValue(token);

    const player = this.assertAliveParticipant(userId);
    if (player.timeAdjustUsedOnDay === this.dayNumber) {
      throw new Error("토론 시간 조절은 하루에 한 번만 가능합니다.");
    }

    if (!this.phaseContext) {
      throw new Error("토론 시간이 없습니다.");
    }

    const adjustLabel = `${DISCUSSION_TIME_ADJUST_SECONDS}초`;
    const delta = direction === "add" ? DISCUSSION_TIME_ADJUST_SECONDS * 1_000 : -DISCUSSION_TIME_ADJUST_SECONDS * 1_000;
    player.timeAdjustUsedOnDay = this.dayNumber;
    this.phaseContext.deadlineAt = Math.max(Date.now() + 5_000, this.phaseContext.deadlineAt + delta);
    this.restartTimer(client, this.phaseContext.deadlineAt - Date.now(), () => this.finishDiscussion(client));
    this.appendPublicActivityLog(
      direction === "add"
        ? `${player.displayName} 님이 토론 시간을 ${adjustLabel} 늘렸습니다.`
        : `${player.displayName} 님이 토론 시간을 ${adjustLabel} 줄였습니다.`,
    );
    await this.sendOrUpdateStatus(client);
    return direction === "add" ? `토론 시간을 ${adjustLabel} 늘렸습니다.` : `토론 시간을 ${adjustLabel} 줄였습니다.`;
  }

  async handleReporterPublish(client: Client, interaction: ButtonInteraction): Promise<void> {
    const [kind, gameId, dayRaw, actorId, action] = interaction.customId.split(":");
    if (kind !== "reporter" || gameId !== this.id || action !== "publish") {
      throw new Error("기자 기사 공개 메시지가 아닙니다.");
    }

    const content = await this.publishReporterArticle(client, interaction.user.id, actorId, Number.parseInt(dayRaw, 10));
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  async publishReporterArticle(client: Client, userId: string, actorId = userId, day = this.dayNumber): Promise<string> {
    if (userId !== actorId) {
      throw new Error("이 메시지는 본인만 사용할 수 있습니다.");
    }

    if (this.phase === "night" || this.phase === "lobby" || this.phase === "ended") {
      throw new Error("기사는 낮에만 공개할 수 있습니다.");
    }

    if (day !== this.dayNumber) {
      throw new Error("이미 지나간 낮의 기사 공개 버튼입니다.");
    }

    this.assertAliveParticipant(actorId);

    if (!this.pendingArticle || this.pendingArticle.actorId !== actorId || this.dayNumber < this.pendingArticle.publishFromDay) {
      throw new Error("지금 공개할 수 있는 기사가 없습니다.");
    }

    const articleLine = `기자 기사: ${this.getPlayerOrThrow(this.pendingArticle.targetId).displayName} 님의 직업은 ${getRoleLabel(this.pendingArticle.role)}입니다.`;
    const channel = await this.getPublicChannel(client);
    await channel.send({
      embeds: [new EmbedBuilder().setColor(Colors.Blurple).setTitle("기자 기사").setDescription(articleLine)],
    });

    this.queueAudioCue("camera_shutter");
    this.pendingArticle = null;
    this.appendPublicLine(articleLine);
    await this.sendOrUpdateStatus(client);
    return "기사를 공개했습니다.";
  }

  async handleNightSelect(client: Client, interaction: StringSelectMenuInteraction): Promise<void> {
    const [kind, gameId, tokenRaw, actorId, action] = interaction.customId.split(":");
    if (gameId !== this.id) {
      throw new Error("다른 게임의 메시지입니다.");
    }

    const [targetId] = interaction.values;
    const result = await this.submitNightSelection(client, {
      kind: kind as NightSelectionRequest["kind"],
      actorId,
      action,
      targetId,
      token: Number.parseInt(tokenRaw, 10),
    }, interaction.user.id);

    if (result.payload) {
      await interaction.update(result.payload as never);
      return;
    }
    throw new Error("갱신할 상호작용 payload 가 없습니다.");
  }

  async submitNightSelection(
    client: Client,
    request: NightSelectionRequest,
    userId = request.actorId,
  ): Promise<NightSelectionResult> {
    if (userId !== request.actorId) {
      throw new Error("이 메시지는 본인만 사용할 수 있습니다.");
    }

    this.requirePhaseTokenValue(request.token, "이미 지나간 단계의 선택지입니다.");

    const actor = this.assertAliveParticipant(request.actorId);
    const { kind, action, targetId } = request;

    if (kind === "aftermath") {
      const choice = this.pendingAftermathChoice;
      if (!choice) {
        throw new Error("이미 끝난 후속 선택입니다.");
      }

      if (request.token !== choice.token || choice.actorId !== request.actorId || choice.action !== action) {
        throw new Error("이미 만료된 선택지입니다.");
      }

      if (!choice.targetIds.includes(targetId)) {
        throw new Error("선택할 수 없는 대상입니다.");
      }

      choice.resolve(targetId);
      if (choice.action === "mediumAscend") {
        this.queueAudioCue("magical", [request.actorId, targetId]);
      }
      this.bumpStateVersion();
      return { payload: this.buildAftermathPayload(choice, targetId) };
    }

    if (kind === "night") {
      this.requirePhase("night");

      if (action === "spyInspectBonus") {
        if (actor.role !== "spy") {
          throw new Error("스파이만 추가 조사를 할 수 있습니다.");
        }

        const primaryAction = this.nightActions.get(request.actorId);
        if (!primaryAction || primaryAction.action !== "spyInspect" || !this.spyBonusGrantedTonight.has(request.actorId)) {
          throw new Error("추가 조사 권한이 없습니다.");
        }

        this.assertAllowedTarget(
          this.alivePlayers.filter((target) => target.userId !== actor.userId).map((target) => target.userId),
          targetId,
        );

        const bonusRecord: NightActionRecord = {
          actorId: request.actorId,
          action: "spyInspect",
          targetId,
          submittedAt: Date.now(),
        };
        this.bonusNightActions.set(request.actorId, bonusRecord);
        this.bumpStateVersion();
        return { payload: this.buildSpyBonusPayload(actor, primaryAction.targetId, bonusRecord.targetId) };
      }

      const prompt = this.validateNightSelection(actor, action, targetId);

      const record: NightActionRecord = {
        actorId: request.actorId,
        action: prompt.action,
        targetId,
        submittedAt: Date.now(),
      };
      this.nightActions.set(request.actorId, record);

      if (record.action === "spyInspect" && actor.role === "spy" && !actor.isContacted) {
        const target = this.getPlayerOrThrow(targetId);
        if (target.role === "mafia") {
          this.contactPlayer(request.actorId);
          this.spyBonusGrantedTonight.add(request.actorId);
          this.queueAudioCue("door", [request.actorId, target.userId]);
          this.bumpStateVersion();
          await this.syncSecretChannels(client);
          return { payload: this.buildSpyBonusPayload(actor, record.targetId) };
        }
      }

      if (record.action === "thugThreaten") {
        this.queueAudioCue("punch", [request.actorId, targetId]);
      }

      if (record.action === "policeInspect") {
        this.queueAudioCue("rogerthatover", [request.actorId]);
      }

      this.bumpStateVersion();
      return { payload: this.buildDirectActionPayload(actor, record.targetId) };
    }

    if (kind === "madam") {
      if (this.phase !== "vote") {
        throw new Error("지금은 유혹을 선택할 수 없습니다.");
      }

      if (actor.role !== "madam") {
        throw new Error("마담만 유혹을 선택할 수 있습니다.");
      }

      this.assertAllowedTarget(
        this.alivePlayers.filter((target) => target.userId !== actor.userId).map((target) => target.userId),
        targetId,
      );

      this.pendingSeductionTargetId = targetId;
      if (this.isAliveRole(targetId, "mafia")) {
        this.contactPlayer(request.actorId);
      }

      this.queueAudioCue("charm", [targetId]);
      await this.sendOrUpdateStatus(client);
      return { payload: this.buildMadamPayload(actor, targetId) };
    }

    if (kind === "terror") {
      if (this.phase !== "defense") {
        throw new Error("지금은 산화 대상을 고를 수 없습니다.");
      }

      if (actor.role !== "terrorist" || this.currentTrialTargetId !== actor.userId) {
        throw new Error("지금은 산화 대상을 고를 수 없습니다.");
      }

      this.assertAllowedTarget(
        this.alivePlayers.filter((target) => target.userId !== actor.userId).map((target) => target.userId),
        targetId,
      );

      this.pendingTrialBurns.set(request.actorId, { actorId: request.actorId, targetId });
      this.bumpStateVersion();
      return { payload: this.buildTerrorBurnPayload(actor, targetId) };
    }

    throw new Error("알 수 없는 선택 상호작용입니다.");
  }

  async sendOrUpdateStatus(client: Client): Promise<void> {
    this.bumpStateVersion();
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

  public async beginNight(client: Client): Promise<void> {
      return require("./phase").startNight(this, client);
  }

  public async finishNight(client: Client): Promise<void> {
      return require("./phase").finishNight(this, client);
  }

  public async beginDiscussion(client: Client, morningLines: string[]): Promise<void> {
      return require("./phase").startDiscussion(this, client, morningLines);
  }

  public async finishDiscussion(client: Client): Promise<void> {
      return require("./phase").finishDiscussion(this, client);
  }

  public async beginVote(client: Client): Promise<void> {
      return require("./phase").startVote(this, client);
  }

  public async finishVote(client: Client): Promise<void> {
      return require("./phase").finishVote(this, client);
  }

  public async beginDefense(client: Client, targetId: string): Promise<void> {
      return require("./phase").startDefense(this, client, targetId);
  }

  public async finishDefense(client: Client): Promise<void> {
      return require("./phase").finishDefense(this, client);
  }

  public async beginTrial(client: Client): Promise<void> {
      return require("./phase").startTrial(this, client);
  }

  public async finishTrial(client: Client): Promise<void> {
      return require("./phase").finishTrial(this, client);
  }

  public async resolveNight(client: Client): Promise<ResolutionSummary> {
      return require("./resolution").resolveNight(this, client);
  }

  public resolveMafiaKill(records: NightActionRecord[]): { targetId: string | null; killerId: string | null } {
      return require("./resolution").resolveMafiaKill(this, records);
  }

  public resolveLoverRedirect(targetId: string, summary: ResolutionSummary, killerId: string | null): string | null {
      return require("./resolution").resolveLoverRedirect(this, targetId, summary, killerId);
  }

  public applyGraverobber(summary: ResolutionSummary, mafiaVictimId: string | null): void {
      return require("./resolution").applyGraverobber(this, summary, mafiaVictimId);
  }

  public appendSpyInspectionResult(summary: ResolutionSummary, action: NightActionRecord): void {
      return require("./resolution").appendSpyInspectionResult(this, summary, action);
  }

  public async sendVotePrompt(client: Client): Promise<void> {
    await this.sendPhaseMessage(client, {
      title: "투표 시간",
      description:
        this.deliveryMode === "web" ? "웹 대시보드에서 한 명을 선택해 주세요." : "드롭다운으로 한 명을 선택해 주세요.",
      components: this.deliveryMode === "web" ? [] : [this.buildVoteControls()],
      extraLines: this.bulliedToday.size > 0 ? [`협박 대상: ${this.formatNames([...this.bulliedToday])}`] : undefined,
    });
  }

  public async sendMadamPrompt(client: Client): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

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

  public async sendReporterPublishPrompt(client: Client): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

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

  public async sendTerrorBurnPrompt(client: Client, targetId: string): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

    const target = this.getPlayerOrThrow(targetId);
    const choices = this.alivePlayers.filter((player) => player.userId !== targetId).map((player) => player.userId);
    if (choices.length === 0) {
      return;
    }

    const user = await client.users.fetch(target.userId);
    const dm = await user.createDM();
    await dm.send(this.buildTerrorBurnPayload(target));
  }

  public async sendNightPrompts(client: Client): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

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

  public getNightPrompt(userId: string): PromptDefinition | null {
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
          description: "마지막으로 제출한 마피아의 선택이 최종 대상이 됩니다.",
          targets: this.alivePlayers.map((target) => target.userId),
        };
      case "spy":
        return {
          action: "spyInspect",
          title: "스파이 조사",
          description: "조사할 플레이어 한 명을 선택하세요.",
          targets: this.alivePlayers.filter((target) => target.userId !== userId).map((target) => target.userId),
        };
      case "beastman":
        if (player.isContacted && !this.hasOtherAliveMafiaTeam(userId)) {
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
      case "medium":
        return null;
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
      case "priest":
        return null;
      default:
        return null;
    }
  }

  public async requestAftermathTarget(
    client: Client,
    actorId: string,
    action: "mediumAscend" | "priestRevive",
    title: string,
    description: string,
    targetIds: string[],
  ): Promise<string | null> {
    if (targetIds.length === 0) {
      return null;
    }

    this.clearPendingAftermathChoice();
    const token = this.phaseContext?.token ?? 0;

    return await new Promise<string | null>((outerResolve) => {
      let settled = false;
      const settle = (targetId: string | null) => {
        if (settled) {
          return;
        }

        settled = true;
        if (this.pendingAftermathChoice?.token === token && this.pendingAftermathChoice.actorId === actorId) {
          clearTimeout(this.pendingAftermathChoice.timeout);
          this.pendingAftermathChoice = null;
          this.bumpStateVersion();
        }
        outerResolve(targetId);
      };

      const timeout = setTimeout(() => settle(null), AFTERMATH_SELECTION_SECONDS * 1_000);
      const choice: AftermathChoice = {
        token,
        actorId,
        action,
        title,
        description,
        targetIds,
        resolve: settle,
        timeout,
      };
      this.pendingAftermathChoice = choice;
      this.bumpStateVersion();

      if (this.deliveryMode === "web") {
        return;
      }

      void (async () => {
        try {
          const user = await client.users.fetch(actorId);
          const dm = await user.createDM();
          await dm.send(this.buildAftermathPayload(choice));
        } catch {
          settle(null);
        }
      })();
    });
  }

  public async prepareSecretChannels(client: Client): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

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

  public async lockOrDeleteSecretChannels(client: Client): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

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

  public async syncSecretChannels(client: Client): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

    const mafiaChannel = await this.fetchSecretTextChannel(client, this.secretChannels.mafiaId);
    const loverChannel = await this.fetchSecretTextChannel(client, this.secretChannels.loverId);
    const graveyardChannel = await this.fetchSecretTextChannel(client, this.secretChannels.graveyardId);

    if (mafiaChannel) {
      const { readableIds, writableIds } = this.getSecretChatAccess("mafia");
      const visibleIds = [...readableIds];
      const sendIds = writableIds;
      await this.syncChannelMembers(mafiaChannel, visibleIds, false, sendIds);
    }

    if (loverChannel) {
      const { readableIds, writableIds } = this.getSecretChatAccess("lover");
      const visibleIds = [...readableIds];
      const sendIds = writableIds;
      await this.syncChannelMembers(loverChannel, visibleIds, false, sendIds);
    }

    if (graveyardChannel) {
      const { readableIds, writableIds } = this.getSecretChatAccess("graveyard");
      const visibleIds = [...readableIds];
      const sendIds = writableIds;
      await this.syncChannelMembers(graveyardChannel, [...visibleIds], false, sendIds);
    }
  }

  public async syncChannelMembers(
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

  public async sendRoleCards(client: Client): Promise<void> {
    if (this.deliveryMode === "web") {
      return;
    }

    for (const player of this.players.values()) {
      await this.safeSendDm(client, player.userId, {
        embeds: [this.buildRoleEmbed(player)],
      });
    }
  }

  public buildRoleEmbed(player: PlayerState): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(isMafiaTeam(player.role) ? Colors.DarkRed : Colors.Blurple)
      .setTitle(`당신의 직업은 ${getRoleLabel(player.role)}입니다.`)
      .setDescription(getRoleSummary(player.role, this.ruleset))
      .addFields([
        { name: "팀", value: getTeamLabel(player.role), inline: true },
        // { name: "규칙셋", value: this.ruleset === "balance" ? "시즌4 밸런스" : "시즌4 초기", inline: true },
        { name: "규칙셋", value: "시즌4 밸런스", inline: true },
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

  public buildLobbyEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle("마피아42 시즌4 로비")
      // .setDescription(`규칙셋: ${this.ruleset === "balance" ? "시즌4 밸런스" : "시즌4 초기"}`)
      .setDescription("규칙셋: 시즌4 밸런스")
      .addFields([
        {
          name: `참가자 (${this.players.size}/8)`,
          value: [...this.players.values()]
            .map((player, index) => `${index + 1}. ${player.displayName}${player.userId === this.hostId ? " (방장)" : ""}`)
            .join("\n"),
        },
        {
          name: "안내",
          value:
            this.deliveryMode === "web"
              ? "4명 이상이 되면 방장이 시작할 수 있습니다. 참가/재입장은 Discord에서 링크를 발급받아 웹 대시보드로 진행합니다."
              : "4명 이상이 되면 방장이 시작할 수 있습니다. 개인 DM이 열려 있어야 게임을 진행할 수 있습니다.",
        },
      ])
      .setFooter({ text: `게임 ID: ${this.id}` });
  }

  public buildStatusEmbed(): EmbedBuilder {
    const alive = this.alivePlayers
      .map((player, index) => `${index + 1}. ${player.displayName}${this.bulliedToday.has(player.userId) ? " (협박)" : ""}`)
      .join("\n") || "없음";
    const dead = this.deadPlayers
      .map((player) => `${player.displayName}${player.ascended ? " (성불)" : ""}`)
      .join("\n") || "없음";

    return new EmbedBuilder()
      .setColor(this.phase === "night" ? Colors.DarkBlue : this.phase === "ended" ? Colors.DarkButNotBlack : Colors.Gold)
      // .setTitle(`마피아42 시즌4 ${this.ruleset === "balance" ? "밸런스" : "초기"} 게임`)
      .setTitle("마피아42 시즌4 밸런스 게임")
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

  public buildLobbyControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`lobby:${this.id}:join`).setLabel("참가").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`lobby:${this.id}:leave`).setLabel("나가기").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`lobby:${this.id}:start`).setLabel("시작").setStyle(ButtonStyle.Primary),
    );
  }

  public buildVoteControls(): ActionRowBuilder<StringSelectMenuBuilder> {
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

  public buildTrialControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`trial:${this.id}:${this.phaseContext?.token ?? 0}:yes`).setLabel("찬성").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`trial:${this.id}:${this.phaseContext?.token ?? 0}:no`).setLabel("반대").setStyle(ButtonStyle.Secondary),
    );
  }

  public buildTimeControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`time:${this.id}:${this.phaseContext?.token ?? 0}:cut`)
        .setLabel(`-${DISCUSSION_TIME_ADJUST_SECONDS}초`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`time:${this.id}:${this.phaseContext?.token ?? 0}:add`)
        .setLabel(`+${DISCUSSION_TIME_ADJUST_SECONDS}초`)
        .setStyle(ButtonStyle.Success),
    );
  }

  public buildDirectActionPayload(player: PlayerState, selectedTargetId?: string) {
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

  public buildSpyBonusPayload(player: PlayerState, firstTargetId: string, secondTargetId?: string) {
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

  public buildAftermathPayload(choice: AftermathChoice, selectedTargetId?: string) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.DarkBlue)
          .setTitle(choice.title)
          .setDescription(choice.description)
          .addFields([
            {
              name: "현재 선택",
              value: selectedTargetId ? this.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
            },
          ]),
      ],
      components: selectedTargetId
        ? []
        : [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`aftermath:${this.id}:${choice.token}:${choice.actorId}:${choice.action}`)
                .setPlaceholder("대상을 선택하세요")
                .addOptions(
                  choice.targetIds.map((targetId) => ({
                    label: this.getPlayerOrThrow(targetId).displayName,
                    value: targetId,
                  })),
                ),
            ),
          ],
    };
  }

  public buildMadamPayload(player: PlayerState, selectedTargetId?: string) {
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

  public buildReporterPublishPayload() {
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

  public buildTerrorBurnPayload(player: PlayerState, selectedTargetId?: string) {
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

  public async sendPhaseMessage(
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

  public assignLovers(): void {
    const lovers = [...this.players.values()].filter((player) => player.role === "lover");
    if (lovers.length === 2) {
      lovers[0].loverId = lovers[1].userId;
      lovers[1].loverId = lovers[0].userId;
      this.loverPair = [lovers[0].userId, lovers[1].userId];
    }
  }

  public contactPlayer(userId: string): void {
    const player = this.getPlayer(userId);
    if (!player) {
      return;
    }

    player.isContacted = true;
    this.contactedIds.add(userId);
  }

  public isBlockedTonight(userId: string): boolean {
    return this.blockedTonightTargetId === userId;
  }

  public isAliveRole(userId: string, role: Role): boolean {
    const player = this.getPlayer(userId);
    return Boolean(player && player.alive && player.role === role);
  }

  public getAliveMafia(): PlayerState[] {
    return this.alivePlayers.filter((player) => isMafiaTeam(player.role));
  }

  public hasOtherAliveMafiaTeam(userId: string): boolean {
    return this.getAliveMafia().some((player) => player.userId !== userId);
  }

  public getVoteWeight(player: PlayerState): number {
    if (player.role === "politician" && this.isPoliticianEffectBlocked(player.userId)) {
      return 1;
    }

    return player.role === "politician" ? 2 : 1;
  }

  public getWinner(): string | null {
      return require("./resolution").getWinner(this);
  }

  public killPlayer(userId: string, reason: string): void {
    const player = this.getPlayerOrThrow(userId);
    if (!player.alive) {
      return;
    }

    player.alive = false;
    player.deadReason = reason;
    this.deadOrder.push(userId);
  }

  public revivePlayer(userId: string): void {
    const player = this.getPlayerOrThrow(userId);
    player.alive = true;
    player.deadReason = undefined;
    player.ascended = false;
  }

  public findActionByRole(role: Role): NightActionRecord | undefined {
    const actor = this.alivePlayers.find((player) => player.role === role);
    if (!actor) {
      return undefined;
    }

    return this.nightActions.get(actor.userId);
  }

  public findBonusActionByRole(role: Role): NightActionRecord | undefined {
    const actor = this.alivePlayers.find((player) => player.role === role);
    if (!actor) {
      return undefined;
    }

    return this.bonusNightActions.get(actor.userId);
  }

  public findSubmittedActionForActor(userId: string): NightActionRecord | undefined {
    const actions = [this.nightActions.get(userId), this.bonusNightActions.get(userId)].filter(
      (action): action is NightActionRecord => Boolean(action),
    );

    if (actions.length === 0) {
      return undefined;
    }

    return actions.sort((left, right) => right.submittedAt - left.submittedAt)[0];
  }

  public findActorTarget(actionType: NightActionType): string | null {
    return [...this.nightActions.values()].find((action) => action.action === actionType)?.targetId ?? null;
  }

  public isPoliticianEffectBlocked(userId: string): boolean {
    // return this.ruleset === "balance" && this.pendingSeductionTargetId === userId;
    return this.pendingSeductionTargetId === userId;
  }

  public getSecretChatAccess(channel: Exclude<WebChatChannel, "public">): {
    readableIds: Set<string>;
    writableIds: Set<string>;
  } {
    const readableIds = new Set<string>();
    const writableIds = new Set<string>();

    switch (channel) {
      case "mafia": {
        if (this.phase !== "night") {
          return { readableIds, writableIds };
        }

        for (const player of this.alivePlayers) {
          if (player.role === "mafia" || player.isContacted) {
            readableIds.add(player.userId);
            writableIds.add(player.userId);
          }
        }

        for (const player of this.deadPlayers) {
          readableIds.add(player.userId);
        }

        return { readableIds, writableIds };
      }
      case "lover": {
        if (this.phase !== "night" || !this.loverPair) {
          return { readableIds, writableIds };
        }

        for (const player of this.alivePlayers) {
          if (player.role === "lover" && player.loverId) {
            readableIds.add(player.userId);
            writableIds.add(player.userId);
          }
        }

        for (const player of this.deadPlayers) {
          readableIds.add(player.userId);
        }

        return { readableIds, writableIds };
      }
      case "graveyard": {
        if (this.phase !== "night") {
          return { readableIds, writableIds };
        }

        for (const player of this.deadPlayers) {
          readableIds.add(player.userId);
          if (!player.ascended) {
            writableIds.add(player.userId);
          }
        }

        const medium = this.alivePlayers.find((player) => player.role === "medium");
        if (medium) {
          readableIds.add(medium.userId);
          writableIds.add(medium.userId);
        }

        return { readableIds, writableIds };
      }
    }
  }

  public queueAudioCue(key: AudioCueKey, recipientIds?: string[]): void {
    const createdAt = Date.now();
    const dedupedRecipientIds = recipientIds?.length ? [...new Set(recipientIds)] : null;
    this.audioCues.push({
      id: `${createdAt.toString(36)}-${Math.floor(Math.random() * 9999)
        .toString()
        .padStart(4, "0")}`,
      key,
      createdAt,
      recipientIds: dedupedRecipientIds,
    });
    this.pruneAudioCues();
  }

  public pruneAudioCues(): void {
    const cutoff = Date.now() - 15 * 60_000;
    const recent = this.audioCues.filter((cue) => cue.createdAt >= cutoff);
    const limited = recent.slice(-96);
    this.audioCues.length = 0;
    this.audioCues.push(...limited);
  }

  public requirePhase(expected: Phase): void {
    if (this.phase !== expected) {
      throw new Error(`현재 단계는 ${PHASE_LABELS[this.phase]}입니다.`);
    }
  }

  public readPhaseToken(customId: string): number {
    return Number.parseInt(customId.split(":")[2] ?? "", 10);
  }

  public requirePhaseToken(customId: string): void {
    this.requirePhaseTokenValue(this.readPhaseToken(customId));
  }

  public requirePhaseTokenValue(token: number | undefined, message = "이미 만료된 상호작용입니다."): void {
    if (!Number.isFinite(token) || token !== this.phaseContext?.token) {
      throw new Error(message);
    }
  }

  public assertAllowedTarget(targetIds: string[], targetId: string, message = "선택할 수 없는 대상입니다."): void {
    if (!targetIds.includes(targetId)) {
      throw new Error(message);
    }
  }

  public validateNightSelection(actor: PlayerState, action: string | undefined, targetId: string): PromptDefinition {
    const prompt = this.getNightPrompt(actor.userId);
    if (!prompt) {
      throw new Error("이번 밤에 사용할 수 있는 능력이 없습니다.");
    }

    if (prompt.action !== action) {
      throw new Error("현재 직업으로는 그 행동을 사용할 수 없습니다.");
    }

    this.assertAllowedTarget(prompt.targets, targetId);
    return prompt;
  }

  public assertAliveParticipant(userId: string): PlayerState {
    const player = this.getPlayer(userId);
    if (!player || !player.alive) {
      throw new Error("살아 있는 참가자만 사용할 수 있습니다.");
    }

    return player;
  }

  public newPhaseContext(durationMs: number): PhaseContext {
    const token = (this.phaseContext?.token ?? 0) + 1;
    return { token, startedAt: Date.now(), deadlineAt: Date.now() + durationMs };
  }

  public clearTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  public clearPendingAftermathChoice(): void {
    if (!this.pendingAftermathChoice) {
      return;
    }

    clearTimeout(this.pendingAftermathChoice.timeout);
    this.pendingAftermathChoice.resolve(null);
    this.pendingAftermathChoice = null;
    this.bumpStateVersion();
  }

  public restartTimer(client: Client, durationMs: number, callback: () => Promise<void>): void {
    this.clearTimer();
    this.phaseTimer = setTimeout(() => {
      callback().catch((error: unknown) => {
        console.error("phase timer error", error);
        this.end(client, "타이머 처리 중 오류가 발생해 게임을 종료했습니다.").catch(console.error);
      });
    }, durationMs);
  }

  public async safeSendDm(client: Client, userId: string, payload: string | { embeds: EmbedBuilder[] }): Promise<void> {
    if (this.deliveryMode === "web") {
      this.appendPrivateLog(userId, stringifyPrivatePayload(payload));
      return;
    }

    const user = await client.users.fetch(userId);
    await user.send(payload as never);
  }

  public async getPublicChannel(client: Client): Promise<TextChannel> {
    const channel = await client.channels.fetch(this.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("공개 채널을 찾을 수 없습니다.");
    }

    return channel as TextChannel;
  }

  public async fetchSecretTextChannel(client: Client, channelId?: string): Promise<TextChannel | null> {
    if (!channelId) {
      return null;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return null;
    }

    return channel as TextChannel;
  }

  public async fetchMessage(channel: TextBasedChannel, messageId: string): Promise<Message | null> {
    try {
      return await channel.messages.fetch(messageId);
    } catch {
      return null;
    }
  }

  public formatNames(userIds: string[]): string {
    return userIds.map((userId) => this.getPlayerOrThrow(userId).displayName).join(", ");
  }
}

export function createGame(manager: GameRegistry, interaction: ChatInputCommandInteraction, ruleset: Ruleset): MafiaGame {
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
    displayName: resolveMemberDisplayName(member),
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

function resolveMemberDisplayName(member: GuildMember): string {
  const nickname = typeof member.nickname === "string" ? member.nickname.trim() : "";
  if (nickname.length > 0) {
    return nickname;
  }

  const displayName = typeof member.displayName === "string" ? member.displayName.trim() : "";
  if (displayName.length > 0) {
    return displayName;
  }

  const username = typeof member.user?.username === "string" ? member.user.username.trim() : "";
  if (username.length > 0) {
    return username;
  }

  return member.id;
}

export function formatDayBreakLabel(dayNumber: number): string {
  return DAY_BREAK_LABELS[dayNumber] ?? `${dayNumber}번째 날`;
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

function stringifyPrivatePayload(payload: string | { embeds: EmbedBuilder[] }): string {
  if (typeof payload === "string") {
    return payload;
  }

  const lines: string[] = [];
  for (const embed of payload.embeds) {
    const json = embed.toJSON();
    if (json.title) {
      lines.push(json.title);
    }
    if (json.description) {
      lines.push(json.description);
    }
    if (json.fields) {
      for (const field of json.fields) {
        lines.push(`${field.name}: ${field.value}`);
      }
    }
  }

  return lines.join("\n").trim() || "개인 알림이 도착했습니다.";
}
