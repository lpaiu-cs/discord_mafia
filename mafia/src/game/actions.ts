import { ButtonInteraction, Client, MessageFlags, StringSelectMenuInteraction, Colors, EmbedBuilder } from "discord.js";
import { DISCUSSION_TIME_ADJUST_SECONDS, NightSelectionRequest, TimeAdjust } from "./game";
import type { MafiaGame } from "./game";
import { getRoleLabel } from "./rules";
import { getTeam } from "./model";
import {
  queueAudioCue,
  appendPublicActivityLog,
  appendPublicLine,
  buildDirectActionPayload,
  buildSpyBonusPayload,
  buildAftermathPayload,
  buildMadamPayload,
  buildTerrorBurnPayload,
} from "./messaging";
import { NightActionRecord } from "./model";
import type { PlayerState } from "./model";

export async function handleVoteSelect(game: MafiaGame, client: Client, interaction: StringSelectMenuInteraction): Promise<void> {
  const [targetId] = interaction.values;
  const content = await submitVote(game, client, interaction.user.id, targetId, game.readPhaseToken(interaction.customId));
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export async function submitVote(game: MafiaGame, client: Client, userId: string, targetId: string, token?: number): Promise<string> {
  game.requirePhase("vote");
  game.requirePhaseTokenValue(token);

  const player = game.assertAliveParticipant(userId);
  if (game.bulliedToday.has(player.userId)) {
    throw new Error("협박당한 플레이어는 오늘 투표할 수 없습니다.");
  }

  const target = game.getPlayer(targetId);
  if (!target || !target.alive) {
    throw new Error("살아 있는 투표 대상만 선택할 수 있습니다.");
  }

  if (player.voteLockedToday || game.dayVotes.has(player.userId)) {
    throw new Error("이미 낮 투표를 제출했습니다.");
  }

  player.voteLockedToday = true;
  game.dayVotes.set(player.userId, targetId);
  appendPublicActivityLog(game, `누군가가 ${target.displayName} 님에게 투표했습니다.`);
  await game.sendOrUpdateStatus(client);
  return `${target.displayName} 님에게 투표했습니다.`;
}

export async function handleTrialVote(game: MafiaGame, client: Client, interaction: ButtonInteraction, vote: "yes" | "no"): Promise<void> {
  const content = await submitTrialVote(game, client, interaction.user.id, vote, game.readPhaseToken(interaction.customId));
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
}

export async function submitTrialVote(game: MafiaGame, client: Client, userId: string, vote: "yes" | "no", token?: number): Promise<string> {
  game.requirePhase("trial");
  game.requirePhaseTokenValue(token);

  const player = game.assertAliveParticipant(userId);
  if (game.bulliedToday.has(player.userId)) {
    throw new Error("협박당한 플레이어는 찬반 투표도 할 수 없습니다.");
  }

  if (game.trialVotes.has(player.userId)) {
    throw new Error("이미 찬반 투표를 제출했습니다.");
  }

  game.trialVotes.set(player.userId, vote);
  appendPublicActivityLog(game, vote === "yes" ? "누군가가 찬성에 투표했습니다." : "누군가가 반대에 투표했습니다.");
  await game.sendOrUpdateStatus(client);
  return vote === "yes" ? "처형 찬성에 투표했습니다." : "처형 반대에 투표했습니다.";
}

export async function handleTimeAdjust(game: MafiaGame, client: Client, interaction: ButtonInteraction, direction: TimeAdjust): Promise<void> {
  const content = await adjustDiscussionTime(game, client, interaction.user.id, direction, game.readPhaseToken(interaction.customId));
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
}

export async function adjustDiscussionTime(game: MafiaGame, client: Client, userId: string, direction: TimeAdjust, token?: number): Promise<string> {
  game.requirePhase("discussion");
  game.requirePhaseTokenValue(token);

  const player = game.assertAliveParticipant(userId);
  if (player.timeAdjustUsedOnDay === game.dayNumber) {
    throw new Error("토론 시간 조절은 하루에 한 번만 가능합니다.");
  }

  if (!game.phaseContext) {
    throw new Error("토론 시간이 없습니다.");
  }

  const adjustLabel = `${DISCUSSION_TIME_ADJUST_SECONDS}초`;
  const delta = direction === "add" ? DISCUSSION_TIME_ADJUST_SECONDS * 1_000 : -DISCUSSION_TIME_ADJUST_SECONDS * 1_000;
  player.timeAdjustUsedOnDay = game.dayNumber;
  game.phaseContext.deadlineAt = Math.max(Date.now() + 5_000, game.phaseContext.deadlineAt + delta);
  game.restartTimer(client, game.phaseContext.deadlineAt - Date.now(), () => game.finishDiscussion(client));
  appendPublicActivityLog(game, 
    direction === "add"
      ? `${player.displayName} 님이 토론 시간을 ${adjustLabel} 늘렸습니다.`
      : `${player.displayName} 님이 토론 시간을 ${adjustLabel} 줄였습니다.`,
  );
  await game.sendOrUpdateStatus(client);
  return direction === "add" ? `토론 시간을 ${adjustLabel} 늘렸습니다.` : `토론 시간을 ${adjustLabel} 줄였습니다.`;
}

export async function handleReporterPublish(game: MafiaGame, client: Client, interaction: ButtonInteraction): Promise<void> {
  const [kind, gameId, dayRaw, actorId, action] = interaction.customId.split(":");
  if (kind !== "reporter" || gameId !== game.id || action !== "publish") {
    throw new Error("기자 기사 공개 메시지가 아닙니다.");
  }

  const content = await publishReporterArticle(game, client, interaction.user.id, actorId, Number.parseInt(dayRaw, 10));
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export async function publishReporterArticle(game: MafiaGame, client: Client, userId: string, actorId: string = userId, day: number = game.dayNumber): Promise<string> {
  if (userId !== actorId) {
    throw new Error("이 메시지는 본인만 사용할 수 있습니다.");
  }

  if (game.phase === "night" || game.phase === "lobby" || game.phase === "ended") {
    throw new Error("기사는 낮에만 공개할 수 있습니다.");
  }

  if (day !== game.dayNumber) {
    throw new Error("이미 지나간 낮의 기사 공개 버튼입니다.");
  }

  game.assertAliveParticipant(actorId);

  if (!game.pendingArticle || game.pendingArticle.actorId !== actorId || game.dayNumber < game.pendingArticle.publishFromDay) {
    throw new Error("지금 공개할 수 있는 기사가 없습니다.");
  }

  const articleLine = `기자 기사: ${game.getPlayerOrThrow(game.pendingArticle.targetId).displayName} 님의 직업은 ${getRoleLabel(game.pendingArticle.role)}입니다.`;
  const channel = await game.getPublicChannel(client);
  await channel.send({
    embeds: [new EmbedBuilder().setColor(Colors.Blurple).setTitle("기자 기사").setDescription(articleLine)],
  });

  queueAudioCue(game, "camera_shutter");
  game.pendingArticle = null;
  appendPublicLine(game, articleLine);
  await game.sendOrUpdateStatus(client);
  return "기사를 공개했습니다.";
}

export async function handleNightSelect(game: MafiaGame, client: Client, interaction: StringSelectMenuInteraction): Promise<void> {
  const [kind, gameId, tokenRaw, actorId, action] = interaction.customId.split(":");
  if (gameId !== game.id) {
    throw new Error("다른 게임의 메시지입니다.");
  }

  const [targetId] = interaction.values;
  const result = await submitNightSelection(game, client, {
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

export async function submitNightSelection(game: MafiaGame, client: Client, request: NightSelectionRequest, userId: string = request.actorId): Promise<{ payload?: unknown }> {
  if (userId !== request.actorId) {
    throw new Error("이 메시지는 본인만 사용할 수 있습니다.");
  }

  game.requirePhaseTokenValue(request.token, "이미 지나간 단계의 선택지입니다.");

  const actor = game.assertAliveParticipant(request.actorId);
  const { kind, action, targetId } = request;

  if (kind === "aftermath") {
    const choice = game.pendingAftermathChoice;
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
      queueAudioCue(game, "magical", [request.actorId, targetId]);
    }
    game.bumpStateVersion();
    return { payload: buildAftermathPayload(game, choice, targetId) };
  }

  if (kind === "night") {
    game.requirePhase("night");

    if (action === "spyInspectBonus") {
      if (actor.role !== "spy") {
        throw new Error("스파이만 추가 조사를 할 수 있습니다.");
      }

      const primaryAction = game.nightActions.get(request.actorId);
      if (!primaryAction || primaryAction.action !== "spyInspect" || !game.spyBonusGrantedTonight.has(request.actorId)) {
        throw new Error("추가 조사 권한이 없습니다.");
      }

      game.assertAllowedTarget(
        game.alivePlayers.filter((target: PlayerState) => target.userId !== actor.userId).map((target: PlayerState) => target.userId),
        targetId,
      );

      const bonusRecord: NightActionRecord = {
        actorId: request.actorId,
        action: "spyInspect",
        targetId,
        submittedAt: Date.now(),
      };
      game.bonusNightActions.set(request.actorId, bonusRecord);
      game.bumpStateVersion();
      return { payload: buildSpyBonusPayload(game, actor, primaryAction.targetId, bonusRecord.targetId) };
    }

    const prompt = game.validateNightSelection(actor, action, targetId);

    const record: NightActionRecord = {
      actorId: request.actorId,
      action: prompt.action,
      targetId,
      submittedAt: Date.now(),
    };
    game.nightActions.set(request.actorId, record);

    if (record.action === "spyInspect" && actor.role === "spy" && !actor.isContacted) {
      const target = game.getPlayerOrThrow(targetId);
      if (target.role === "mafia") {
        game.contactPlayer(request.actorId);
        game.spyBonusGrantedTonight.add(request.actorId);
        queueAudioCue(game, "door", [request.actorId, target.userId]);
        game.bumpStateVersion();
        await game.syncSecretChannels(client);
        return { payload: buildSpyBonusPayload(game, actor, record.targetId) };
      }
    }

    if (record.action === "thugThreaten") {
      queueAudioCue(game, "punch", [request.actorId, targetId]);
    }

    if (record.action === "policeInspect") {
      queueAudioCue(game, "rogerthatover", [request.actorId]);
    }

    game.bumpStateVersion();
    return { payload: buildDirectActionPayload(game, actor, record.targetId) };
  }

  if (kind === "madam") {
    if (game.phase !== "vote") {
      throw new Error("지금은 유혹을 선택할 수 없습니다.");
    }

    if (actor.role !== "madam") {
      throw new Error("마담만 유혹을 선택할 수 있습니다.");
    }

    game.assertAllowedTarget(
      game.alivePlayers.filter((target: PlayerState) => target.userId !== actor.userId).map((target: PlayerState) => target.userId),
      targetId,
    );

    game.pendingSeductionTargetId = targetId;
    if (game.isAliveRole(targetId, "mafia")) {
      game.contactPlayer(request.actorId);
    }

    queueAudioCue(game, "charm", [targetId]);
    await game.sendOrUpdateStatus(client);
    return { payload: buildMadamPayload(game, actor, targetId) };
  }

  if (kind === "terror") {
    if (game.phase !== "defense") {
      throw new Error("지금은 산화 대상을 고를 수 없습니다.");
    }

    if (actor.role !== "terrorist" || game.currentTrialTargetId !== actor.userId) {
      throw new Error("지금은 산화 대상을 고를 수 없습니다.");
    }

    game.assertAllowedTarget(
      game.alivePlayers.filter((target: PlayerState) => target.userId !== actor.userId).map((target: PlayerState) => target.userId),
      targetId,
    );

    game.pendingTrialBurns.set(request.actorId, { actorId: request.actorId, targetId });
    game.bumpStateVersion();
    return { payload: buildTerrorBurnPayload(game, actor, targetId) };
  }

  throw new Error("알 수 없는 선택 상호작용입니다.");
}
