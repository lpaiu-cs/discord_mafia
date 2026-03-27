import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface JoinTicketPayload {
  gameId: string;
  discordUserId: string;
  issuedAt: number;
  expiresAt: number;
  jti: string;
  purpose: "join";
}

export interface IssueJoinTicketInput {
  gameId: string;
  discordUserId: string;
  ttlMs: number;
}

export interface JoinTicketStore {
  isUsed(jti: string): Promise<boolean> | boolean;
  markUsed(jti: string, expiresAt: number): Promise<void> | void;
}

export class InMemoryJoinTicketStore implements JoinTicketStore {
  private readonly usedTicketIds = new Map<string, number>();

  isUsed(jti: string): boolean {
    this.cleanup();
    return this.usedTicketIds.has(jti);
  }

  markUsed(jti: string, expiresAt: number): void {
    this.usedTicketIds.set(jti, expiresAt);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.usedTicketIds.entries()) {
      if (expiresAt <= now) {
        this.usedTicketIds.delete(jti);
      }
    }
  }
}

export class JoinTicketService {
  constructor(
    private readonly secret: string,
    private readonly store: JoinTicketStore = new InMemoryJoinTicketStore(),
  ) {}

  issue(input: IssueJoinTicketInput): string {
    const issuedAt = Date.now();
    const payload: JoinTicketPayload = {
      gameId: input.gameId,
      discordUserId: input.discordUserId,
      issuedAt,
      expiresAt: issuedAt + input.ttlMs,
      jti: randomUUID(),
      purpose: "join",
    };

    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  async consume(ticket: string): Promise<JoinTicketPayload> {
    const payload = this.verify(ticket);
    const used = await this.store.isUsed(payload.jti);
    if (used) {
      throw new Error("이미 사용된 join ticket 입니다.");
    }

    await this.store.markUsed(payload.jti, payload.expiresAt);
    return payload;
  }

  verify(ticket: string): JoinTicketPayload {
    const [encodedPayload, receivedSignature] = ticket.split(".");
    if (!encodedPayload || !receivedSignature) {
      throw new Error("잘못된 join ticket 형식입니다.");
    }

    const expectedSignature = this.sign(encodedPayload);
    if (!safeEquals(receivedSignature, expectedSignature)) {
      throw new Error("join ticket 서명이 올바르지 않습니다.");
    }

    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<JoinTicketPayload>;
    if (
      typeof parsed.gameId !== "string" ||
      typeof parsed.discordUserId !== "string" ||
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.jti !== "string" ||
      parsed.purpose !== "join"
    ) {
      throw new Error("join ticket payload 가 올바르지 않습니다.");
    }

    if (parsed.expiresAt <= Date.now()) {
      throw new Error("join ticket 이 만료되었습니다.");
    }

    return parsed as JoinTicketPayload;
  }

  hash(ticket: string): string {
    return createHash("sha256").update(ticket).digest("hex");
  }

  private sign(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }

}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
