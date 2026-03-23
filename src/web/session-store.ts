import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface WebSession {
  id: string;
  gameId: string;
  discordUserId: string;
  createdAt: number;
  lastSeenAt: number;
  csrfToken: string;
}

export class SessionStore {
  private readonly sessions = new Map<string, WebSession>();
  private readonly currentByGameUser = new Map<string, string>();

  constructor(private readonly secret: string) {}

  create(gameId: string, discordUserId: string): WebSession {
    this.invalidateForGameUser(gameId, discordUserId);

    const now = Date.now();
    const session: WebSession = {
      id: randomUUID(),
      gameId,
      discordUserId,
      createdAt: now,
      lastSeenAt: now,
      csrfToken: randomUUID(),
    };

    this.sessions.set(session.id, session);
    this.currentByGameUser.set(this.key(gameId, discordUserId), session.id);
    return session;
  }

  get(sessionId: string): WebSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const currentId = this.currentByGameUser.get(this.key(session.gameId, session.discordUserId));
    if (currentId !== session.id) {
      this.sessions.delete(session.id);
      return null;
    }

    return session;
  }

  touch(sessionId: string): WebSession | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }

    session.lastSeenAt = Date.now();
    return session;
  }

  invalidate(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    const key = this.key(session.gameId, session.discordUserId);
    if (this.currentByGameUser.get(key) === sessionId) {
      this.currentByGameUser.delete(key);
    }
  }

  invalidateForGameUser(gameId: string, discordUserId: string): void {
    const current = this.currentByGameUser.get(this.key(gameId, discordUserId));
    if (current) {
      this.invalidate(current);
    }
  }

  serializeCookieValue(sessionId: string): string {
    const signature = this.sign(sessionId);
    return `${sessionId}.${signature}`;
  }

  parseCookieValue(cookieValue: string): string | null {
    const [sessionId, signature] = cookieValue.split(".");
    if (!sessionId || !signature) {
      return null;
    }

    const expected = this.sign(sessionId);
    if (!safeEquals(signature, expected)) {
      return null;
    }

    return sessionId;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }

  private key(gameId: string, discordUserId: string): string {
    return `${gameId}:${discordUserId}`;
  }
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
