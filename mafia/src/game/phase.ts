import { Client, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle } from "discord.js";
import { MafiaGame, formatDayBreakLabel, NIGHT_SECONDS, FIRST_NIGHT_EXTRA_SECONDS, DISCUSSION_SECONDS_PER_PLAYER, VOTE_SECONDS, DEFENSE_SECONDS } from "./game";
import { config } from "../config";
import { getTeam } from "./model";
import { PHASE_LABELS } from "./game";

export async function startNight(game: MafiaGame, client: Client): Promise<void> {
    game.clearTimer();
    game.clearPendingAftermathChoice();
    game.phase = "night";
    game.nightNumber += 1;
    game.currentTrialTargetId = null;
    game.dayVotes.clear();
    game.trialVotes.clear();
    game.pendingTrialBurns.clear();
    game.nightActions.clear();
    game.bonusNightActions.clear();
    game.spyBonusGrantedTonight.clear();
    game.blockedTonightTargetId = game.pendingSeductionTargetId;
    game.pendingSeductionTargetId = null;
    const nightDurationMs = game.nightNumber === 1 ? (NIGHT_SECONDS + FIRST_NIGHT_EXTRA_SECONDS) * 1_000 : NIGHT_SECONDS * 1_000;
    game.phaseContext = game.newPhaseContext(nightDurationMs);
    const lines = ["밤이 되었습니다."];
    if (game.blockedTonightTargetId) {
      lines.push(`${game.getPlayerOrThrow(game.blockedTonightTargetId).displayName} 님은 오늘 밤 유혹 상태입니다.`);
    }
    game.setPublicLines(lines);

    await game.syncSecretChannels(client);
    await game.sendNightPrompts(client);
    await game.sendPhaseMessage(client, {
      title: `${game.nightNumber}번째 밤`,
      description:
        game.deliveryMode === "web"
          ? "웹 대시보드에서 개인 행동과 비밀 채팅을 진행해 주세요."
          : "개인 DM으로 행동을 제출해 주세요. 공개 채널에서는 결과만 안내합니다.",
    });
    await game.sendOrUpdateStatus(client);
    game.restartTimer(client, nightDurationMs, () => game.finishNight(client));
  }

export async function finishNight(game: MafiaGame, client: Client): Promise<void> {
    game.requirePhase("night");
    game.clearTimer();

    const summary = await game.resolveNight(client);
    game.dayNumber += 1;
    game.bulliedToday = new Set(game.bulliedNextDay);
    game.bulliedNextDay.clear();
    game.blockedTonightTargetId = null;
    await game.syncSecretChannels(client);

    const winner = game.getWinner();
    if (winner) {
      game.phase = "ended";
      game.phaseContext = null;
      game.endedWinner = winner;
      game.endedReason = `${winner} 승리`;
      game.endedAt = Date.now();
      game.appendPublicLine(`${winner} 승리`);
      await game.sendPhaseMessage(client, {
        title: "게임 종료",
        description: `${winner} 승리`,
        extraLines: summary.publicLines,
      });
      await game.sendOrUpdateStatus(client);
      await game.lockOrDeleteSecretChannels(client);
      game.onEnded(game.guildId);
      return;
    }

    await game.beginDiscussion(client, summary.publicLines);
  }

export async function startDiscussion(game: MafiaGame, client: Client, morningLines: string[]): Promise<void> {
    game.clearTimer();
    game.phase = "discussion";
    const duration = Math.max(game.alivePlayers.length, 1) * DISCUSSION_SECONDS_PER_PLAYER * 1_000;
    game.phaseContext = game.newPhaseContext(duration);
    const daybreakLine = `${formatDayBreakLabel(game.dayNumber)}이 밝았습니다.`;
    const publicLines = [daybreakLine, ...morningLines];
    game.setPublicLines(publicLines, [daybreakLine]);

    await game.syncSecretChannels(client);
    await game.sendPhaseMessage(client, {
      title: `${game.dayNumber}번째 낮`,
      description: "토론 시간입니다. 살아 있는 플레이어는 한 번씩 시간을 늘리거나 줄일 수 있습니다.",
      components: game.deliveryMode === "web" ? [] : [game.buildTimeControls()],
      extraLines: publicLines,
    });
    await game.sendReporterPublishPrompt(client);
    await game.sendOrUpdateStatus(client);
    game.restartTimer(client, duration, () => game.finishDiscussion(client));
  }

export async function finishDiscussion(game: MafiaGame, client: Client): Promise<void> {
    game.requirePhase("discussion");
    game.clearTimer();
    await game.beginVote(client);
  }

export async function startVote(game: MafiaGame, client: Client): Promise<void> {
    game.phase = "vote";
    game.phaseContext = game.newPhaseContext(VOTE_SECONDS * 1_000);
    game.dayVotes.clear();
    for (const player of game.players.values()) {
      player.voteLockedToday = false;
    }
    game.setPublicLines(["투표 시간입니다."]);

    await game.sendVotePrompt(client);
    await game.sendMadamPrompt(client);
    await game.sendOrUpdateStatus(client);
    game.restartTimer(client, VOTE_SECONDS * 1_000, () => game.finishVote(client));
  }

export async function finishVote(game: MafiaGame, client: Client): Promise<void> {
    game.requirePhase("vote");
    game.clearTimer();

    const tallied = new Map<string, number>();
    for (const [voterId, targetId] of game.dayVotes.entries()) {
      const voter = game.getPlayer(voterId);
      const target = game.getPlayer(targetId);
      if (!voter || !voter.alive || game.bulliedToday.has(voterId) || !target || !target.alive) {
        continue;
      }

      tallied.set(target.userId, (tallied.get(target.userId) ?? 0) + game.getVoteWeight(voter));
    }

    const ranked = [...tallied.entries()].sort((left, right) => right[1] - left[1]);
    if (ranked.length === 0) {
      game.setPublicLines(["아무도 투표하지 않아 바로 다음 밤으로 넘어갑니다."]);
      await game.beginNight(client);
      return;
    }

    const [topTargetId, topVotes] = ranked[0];
    const isTie = ranked.length > 1 && ranked[1][1] === topVotes;
    if (isTie) {
      game.setPublicLines(["동률 최다 득표가 발생해 처형 없이 다음 밤으로 넘어갑니다."]);
      await game.beginNight(client);
      return;
    }

    game.currentTrialTargetId = topTargetId;
    game.setPublicLines([
      `${game.getPlayerOrThrow(topTargetId).displayName} 님이 최다 득표(${topVotes}표)를 받아 최후의 반론에 올라갑니다.`,
    ]);
    await game.beginDefense(client, topTargetId);
  }

export async function startDefense(game: MafiaGame, client: Client, targetId: string): Promise<void> {
    game.phase = "defense";
    game.phaseContext = game.newPhaseContext(DEFENSE_SECONDS * 1_000);
    game.currentTrialTargetId = targetId;

    await game.sendPhaseMessage(client, {
      title: "최후의 반론",
      description: `${game.getPlayerOrThrow(targetId).displayName} 님만 발언하는 단계입니다.`,
      extraLines: game.lastPublicLines,
    });

    if (game.isAliveRole(targetId, "terrorist")) {
      await game.sendTerrorBurnPrompt(client, targetId);
    }

    await game.sendOrUpdateStatus(client);
    game.restartTimer(client, DEFENSE_SECONDS * 1_000, () => game.finishDefense(client));
  }

export async function finishDefense(game: MafiaGame, client: Client): Promise<void> {
    game.requirePhase("defense");
    game.clearTimer();
    await game.beginTrial(client);
  }

export async function startTrial(game: MafiaGame, client: Client): Promise<void> {
    if (!game.currentTrialTargetId) {
      throw new Error("찬반 투표 대상이 없습니다.");
    }

    game.phase = "trial";
    game.phaseContext = game.newPhaseContext(config.trialVoteSeconds * 1_000);
    game.trialVotes.clear();

    await game.sendPhaseMessage(client, {
      title: "찬반 투표",
      description: `${game.getPlayerOrThrow(game.currentTrialTargetId).displayName} 님을 처형할지 결정합니다.`,
      components: game.deliveryMode === "web" ? [] : [game.buildTrialControls()],
      extraLines: game.lastPublicLines,
    });
    await game.sendOrUpdateStatus(client);
    game.restartTimer(client, config.trialVoteSeconds * 1_000, () => game.finishTrial(client));
  }

export async function finishTrial(game: MafiaGame, client: Client): Promise<void> {
    game.requirePhase("trial");
    game.clearTimer();

    if (!game.currentTrialTargetId) {
      throw new Error("처형 대상이 없습니다.");
    }

    const totalWeight = game.alivePlayers.reduce((sum, player) => sum + game.getVoteWeight(player), 0);
    let yesWeight = 0;
    for (const player of game.alivePlayers) {
      if (game.bulliedToday.has(player.userId)) {
        continue;
      }

      if (game.trialVotes.get(player.userId) === "yes") {
        yesWeight += game.getVoteWeight(player);
      }
    }

    const convict = yesWeight >= Math.ceil(totalWeight / 2);
    const target = game.getPlayerOrThrow(game.currentTrialTargetId);
    const lines: string[] = [`찬성 ${yesWeight} / 전체 ${totalWeight} 표`];

    if (!convict) {
      lines.push("반대가 더 많아 처형되지 않았습니다.");
      game.setPublicLines(lines);
      await game.beginNight(client);
      return;
    }

    if (target.role === "politician" && !game.isPoliticianEffectBlocked(target.userId)) {
      game.queueAudioCue("gavel");
      lines.push("정치인은 투표 처형되지 않습니다.");
      game.setPublicLines(lines);
      await game.beginNight(client);
      return;
    }

    game.killPlayer(target.userId, "낮 투표 처형");
    lines.push(`${target.displayName} 님이 처형되었습니다.`);

    if (target.role === "terrorist") {
      const burn = game.pendingTrialBurns.get(target.userId);
      if (burn) {
        const burnTarget = game.getPlayer(burn.targetId);
        if (burnTarget && burnTarget.alive && getTeam(burnTarget.role) !== getTeam(target.role)) {
          game.killPlayer(burnTarget.userId, "테러리스트 산화");
          game.queueAudioCue("explosion");
          lines.push(`${burnTarget.displayName} 님이 테러리스트의 산화에 휘말렸습니다.`);
        }
      }
    }

    game.setPublicLines(lines);
    await game.syncSecretChannels(client);
    const winner = game.getWinner();
    if (winner) {
      game.phase = "ended";
      game.phaseContext = null;
      game.endedWinner = winner;
      game.endedReason = `${winner} 승리`;
      game.endedAt = Date.now();
      game.appendPublicLine(`${winner} 승리`);
      await game.sendPhaseMessage(client, {
        title: "게임 종료",
        description: `${winner} 승리`,
        extraLines: lines,
      });
      await game.sendOrUpdateStatus(client);
      await game.lockOrDeleteSecretChannels(client);
      game.onEnded(game.guildId);
      return;
    }

    await game.beginNight(client);
  }
