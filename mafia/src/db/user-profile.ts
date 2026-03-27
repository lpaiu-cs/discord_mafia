export interface UserProfile {
  discordUserId: string;
  latestDisplayName: string;
  latestGuildId: string | null;
  latestGuildName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastPlayedAt: Date | null;
}

export interface EnsureUserProfileInput {
  discordUserId: string;
  displayName: string;
  discordGuildId?: string | null;
  guildName?: string | null;
}
