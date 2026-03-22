import dotenv from "dotenv";
import { Ruleset } from "./game/model";

dotenv.config();

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경 변수가 필요합니다.`);
  }

  return value;
}

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} 는 정수여야 합니다.`);
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return raw.toLowerCase() === "true";
}

function readRuleset(): Ruleset {
  const raw = (process.env.DISCORD_RULESET ?? "balance").toLowerCase();
  if (raw !== "initial" && raw !== "balance") {
    throw new Error("DISCORD_RULESET 은 initial 또는 balance 여야 합니다.");
  }

  return raw;
}

export const config = {
  token: readRequired("DISCORD_BOT_TOKEN"),
  applicationId: readRequired("DISCORD_APPLICATION_ID"),
  guildId: process.env.DISCORD_GUILD_ID ?? "",
  ruleset: readRuleset(),
  trialVoteSeconds: readInteger("TRIAL_VOTE_SECONDS", 10),
  autoDeleteSecretChannels: readBoolean("AUTO_DELETE_SECRET_CHANNELS", false),
};
