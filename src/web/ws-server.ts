import { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { GameStatsStore } from "../db/game-stats-store";
import { GameRegistry, InMemoryGameRegistry } from "../game/game";
import { requireSessionForWs } from "./routes/utils";
import { loadPlayerDashboardStats } from "./load-player-dashboard-stats";
import { buildDashboardState } from "./presenter";
import { SessionStore } from "./session-store";

export interface WsServerOptions {
  gameManager: GameRegistry;
  gameStatsStore: GameStatsStore;
  sessionStore: SessionStore;
  cookieBaseName: string;
}

export class DashboardWsServer {
  private readonly wss: WebSocketServer;

  constructor(private readonly options: WsServerOptions) {
    this.wss = new WebSocketServer({ noServer: true });

    this.options.gameManager.onGameStateChange = (gameId: string) => {
      void this.broadcastGameState(gameId);
    };
  }

  public handleUpgrade(request: IncomingMessage, socket: any, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/api\/game\/([^/]+)\/ws$/u);
    if (!match) {
      socket.destroy();
      return;
    }
    
    const gameId = match[1];
    const session = requireSessionForWs(request, gameId, this.options.cookieBaseName, this.options.sessionStore);
    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as ClientSocket).gameId = gameId;
      (ws as ClientSocket).discordUserId = session.discordUserId;
      (ws as ClientSocket).sessionId = session.id;
      this.wss.emit("connection", ws, request);
    });
  }

  public async broadcastGameState(gameId: string): Promise<void> {
    const game = this.options.gameManager.findByGameId(gameId);
    if (!game) return;

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        const authorizedClient = this.getAuthorizedClient(client, gameId);
        if (!authorizedClient) {
          continue;
        }

        const { userId } = authorizedClient;
        const clientGameId = authorizedClient.gameId;
        if (clientGameId === gameId && userId) {
          try {
            const playerStats = await loadPlayerDashboardStats(this.options.gameStatsStore, userId);
            const payload = buildDashboardState(game, userId, undefined, {
              statsEnabled: this.options.gameStatsStore.enabled,
              playerStats,
            });
            client.send(JSON.stringify({ type: "state", payload }));
          } catch (e) {
            // Ignore
          }
        }
      }
    }
  }

  private getAuthorizedClient(client: WebSocket, expectedGameId: string): AuthorizedClient | null {
    const socket = client as ClientSocket;
    if (socket.gameId !== expectedGameId || !socket.discordUserId || !socket.sessionId) {
      return null;
    }

    const session = this.options.sessionStore.get(socket.sessionId);
    if (!session || session.gameId !== socket.gameId || session.discordUserId !== socket.discordUserId) {
      client.close(4001, "session expired");
      return null;
    }

    return {
      gameId: socket.gameId,
      userId: socket.discordUserId,
    };
  }
}

interface ClientSocket extends WebSocket {
  gameId?: string;
  discordUserId?: string;
  sessionId?: string;
}

interface AuthorizedClient {
  gameId: string;
  userId: string;
}
