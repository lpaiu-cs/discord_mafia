import { EnsureUserProfileInput } from "./user-profile";
import { GameStatsStore } from "./game-stats-store";

export async function ensureUserProfile(store: GameStatsStore, profile: EnsureUserProfileInput): Promise<void> {
  if (!store.enabled) {
    return;
  }

  try {
    await store.ensureUserProfile(profile);
  } catch (error) {
    console.error(`failed to sync user profile for ${profile.discordUserId}`, error);
  }
}
