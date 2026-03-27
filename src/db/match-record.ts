import { MafiaGame } from "../game/game";
import { getTeam } from "../game/model";
import { RecordedMatch, RecordedMatchPlayer, RecordedMatchStatus } from "./types";

export function buildRecordedMatch(game: MafiaGame): RecordedMatch {
  const winnerTeam = normalizeWinnerTeam(game.endedWinner);
  const status: RecordedMatchStatus = winnerTeam ? "completed" : "aborted";
  const players = [...game.players.values()].map((player, index): RecordedMatchPlayer => ({
    discordUserId: player.userId,
    displayName: player.displayName,
    seatNo: index + 1,
    originalRole: player.originalRole,
    finalRole: player.role,
    team: getTeam(player.role),
    isHost: player.userId === game.hostId,
    isWinner: winnerTeam ? getTeam(player.role) === winnerTeam : false,
    survived: player.alive,
    deathReason: player.deadReason ?? null,
  }));

  return {
    externalGameId: game.id,
    discordGuildId: game.guildId,
    guildName: game.guildName,
    ruleset: game.ruleset,
    status,
    winnerTeam,
    endedReason: game.endedReason,
    playerCount: players.length,
    createdAt: new Date(game.createdAt),
    startedAt: game.startedAt ? new Date(game.startedAt) : null,
    endedAt: new Date(game.endedAt ?? Date.now()),
    players,
  };
}

function normalizeWinnerTeam(value: string | null): "mafia" | "citizen" | null {
  if (value === "마피아팀") {
    return "mafia";
  }

  if (value === "시민팀") {
    return "citizen";
  }

  return null;
}

export function playerWon(playerTeam: "mafia" | "citizen", winnerTeam: "mafia" | "citizen" | null): boolean {
  return Boolean(winnerTeam && playerTeam === winnerTeam);
}
