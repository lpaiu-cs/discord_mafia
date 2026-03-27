import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { PlayerState, isMafiaTeam, Phase, Ruleset, SecretChannelIds } from "./model";
import { getRoleLabel, getRoleSummary, getTeamLabel } from "./rules";
import { getNightPrompt } from "./permissions";
import type { MafiaGame, AftermathChoice } from "./game";

// Types
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
  | "ghoul"
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

export interface QueuedAudioCue extends VisibleAudioCue {
  recipientIds: string[] | null;
}

const PHASE_LABELS: Record<Phase, string> = {
  lobby: "로비",
  night: "밤",
  discussion: "낮 토론",
  vote: "투표",
  defense: "최후의 반론",
  trial: "찬반 투표",
  ended: "종료",
};

// Logging and State Mutators
export function appendPrivateLog(game: MafiaGame, userId: string, line: string): void {
  const entries = game.privateLogs.get(userId) ?? [];
  entries.push({
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`,
    line,
    createdAt: Date.now(),
  });
  game.privateLogs.set(userId, entries);
  game.bumpStateVersion();
}

export function appendSystemChat(game: MafiaGame, channel: WebChatChannel, content: string): WebChatMessage {
  const message: WebChatMessage = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`,
    channel,
    kind: "system",
    authorId: "system",
    authorName: "시스템",
    content,
    createdAt: Date.now(),
  };
  game.webChats[channel].push(message);
  game.bumpStateVersion();
  return message;
}

export function setPublicLines(game: MafiaGame, lines: string[], chatLines: string[] = lines): void {
  game.lastPublicLines = [...lines];
  for (const line of chatLines) {
    appendSystemChat(game, "public", line);
  }
}

export function appendPublicLine(game: MafiaGame, line: string): void {
  game.lastPublicLines = [...game.lastPublicLines, line];
  appendSystemChat(game, "public", line);
}

export function appendPublicActivityLog(game: MafiaGame, line: string): void {
  appendSystemChat(game, "public", line);
}

export function queueAudioCue(game: MafiaGame, key: AudioCueKey, recipientIds?: string[]): void {
  game.audioCues.push({
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`,
    key,
    createdAt: Date.now(),
    recipientIds: recipientIds ?? null,
  });
  game.bumpStateVersion();
}

export function pruneAudioCues(game: MafiaGame): void {
  const now = Date.now();
  const retained = game.audioCues.filter((cue) => now - cue.createdAt < 30000);
  if (retained.length !== game.audioCues.length) {
    game.audioCues.length = 0;
    game.audioCues.push(...retained);
    game.bumpStateVersion();
  }
}

// Discord Message Builders

export function buildRoleEmbed(player: PlayerState, ruleset: Ruleset, alivePlayers: PlayerState[], secretChannels: SecretChannelIds, getPlayerOrThrow: (id: string) => PlayerState): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(isMafiaTeam(player.role) ? Colors.DarkRed : Colors.Blurple)
    .setTitle(`당신의 직업은 ${getRoleLabel(player.role)}입니다.`)
    .setDescription(getRoleSummary(player.role, ruleset))
    .addFields([
      { name: "팀", value: getTeamLabel(player.role), inline: true },
      { name: "규칙셋", value: "시즌4 밸런스", inline: true },
    ]);

  if (player.role === "mafia") {
    const allies = alivePlayers.filter((seat) => seat.role === "mafia" && seat.userId !== player.userId);
    embed.addFields([
      {
        name: "동료 마피아",
        value: allies.length > 0 ? allies.map((ally) => ally.displayName).join(", ") : "없음",
      },
    ]);
  }

  if (player.role === "lover" && player.loverId) {
    embed.addFields([{ name: "연인", value: getPlayerOrThrow(player.loverId).displayName }]);
  }

  if ((player.role === "mafia" || player.isContacted) && secretChannels.mafiaId) {
    embed.addFields([{ name: "비밀 채널", value: `<#${secretChannels.mafiaId}>` }]);
  }

  if (player.role === "lover" && secretChannels.loverId) {
    embed.addFields([{ name: "연인 채널", value: `<#${secretChannels.loverId}>` }]);
  }

  if (player.role === "medium" && secretChannels.graveyardId) {
    embed.addFields([{ name: "망자 채널", value: `<#${secretChannels.graveyardId}>` }]);
  }

  return embed;
}

export function buildLobbyEmbed(game: MafiaGame): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle("마피아42 시즌4 로비")
    .setDescription("규칙셋: 시즌4 밸런스")
    .addFields([
      {
        name: `참가자 (${game.players.size}/8)`,
        value: [...game.players.values()]
          .map((player, index) => `${index + 1}. ${player.displayName}${player.userId === game.hostId ? " (방장)" : ""}`)
          .join("\n"),
      },
      {
        name: "안내",
        value:
          game.deliveryMode === "web"
            ? "4명 이상이 되면 방장이 시작할 수 있습니다. 참가/재입장은 Discord에서 링크를 발급받아 웹 대시보드로 진행합니다."
            : "4명 이상이 되면 방장이 시작할 수 있습니다. 개인 DM이 열려 있어야 게임을 진행할 수 있습니다.",
      },
    ])
    .setFooter({ text: `게임 ID: ${game.id}` });
}

export function buildStatusEmbed(game: MafiaGame): EmbedBuilder {
  const alive = game.alivePlayers
    .map((player, index) => `${index + 1}. ${player.displayName}${game.bulliedToday.has(player.userId) ? " (협박)" : ""}`)
    .join("\n") || "없음";
  const dead = game.deadPlayers
    .map((player) => `${player.displayName}${player.ascended ? " (성불)" : ""}`)
    .join("\n") || "없음";

  return new EmbedBuilder()
    .setColor(game.phase === "night" ? Colors.DarkBlue : game.phase === "ended" ? Colors.DarkButNotBlack : Colors.Gold)
    .setTitle("마피아42 시즌4 밸런스 게임")
    .setDescription(
      [
        `상태: ${PHASE_LABELS[game.phase]}`,
        `밤: ${game.nightNumber} / 낮: ${game.dayNumber}`,
        game.phaseContext ? `마감: <t:${Math.floor(game.phaseContext.deadlineAt / 1000)}:R>` : "마감: 없음",
        game.currentTrialTargetId ? `현재 대상: ${game.getPlayerOrThrow(game.currentTrialTargetId).displayName}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    )
    .addFields([
      { name: "생존", value: alive, inline: true },
      { name: "사망", value: dead, inline: true },
      { name: "최근 알림", value: game.lastPublicLines.join("\n") },
    ])
    .setFooter({ text: `게임 ID: ${game.id}` });
}

export function buildLobbyControls(gameId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`lobby:${gameId}:join`).setLabel("참가").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`lobby:${gameId}:leave`).setLabel("나가기").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lobby:${gameId}:start`).setLabel("시작").setStyle(ButtonStyle.Primary),
  );
}

export function buildVoteControls(gameId: string, token: number, alivePlayers: PlayerState[]): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`vote:${gameId}:${token}`)
      .setPlaceholder("투표 대상을 선택하세요")
      .addOptions(
        alivePlayers.map((player) => ({
          label: player.displayName,
          value: player.userId,
        })),
      ),
  );
}

export function buildTrialControls(gameId: string, token: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`trial:${gameId}:${token}:yes`).setLabel("찬성").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`trial:${gameId}:${token}:no`).setLabel("반대").setStyle(ButtonStyle.Secondary),
  );
}

export function buildTimeControls(gameId: string, token: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`time:${gameId}:${token}:cut`).setLabel("-10초").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`time:${gameId}:${token}:add`).setLabel("+10초").setStyle(ButtonStyle.Success),
  );
}

export function buildDirectActionPayload(game: MafiaGame, player: PlayerState, selectedTargetId?: string) {
  const prompt = getNightPrompt(game, player.userId);
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
            value: selectedTargetId ? game.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
          },
        ]),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`night:${game.id}:${game.phaseContext?.token ?? 0}:${player.userId}:${prompt.action}`)
          .setPlaceholder("대상을 선택하세요")
          .addOptions(
            prompt.targets.map((targetId) => ({
              label: game.getPlayerOrThrow(targetId).displayName,
              value: targetId,
            })),
          ),
      ),
    ],
  };
}

export function buildSpyBonusPayload(game: MafiaGame, player: PlayerState, firstTargetId: string, secondTargetId?: string) {
  const targets = game.alivePlayers.filter((target) => target.userId !== player.userId).map((target) => target.userId);
  const contactLine = game.secretChannels.mafiaId ? `접선에 성공했습니다. 마피아 채널: <#${game.secretChannels.mafiaId}>` : "접선에 성공했습니다.";

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.DarkBlue)
        .setTitle("스파이 추가 조사")
        .setDescription(`첫 조사로 마피아를 찾아 ${contactLine} 같은 밤에 한 번 더 조사할 수 있습니다.`)
        .addFields([
          { name: "1차 선택", value: game.getPlayerOrThrow(firstTargetId).displayName },
          { name: "2차 선택", value: secondTargetId ? game.getPlayerOrThrow(secondTargetId).displayName : "아직 선택하지 않음" },
        ]),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`night:${game.id}:${game.phaseContext?.token ?? 0}:${player.userId}:spyInspectBonus`)
          .setPlaceholder("추가 조사 대상을 선택하세요")
          .addOptions(
            targets.map((targetId) => ({
              label: game.getPlayerOrThrow(targetId).displayName,
              value: targetId,
            })),
          ),
      ),
    ],
  };
}

export function buildAftermathPayload(game: MafiaGame, choice: AftermathChoice, selectedTargetId?: string) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.DarkBlue)
        .setTitle(choice.title)
        .setDescription(choice.description)
        .addFields([
          {
            name: "현재 선택",
            value: selectedTargetId ? game.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
          },
        ]),
    ],
    components: selectedTargetId
      ? []
      : [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`aftermath:${game.id}:${choice.token}:${choice.actorId}:${choice.action}`)
              .setPlaceholder("대상을 선택하세요")
              .addOptions(
                choice.targetIds.map((targetId: string) => ({
                  label: game.getPlayerOrThrow(targetId).displayName,
                  value: targetId,
                })),
              ),
          ),
        ],
  };
}

export function buildMadamPayload(game: MafiaGame, player: PlayerState, selectedTargetId?: string) {
  const targets = game.alivePlayers.filter((target) => target.userId !== player.userId);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Purple)
        .setTitle("마담 유혹 선택")
        .setDescription("투표 시간 동안 한 명을 유혹해 오늘 밤 효과를 막습니다.")
        .addFields([
          {
            name: "현재 선택",
            value: selectedTargetId ? game.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
          },
        ]),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`madam:${game.id}:${game.phaseContext?.token ?? 0}:${player.userId}:select`)
          .setPlaceholder("유혹 대상을 선택하세요")
          .addOptions(targets.map((target) => ({ label: target.displayName, value: target.userId }))),
      ),
    ],
  };
}

export function buildReporterPublishPayload(game: MafiaGame) {
  if (!game.pendingArticle) {
    throw new Error("공개할 기사가 없습니다.");
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle("기자 기사 공개")
        .setDescription(
          `${game.getPlayerOrThrow(game.pendingArticle.targetId).displayName} 님의 기사를 준비했습니다. 낮 동안 직접 공개할 수 있습니다.`,
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`reporter:${game.id}:${game.dayNumber}:${game.pendingArticle.actorId}:publish`)
          .setLabel("기사 공개")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

export function buildTerrorBurnPayload(game: MafiaGame, player: PlayerState, selectedTargetId?: string) {
  const targets = game.alivePlayers.filter((target) => target.userId !== player.userId);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.DarkRed)
        .setTitle("테러리스트 산화 대상")
        .setDescription("처형될 경우 함께 끌고 갈 대상을 선택하세요.")
        .addFields([
          {
            name: "현재 선택",
            value: selectedTargetId ? game.getPlayerOrThrow(selectedTargetId).displayName : "아직 선택하지 않음",
          },
        ]),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`terror:${game.id}:${game.phaseContext?.token ?? 0}:${player.userId}:burn`)
          .setPlaceholder("산화 대상을 선택하세요")
          .addOptions(targets.map((target) => ({ label: target.displayName, value: target.userId }))),
      ),
    ],
  };
}
