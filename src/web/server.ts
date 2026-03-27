import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Client } from "discord.js";
import { GameStatsStore, NoopGameStatsStore } from "../db/game-stats-store";
import { GameRegistry } from "../game/game";
import { JoinTicketService } from "./join-ticket";
import { RateLimiter } from "./middleware/rate-limit";
import { SessionStore } from "./session-store";
import { RouteContext } from "./routes/context";
import { DashboardWsServer } from "./ws-server";

// Routes
import { handleExchange } from "./routes/auth-routes";
import { handleGamePage } from "./routes/page-routes";
import { handleGameState } from "./routes/state-routes";
import { handleAction } from "./routes/action-routes";
import { handleChat } from "./routes/chat-routes";
import { handleResource, handleClientAsset } from "./routes/static-routes";
import { sendJson, safeDecodePath } from "./routes/utils";

interface DashboardServerOptions {
  client: Client;
  gameManager: GameRegistry;
  gameStatsStore?: GameStatsStore;
  joinTicketService: JoinTicketService;
  sessionStore: SessionStore;
  port: number;
  secureCookies: boolean;
}

export class DashboardServer {
  private readonly server: Server;
  private readonly wsServer: DashboardWsServer;
  private readonly gameStatsStore: GameStatsStore;
  private readonly authRateLimit = new RateLimiter(20, 60_000);
  private readonly stateRateLimit = new RateLimiter(240, 60_000);
  private readonly actionRateLimit = new RateLimiter(120, 60_000);
  private readonly chatRateLimit = new RateLimiter(120, 60_000);
  private readonly cookieBaseName = "mafia_session";

  constructor(private readonly options: DashboardServerOptions) {
    this.gameStatsStore = this.options.gameStatsStore ?? new NoopGameStatsStore();
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    this.wsServer = new DashboardWsServer({
      gameManager: this.options.gameManager,
      gameStatsStore: this.gameStatsStore,
      sessionStore: this.options.sessionStore,
      cookieBaseName: this.cookieBaseName,
    });

    this.server.on("upgrade", (request, socket, head) => {
      this.wsServer.handleUpgrade(request, socket, head);
    });
  }

  public broadcastGameState(gameId: string): void {
     this.wsServer.broadcastGameState(gameId);
  }

  async listen(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, () => {
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("웹 서버 포트를 확인할 수 없습니다."));
          return;
        }

        resolve(address.port);
      });
    });
  }

  async close(): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      const ctx: RouteContext = {
        request,
        response,
        url,
        gameManager: this.options.gameManager,
        gameStatsStore: this.gameStatsStore,
        joinTicketService: this.options.joinTicketService,
        sessionStore: this.options.sessionStore,
        secureCookies: this.options.secureCookies,
        client: this.options.client,
        authRateLimit: this.authRateLimit,
        stateRateLimit: this.stateRateLimit,
        actionRateLimit: this.actionRateLimit,
        chatRateLimit: this.chatRateLimit,
        cookieBaseName: this.cookieBaseName,
      };

      const resourceMatch = pathname.match(/^\/resource\/(.+?\.(?:png|svg|wav|mp3))$/u);
      if (resourceMatch && method === "GET") {
        await handleResource(ctx, safeDecodePath(resourceMatch[1]));
        return;
      }

      const clientMatch = pathname.match(/^\/client\/(.+?\.(?:js|css))$/u);
      if (clientMatch && method === "GET") {
        await handleClientAsset(ctx, clientMatch[1]);
        return;
      }

      if ((pathname === "/auth/exchange" || pathname === "/join") && method === "GET") {
        await handleExchange(ctx);
        return;
      }

      const pageMatch = pathname.match(/^\/game\/([^/]+)$/u);
      if (pageMatch && method === "GET") {
        await handleGamePage(ctx, pageMatch[1]);
        return;
      }

      const stateMatch = pathname.match(/^\/api\/game\/([^/]+)\/state$/u);
      if (stateMatch && method === "GET") {
        await handleGameState(ctx, stateMatch[1]);
        return;
      }

      const actionMatch = pathname.match(/^\/api\/game\/([^/]+)\/actions$/u);
      if (actionMatch && method === "POST") {
        await handleAction(ctx, actionMatch[1]);
        return;
      }

      const chatMatch = pathname.match(/^\/api\/game\/([^/]+)\/chats\/([^/]+)$/u);
      if (chatMatch && method === "POST") {
        await handleChat(ctx, chatMatch[1], chatMatch[2]);
        return;
      }

      sendJson(response, 404, { error: "경로를 찾을 수 없습니다." });
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: error instanceof Error ? error.message : "서버 오류" });
    }
  }
}
