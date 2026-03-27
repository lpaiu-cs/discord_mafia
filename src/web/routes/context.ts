import { ServerResponse, IncomingMessage } from "node:http";
import { Client } from "discord.js";
import { GameRegistry } from "../../game/game";
import { GameStatsStore } from "../../db/game-stats-store";
import { JoinTicketService } from "../join-ticket";
import { SessionStore, WebSession } from "../session-store";
import { RateLimiter } from "../middleware/rate-limit";

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  gameManager: GameRegistry;
  gameStatsStore: GameStatsStore;
  joinTicketService: JoinTicketService;
  sessionStore: SessionStore;
  secureCookies: boolean;
  userSession?: WebSession;
  client?: Client;
  authRateLimit: RateLimiter;
  stateRateLimit: RateLimiter;
  actionRateLimit: RateLimiter;
  chatRateLimit: RateLimiter;
  cookieBaseName: string;
}
