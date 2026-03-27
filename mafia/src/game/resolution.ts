import { Client, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle } from "discord.js";
import { MafiaGame } from "./game";
import { ResolutionSummary, NightActionRecord } from "./model";
import { getRoleLabel, normalizeStolenRole, getRoleSummary, getTeamLabel, assignRoles } from "./rules";
import { getTeam, isMafiaTeam } from "./model";

export async function resolveNight(game: MafiaGame, client: Client): Promise<ResolutionSummary> {
    const summary: ResolutionSummary = { publicLines: [], privateLines: [] };
    const nightDeathIds = new Set<string>();
    const markNightDeath = (userId: string, reason: string): void => {
      const player = game.getPlayer(userId);
      if (!player || !player.alive) {
        return;
      }

      game.killPlayer(userId, reason);
      nightDeathIds.add(userId);
    };

    const mafiaVotes = [...game.nightActions.values()].filter((action) => action.action === "mafiaKill");
    const mafiaResult = game.resolveMafiaKill(mafiaVotes);
    const protectedId = game.findActorTarget("doctorProtect");
    const beastAction = game.findActionByRole("beastman");
    const thugAction = game.findActionByRole("thug");
    const reporterAction = game.findActionByRole("reporter");
    const spyAction = game.findActionByRole("spy");
    const policeAction = game.findActionByRole("police");
    const detectiveAction = game.findActionByRole("detective");
    const terroristAction = game.findActionByRole("terrorist");

    if (terroristAction) {
      game.getPlayerOrThrow(terroristAction.actorId).terrorMarkId = terroristAction.targetId;
    }

    const spyActions = [spyAction, game.findBonusActionByRole("spy")].filter((action): action is NightActionRecord => Boolean(action));
    for (const action of spyActions) {
      game.appendSpyInspectionResult(summary, action);
    }

    if (policeAction) {
      const target = game.getPlayerOrThrow(policeAction.targetId);
      summary.privateLines.push({
        userId: policeAction.actorId,
        line: `조사 결과: ${target.displayName} 님은 ${target.role === "mafia" ? "마피아입니다." : "마피아가 아닙니다."}`,
      });
    }

    if (detectiveAction) {
      const trackedAction = game.findSubmittedActionForActor(detectiveAction.targetId);
      summary.privateLines.push({
        userId: detectiveAction.actorId,
        line: trackedAction
          ? `${game.getPlayerOrThrow(detectiveAction.targetId).displayName} 님은 ${game.getPlayerOrThrow(trackedAction.targetId).displayName} 님을 선택했습니다.`
          : `${game.getPlayerOrThrow(detectiveAction.targetId).displayName} 님은 오늘 밤 눈에 띄는 행동을 하지 않았습니다.`,
      });
    }

    if (thugAction) {
      game.bulliedNextDay.add(thugAction.targetId);
    }

    let mafiaVictimId: string | null = mafiaResult.targetId;
    let mafiaVictimResolved = false;
    let actualMafiaVictimId: string | null = null;

    if (mafiaVictimId) {
      const target = game.getPlayerOrThrow(mafiaVictimId);
      // if (target.role === "beastman" && game.ruleset === "balance") {
      if (target.role === "beastman") {
        game.contactPlayer(target.userId);
        mafiaVictimId = null;
        mafiaVictimResolved = true;
        summary.privateLines.push({
          userId: target.userId,
          line: "회피가 발동해 살아남았고, 즉시 마피아팀과 접선했습니다.",
        });
      }
    }

    if (mafiaVictimId && !mafiaVictimResolved) {
      const redirected = game.resolveLoverRedirect(mafiaVictimId, summary, mafiaResult.killerId);
      const finalVictimId = redirected ?? mafiaVictimId;
      const finalVictim = game.getPlayerOrThrow(finalVictimId);
      // const soldierBlocked =
      //   game.ruleset === "balance" &&
      //   game.blockedTonightTargetId === finalVictimId &&
      //   finalVictim.role === "soldier";
      const soldierBlocked = game.blockedTonightTargetId === finalVictimId && finalVictim.role === "soldier";

      if (protectedId === finalVictimId) {
        game.queueAudioCue("doctor_save");
        summary.publicLines.push("의사의 치료로 아무도 죽지 않았습니다.");
      } else if (finalVictim.role === "soldier" && !finalVictim.soldierUsed && !soldierBlocked) {
        finalVictim.soldierUsed = true;
        summary.publicLines.push("군인의 방탄이 발동해 아무도 죽지 않았습니다.");
      } else {
        markNightDeath(finalVictimId, "마피아 처형");
        actualMafiaVictimId = finalVictimId;
        game.queueAudioCue("gunshots");
        summary.publicLines.push(`${finalVictim.displayName} 님이 밤사이 사망했습니다.`);

        if (finalVictim.role === "terrorist" && finalVictim.terrorMarkId && finalVictim.terrorMarkId === mafiaResult.killerId) {
          const killer = mafiaResult.killerId ? game.getPlayer(mafiaResult.killerId) : undefined;
          if (killer && killer.alive) {
            markNightDeath(killer.userId, "테러리스트 자폭");
            game.queueAudioCue("explosion");
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
      game.contactPlayer(beastAction.actorId);
      summary.privateLines.push({
        userId: beastAction.actorId,
        line: "표시한 대상이 실제로 마피아에게 살해되어 마피아팀과 접선했습니다.",
      });
    }

    if (beastAction && beastAction.action === "beastKill" && !game.hasOtherAliveMafiaTeam(beastAction.actorId)) {
      const target = game.getPlayer(beastAction.targetId);
      if (target && target.alive) {
        markNightDeath(target.userId, "짐승인간 처형");
        game.queueAudioCue("beast_howling");
        summary.publicLines.push(`${target.displayName} 님이 밤사이 사망했습니다.`);
      }
    }

    if (game.nightNumber === 1) {
      game.applyGraverobber(summary, actualMafiaVictimId);
    }

    if (reporterAction) {
      const target = game.getPlayer(reporterAction.targetId);
      const actor = game.getPlayerOrThrow(reporterAction.actorId);
      const publishFromDay = Math.max(2, game.dayNumber + 1);
      actor.reporterUsed = true;

      if (target && target.alive) {
        game.pendingArticle = {
          actorId: reporterAction.actorId,
          targetId: target.userId,
          role: target.role,
          publishFromDay,
        };
        summary.privateLines.push({
          userId: reporterAction.actorId,
          line: `${target.displayName} 님의 기사를 준비했습니다. 공개 가능 시점은 ${publishFromDay}번째 낮입니다.`,
        });
      } else {
        summary.privateLines.push({
          userId: reporterAction.actorId,
          line: "취재 대상이 밤사이 사망해 기사 작성에 실패했습니다.",
        });
      }
    }

    await game.syncSecretChannels(client);

    const medium = game.alivePlayers.find((player) => player.role === "medium");
    if (medium && !game.isBlockedTonight(medium.userId)) {
      const mediumTargetId = await game.requestAftermathTarget(
        client,
        medium.userId,
        "mediumAscend",
        "영매 성불",
        "죽은 플레이어 한 명을 골라 직업을 확인하고 성불시킵니다.",
        game.deadPlayers.filter((target) => !target.ascended).map((target) => target.userId),
      );

      if (mediumTargetId) {
        const target = game.getPlayerOrThrow(mediumTargetId);
        target.ascended = true;
        summary.privateLines.push({
          userId: medium.userId,
          line: `${target.displayName} 님의 직업은 ${getRoleLabel(target.role)}였습니다.`,
        });
      }
    }

    const priest = game.alivePlayers.find((player) => player.role === "priest" && !player.priestUsed);
    if (priest && !game.isBlockedTonight(priest.userId)) {
      const priestTargetId = await game.requestAftermathTarget(
        client,
        priest.userId,
        "priestRevive",
        "성직자 부활",
        "이번 밤에 죽은 플레이어 한 명을 골라 부활시킵니다.",
        [...nightDeathIds],
      );

      if (priestTargetId) {
        priest.priestUsed = true;
        const target = game.getPlayerOrThrow(priestTargetId);
        // const blockedByMedium = game.ruleset === "balance" && target.ascended;
        const blockedByMedium = target.ascended;
        if (blockedByMedium) {
          summary.privateLines.push({
            userId: priest.userId,
            line: "영매가 먼저 성불시킨 대상이라 부활이 실패했습니다.",
          });
        } else if (!target.alive) {
          game.revivePlayer(target.userId);
          game.queueAudioCue("revive");
          summary.publicLines.push(`${target.displayName} 님이 성직자의 힘으로 부활했습니다.`);
        }
      }
    }

    if (summary.publicLines.length === 0) {
      summary.publicLines.push("조용하게 밤이 지나갔습니다.");
    }

    for (const line of summary.privateLines) {
      await game.safeSendDm(client, line.userId, line.line);
    }

    await game.syncSecretChannels(client);
    game.setPublicLines(summary.publicLines);
    return summary;
  }

export function resolveMafiaKill(game: MafiaGame, records: NightActionRecord[]): { targetId: string | null; killerId: string | null } {
    const eligible = records.filter((record) => {
      const actor = game.getPlayer(record.actorId);
      return actor && actor.alive && actor.role === "mafia" && !game.isBlockedTonight(actor.userId);
    });

    if (eligible.length === 0) {
      return { targetId: null, killerId: null };
    }

    // 마지막에 제출된 행동이 최종 타겟을 결정한다.
    const lastSubmitted = eligible.sort((left, right) => right.submittedAt - left.submittedAt)[0];
    return { targetId: lastSubmitted.targetId, killerId: lastSubmitted.actorId };
  }

export function resolveLoverRedirect(game: MafiaGame, targetId: string, summary: ResolutionSummary, killerId: string | null): string | null {
    const target = game.getPlayerOrThrow(targetId);
    if (target.role !== "lover" || !target.loverId) {
      return null;
    }

    const partner = game.getPlayer(target.loverId);
    if (!partner || !partner.alive) {
      return null;
    }

    // if (game.ruleset === "balance" && game.blockedTonightTargetId === partner.userId) {
    if (game.blockedTonightTargetId === partner.userId) {
      return null;
    }

    if (killerId) {
      summary.privateLines.push({
        userId: target.userId,
        line: `${game.getPlayerOrThrow(killerId).displayName} 님이 당신을 노린 마피아였습니다.`,
      });
    }
    return partner.userId;
  }

export function applyGraverobber(game: MafiaGame, summary: ResolutionSummary, mafiaVictimId: string | null): void {
    if (!mafiaVictimId) {
      return;
    }

    const graverobber = game.alivePlayers.find((player) => player.role === "graverobber");
    const victim = game.getPlayer(mafiaVictimId);
    if (!graverobber || !victim) {
      return;
    }

    const stolenRole = victim.role;
    graverobber.role = stolenRole;
    victim.role = normalizeStolenRole(stolenRole, game.ruleset);
    game.queueAudioCue("ghoul", [graverobber.userId]);
    summary.privateLines.push({
      userId: graverobber.userId,
      line: `도굴 성공: ${victim.displayName} 님의 직업 ${getRoleLabel(stolenRole)}를 얻었습니다.`,
    });

    if (stolenRole === "lover" && victim.loverId) {
      const partnerId = victim.loverId;
      victim.loverId = undefined;
      graverobber.loverId = partnerId;
      const partner = game.getPlayer(partnerId);
      if (partner) {
        partner.loverId = graverobber.userId;
        game.loverPair = [graverobber.userId, partner.userId];
      }
    }
  }

export function appendSpyInspectionResult(game: MafiaGame, summary: ResolutionSummary, action: NightActionRecord): void {
    const target = game.getPlayerOrThrow(action.targetId);
    if (target.role === "soldier") {
      summary.privateLines.push({
        userId: action.actorId,
        line: `${target.displayName} 님은 군인이어서 조사 결과를 끝까지 확인하지 못했습니다.`,
      });
      summary.privateLines.push({
        userId: target.userId,
        line: `${game.getPlayerOrThrow(action.actorId).displayName} 님이 당신을 조사했습니다. 군인의 효과로 조사 부가효과가 무효화됩니다.`,
      });
      return;
    }

    summary.privateLines.push({
      userId: action.actorId,
      line: `조사 결과: ${target.displayName} 님은 ${getRoleLabel(target.role)}입니다.`,
    });
  }

export function getWinner(game: MafiaGame): string | null {
    const alive = game.alivePlayers;
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
