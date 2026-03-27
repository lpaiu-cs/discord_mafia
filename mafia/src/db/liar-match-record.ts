import { LiarGame } from "../../../liar/src";
import { RecordedLiarMatch, RecordedLiarMatchPlayer, RecordedLiarMatchStatus, RecordedLiarWinner } from "./liar-types";

export function buildRecordedLiarMatch(game: LiarGame): RecordedLiarMatch {
  const winner = normalizeLiarWinner(game.result?.winner ?? null);
  const status: RecordedLiarMatchStatus = winner ? "completed" : "cancelled";
  const clueByUserId = new Map(game.clues.map((clue) => [clue.userId, clue]));
  const voteByUserId = new Map([...game.votes.values()].map((vote) => [vote.voterId, vote]));
  const players = [...game.players.values()]
    .sort((left, right) => left.joinedAt - right.joinedAt)
    .map((player, index): RecordedLiarMatchPlayer => ({
      discordUserId: player.userId,
      displayName: player.displayName,
      joinedOrder: index + 1,
      isHost: player.userId === game.hostId,
      isLiar: player.userId === game.liarId,
      wasAccused: player.userId === game.accusedUserId,
      isWinner: playerWon(player.userId === game.liarId, winner),
      submittedClue: clueByUserId.has(player.userId),
      clueOrder: clueByUserId.get(player.userId)?.order ?? null,
      voteTargetUserId: voteByUserId.get(player.userId)?.targetId ?? null,
    }));

  return {
    externalGameId: game.id,
    discordGuildId: game.guildId,
    guildName: game.guildName,
    mode: game.mode,
    categoryId: game.categoryId,
    categoryLabel: game.category.label,
    secretWord: game.secretWord,
    liarAssignedWord: game.liarAssignedWord,
    status,
    winner,
    endedReason: game.result?.reason ?? null,
    guessedWord: game.result?.guessedWord ?? null,
    accusedUserId: game.accusedUserId,
    playerCount: players.length,
    createdAt: new Date(game.createdAt),
    startedAt: game.startedAt ? new Date(game.startedAt) : null,
    endedAt: new Date(game.endedAt ?? Date.now()),
    players,
  };
}

function normalizeLiarWinner(value: "liar" | "citizens" | "cancelled" | null): RecordedLiarWinner {
  if (value === "liar" || value === "citizens") {
    return value;
  }

  return null;
}

function playerWon(isLiar: boolean, winner: RecordedLiarWinner): boolean {
  if (!winner) {
    return false;
  }

  return winner === "liar" ? isLiar : !isLiar;
}
