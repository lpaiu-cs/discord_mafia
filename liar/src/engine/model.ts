export type LiarPhase = "lobby" | "clue" | "discussion" | "voting" | "guess" | "ended";

export type LiarWinner = "citizens" | "liar" | "cancelled";

export type LiarMode = "modeA" | "modeB";

export interface LiarPlayer {
  readonly userId: string;
  displayName: string;
  readonly joinedAt: number;
}

export interface LiarClue {
  readonly userId: string;
  readonly displayName: string;
  readonly content: string;
  readonly submittedAt: number;
  readonly order: number;
}

export interface LiarVote {
  readonly voterId: string;
  readonly targetId: string;
  readonly submittedAt: number;
}

export interface LiarResult {
  readonly winner: LiarWinner;
  readonly reason: string;
  readonly accusedUserId: string | null;
  readonly guessedWord: string | null;
}

export interface LiarKeywordView {
  readonly mode: LiarMode;
  readonly categoryLabel: string;
  readonly isLiar: boolean;
  readonly knowsLiarRole: boolean;
  readonly keyword: string | null;
  readonly message: string;
}

export interface LiarClueSubmissionResult {
  readonly phaseChanged: boolean;
  readonly nextSpeakerId: string | null;
}

export interface LiarVoteResolution {
  readonly accusedUserId: string | null;
  readonly tiedUserIds: readonly string[];
  readonly phase: LiarPhase;
  readonly result: LiarResult | null;
}

export function liarModeLabel(mode: LiarMode): string {
  switch (mode) {
    case "modeA":
      return "모드A";
    case "modeB":
      return "모드B";
    default:
      return mode;
  }
}

export function liarModeSummary(mode: LiarMode): string {
  switch (mode) {
    case "modeA":
      return "라이어 공개형: 라이어는 자신이 라이어임을 알고 제시어를 받지 않습니다.";
    case "modeB":
      return "오답 제시어형: 라이어는 자신이 라이어인지 모른 채 혼자 다른 제시어를 받습니다.";
    default:
      return mode;
  }
}
