import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface WebSession {
  id: string;
  gameId: string;
  discordUserId: string;
  createdAt: number;
  lastSeenAt: number;
  csrfToken: string;
}

export interface SessionStore {
  create(gameId: string, discordUserId: string): WebSession;
  get(sessionId: string): WebSession | null;
  touch(sessionId: string): WebSession | null;
  invalidate(sessionId: string): void;
  invalidateForGameUser(gameId: string, discordUserId: string): void;
  invalidateGame(gameId: string): void;
  serializeCookieValue(sessionId: string): string;
  parseCookieValue(cookieValue: string): string | null;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, WebSession>();
  private readonly currentByGameUser = new Map<string, string>();

  constructor(
    private readonly secret: string,
    private readonly maxIdleMs = 12 * 60 * 60 * 1_000,
  ) {}

  create(gameId: string, discordUserId: string): WebSession {
    this.cleanup();
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
    this.cleanup();
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
    this.cleanup();
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

  invalidateGame(gameId: string): void {
    const sessionIds = [...this.sessions.values()]
      .filter((session) => session.gameId === gameId)
      .map((session) => session.id);

    for (const sessionId of sessionIds) {
      this.invalidate(sessionId);
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

  private cleanup(now = Date.now()): void {
    const threshold = now - this.maxIdleMs;
    const expired = [...this.sessions.values()]
      .filter((session) => session.lastSeenAt <= threshold)
      .map((session) => session.id);

    for (const sessionId of expired) {
      this.invalidate(sessionId);
    }
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
