export type Ruleset = "initial" | "balance";

export const ASSIGNABLE_ROLES = [
  "mafia",
  "spy",
  "beastman",
  "madam",
  "police",
  "doctor",
  "soldier",
  "politician",
  "medium",
  "lover",
  "thug",
  "reporter",
  "detective",
  "graverobber",
  "terrorist",
  "priest",
] as const;

export const INTERNAL_ONLY_ROLES = ["citizen", "evil"] as const;

export type PublicRole = (typeof ASSIGNABLE_ROLES)[number];
export type InternalRole = (typeof INTERNAL_ONLY_ROLES)[number];
export type Role = PublicRole | InternalRole;

export type Team = "citizen" | "mafia";
export type Phase =
  | "lobby"
  | "night"
  | "discussion"
  | "vote"
  | "defense"
  | "trial"
  | "ended";

export interface RoleTemplate {
  mafia: number;
  support: number;
  police: number;
  doctor: number;
  special: number;
}

export interface RoleAssignmentResult {
  roles: Role[];
  template: RoleTemplate;
}

export interface NightActionRecord {
  actorId: string;
  action: NightActionType;
  targetId: string;
  submittedAt: number;
}

export type NightActionType =
  | "mafiaKill"
  | "spyInspect"
  | "beastMark"
  | "beastKill"
  | "policeInspect"
  | "doctorProtect"
  | "mediumAscend"
  | "thugThreaten"
  | "reporterArticle"
  | "detectiveTrack"
  | "terrorMark"
  | "priestRevive";

export interface PendingArticle {
  actorId: string;
  targetId: string;
  role: Role;
  publishFromDay: number;
}

export interface PendingTrialBurn {
  actorId: string;
  targetId: string;
}

export interface PhaseContext {
  token: number;
  startedAt: number;
  deadlineAt: number;
}

export interface SecretChannelIds {
  categoryId?: string;
  mafiaId?: string;
  loverId?: string;
  graveyardId?: string;
}

export interface PlayerState {
  userId: string;
  displayName: string;
  role: Role;
  originalRole: Role;
  alive: boolean;
  deadReason?: string;
  isContacted: boolean;
  loverId?: string;
  ascended: boolean;
  soldierUsed: boolean;
  reporterUsed: boolean;
  priestUsed: boolean;
  terrorMarkId?: string;
  voteLockedToday: boolean;
  timeAdjustUsedOnDay: number | null;
}

export interface ResolutionSummary {
  publicLines: string[];
  privateLines: Array<{ userId: string; line: string }>;
}

export function isAssignableRole(role: Role): role is PublicRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

export function isMafiaTeam(role: Role): boolean {
  return role === "mafia" || role === "spy" || role === "beastman" || role === "madam" || role === "evil";
}

export function getTeam(role: Role): Team {
  return isMafiaTeam(role) ? "mafia" : "citizen";
}

export function isLivingSpecialRole(role: Role): boolean {
  return (
    role !== "mafia" &&
    role !== "spy" &&
    role !== "beastman" &&
    role !== "madam" &&
    role !== "police" &&
    role !== "doctor" &&
    role !== "citizen" &&
    role !== "evil"
  );
}
