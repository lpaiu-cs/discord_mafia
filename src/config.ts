import dotenv from "dotenv";
import { Ruleset } from "./game/model";

dotenv.config();

type WebMode = "fixed" | "quick_tunnel";
type DeliveryMode = "web" | "discord-dm";

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

function readString(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function readRuleset(): Ruleset {
  const raw = (process.env.DISCORD_RULESET ?? "balance").toLowerCase();
  if (raw !== "initial" && raw !== "balance") {
    throw new Error("DISCORD_RULESET 은 initial 또는 balance 여야 합니다.");
  }

  return raw;
}

function readWebMode(): WebMode {
  const raw = readString("WEB_MODE", "fixed").toLowerCase();
  if (raw !== "fixed" && raw !== "quick_tunnel") {
    throw new Error("WEB_MODE 는 fixed 또는 quick_tunnel 이어야 합니다.");
  }

  return raw;
}

function readDeliveryMode(): DeliveryMode {
  const raw = readString("GAME_DELIVERY_MODE", "web").toLowerCase();
  if (raw !== "web" && raw !== "discord-dm") {
    throw new Error("GAME_DELIVERY_MODE 은 web 또는 discord-dm 이어야 합니다.");
  }

  return raw;
}

function readPublicBaseUrl(webMode: WebMode): string {
  if (webMode === "fixed") {
    return readRequired("PUBLIC_BASE_URL");
  }

  return readString("PUBLIC_BASE_URL", "");
}

function resolveSecureCookies(webMode: WebMode, publicBaseUrl: string): boolean {
  if (webMode === "quick_tunnel") {
    return true;
  }

  try {
    return new URL(publicBaseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

const webMode = readWebMode();
const publicBaseUrl = readPublicBaseUrl(webMode);

export const config = {
  token: readRequired("DISCORD_BOT_TOKEN"),
  applicationId: readRequired("DISCORD_APPLICATION_ID"),
  guildId: process.env.DISCORD_GUILD_ID ?? "",
  ruleset: readRuleset(),
  trialVoteSeconds: readInteger("TRIAL_VOTE_SECONDS", 10),
  autoDeleteSecretChannels: readBoolean("AUTO_DELETE_SECRET_CHANNELS", false),
  publicBaseUrl,
  webSessionSecret: readRequired("WEB_SESSION_SECRET"),
  joinTicketSecret: readRequired("JOIN_TICKET_SECRET"),
  webMode,
  quickTunnelEnabled: readBoolean("QUICK_TUNNEL_ENABLED", false),
  webPort: readInteger("WEB_PORT", 3000),
  joinTicketTtlSeconds: readInteger("JOIN_TICKET_TTL_SECONDS", 180),
  endedGameRetentionSeconds: readInteger("ENDED_GAME_RETENTION_SECONDS", 900),
  gameDeliveryMode: readDeliveryMode(),
  secureCookies: resolveSecureCookies(webMode, publicBaseUrl),
};
