import { spawn } from "node:child_process";

export interface PublicBaseUrlHandle {
  publicBaseUrl: string;
  dispose: () => Promise<void>;
}

export interface PublicBaseUrlProvider {
  getPublicBaseUrl(gameId: string): Promise<string>;
  start(gameId: string): Promise<PublicBaseUrlHandle>;
  stop(gameId: string): Promise<void>;
}

export class FixedBaseUrlProvider implements PublicBaseUrlProvider {
  constructor(private readonly publicBaseUrl: string) {}

  async getPublicBaseUrl(_gameId: string): Promise<string> {
    return this.publicBaseUrl;
  }

  async start(_gameId: string): Promise<PublicBaseUrlHandle> {
    return {
      publicBaseUrl: this.publicBaseUrl,
      dispose: async () => undefined,
    };
  }

  async stop(_gameId: string): Promise<void> {
    return;
  }
}

interface QuickTunnelRecord {
  process: ReturnType<typeof spawn>;
  publicBaseUrl: string;
  dispose: () => Promise<void>;
}

export class QuickTunnelProvider implements PublicBaseUrlProvider {
  private readonly records = new Map<string, Promise<QuickTunnelRecord>>();

  constructor(
    private readonly localPort: number,
    private readonly enabled: boolean,
  ) {}

  async getPublicBaseUrl(gameId: string): Promise<string> {
    const handle = await this.start(gameId);
    return handle.publicBaseUrl;
  }

  async start(gameId: string): Promise<PublicBaseUrlHandle> {
    if (!this.enabled) {
      throw new Error("quick_tunnel provider 가 비활성화되어 있습니다.");
    }

    if (!this.records.has(gameId)) {
      this.records.set(gameId, this.spawnTunnel(gameId));
    }

    const record = await this.records.get(gameId)!;
    return {
      publicBaseUrl: record.publicBaseUrl,
      dispose: record.dispose,
    };
  }

  async stop(gameId: string): Promise<void> {
    const record = this.records.get(gameId);
    if (!record) {
      return;
    }

    try {
      await (await record).dispose();
    } finally {
      this.records.delete(gameId);
    }
  }

  private async spawnTunnel(gameId: string): Promise<QuickTunnelRecord> {
    return await new Promise<QuickTunnelRecord>((resolve, reject) => {
      const child = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${this.localPort}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill();
        reject(new Error("cloudflared quick tunnel URL 을 시간 내에 받지 못했습니다."));
      }, 15_000);

      const cleanupListeners = () => {
        clearTimeout(timeout);
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();
      };

      const finish = (publicBaseUrl: string) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        const dispose = async () => {
          if (!child.killed) {
            child.kill();
          }
        };
        resolve({
          process: child,
          publicBaseUrl,
          dispose,
        });
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanupListeners();
        reject(error);
      };

      const inspect = (chunk: string) => {
        const parsed = parseQuickTunnelUrl(chunk);
        if (parsed) {
          finish(parsed);
        }
      };

      child.stdout.on("data", (chunk: Buffer | string) => inspect(chunk.toString()));
      child.stderr.on("data", (chunk: Buffer | string) => inspect(chunk.toString()));
      child.once("error", (error) => fail(error instanceof Error ? error : new Error(String(error))));
      child.once("exit", (code) => {
        if (!settled) {
          fail(new Error(`cloudflared process exited before URL was ready (gameId=${gameId}, code=${code ?? "null"})`));
        }
      });
    });
  }
}

export function parseQuickTunnelUrl(text: string): string | null {
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
  return match?.[0] ?? null;
}
