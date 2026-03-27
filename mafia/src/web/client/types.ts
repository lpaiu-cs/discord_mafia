export interface Seat {
  seat: number;
  empty: boolean;
  userId?: string;
  isViewer?: boolean;
  alive?: boolean;
  displayName?: string;
  bullied?: boolean;
  ascended?: boolean;
}

export interface RoomState {
  gameId: string;
  rulesetLabel: string;
  phase: string;
  phaseLabel: string;
  dayNumber: number;
  nightNumber: number;
  deadlineAt?: number | null;
  seats: Seat[];
  currentTrialTargetName?: string | null;
  alivePlayers: Array<{ userId: string; displayName: string; bullied: boolean }>;
  deadPlayers: Array<{ userId: string; displayName: string; ascended: boolean }>;
}

export interface ViewerState {
  userId: string;
  displayName: string;
  role: string;
  roleLabel: string;
  roleSummary: string;
  teamLabel: string;
  alive: boolean;
  contacted: boolean;
  loverName?: string | null;
  deadReason?: string | null;
  ascended?: boolean;
}

export interface ActionControl {
  id: string;
  type: "info" | "button" | "buttons" | "grid" | "select";
  title: string;
  description: string;
  actionType: string;
  action?: string;
  buttons?: { label: string; value: string }[];
  options?: { label: string; value: string }[];
  currentValue?: string | null;
  currentLabel?: string | null;
}

export interface ChatMessage {
  id: string;
  kind: "system" | "player";
  content: string;
  authorId?: string;
  authorName?: string;
  createdAt: number;
}

export interface ChatThread {
  channel: string;
  title: string;
  canWrite: boolean;
  messages: ChatMessage[];
}

export interface SystemLogLine {
  createdAt: number;
  line: string;
}

export interface EndedSummary {
  viewerResultLabel?: string;
  winnerLabel?: string;
  reason?: string;
  revealedPlayers: any[];
}

export interface AudioCue {
  id: string;
  key: string;
  createdAt: number;
}

export interface PersonalRoleStat {
  role: string;
  roleLabel: string;
  plays: number;
  wins: number;
  losses: number;
  winRatePercent: number;
}

export interface PersonalRecentMatch {
  externalGameId: string;
  guildName: string | null;
  rulesetLabel: string;
  status: "completed" | "aborted";
  statusLabel: string;
  resultLabel: string;
  winnerTeamLabel: string | null;
  endedReason: string | null;
  playerCount: number;
  endedAt: number;
  originalRoleLabel: string;
  finalRoleLabel: string;
  teamLabel: string;
  survived: boolean;
  deathReason: string | null;
}

export interface PersonalStats {
  enabled: boolean;
  hasRecordedMatches: boolean;
  summary: {
    matchesPlayed: number;
    wins: number;
    losses: number;
    winRatePercent: number;
    mafiaWins: number;
    citizenWins: number;
  };
  roleStats: PersonalRoleStat[];
  recentMatches: PersonalRecentMatch[];
}

export interface GameState {
  room: RoomState;
  viewer: ViewerState;
  publicLines: string[];
  actions: {
    notices: string[];
    controls: ActionControl[];
  };
  publicChat: ChatThread;
  secretChats: ChatThread[];
  systemLog: {
    privateLines: SystemLogLine[];
  };
  endedSummary?: EndedSummary;
  audioCues?: AudioCue[];
  personalStats: PersonalStats;
}

export interface InitialPayload extends GameState {
  version: number;
  serverNow: number;
}

export type DashboardStatePayload = InitialPayload;
