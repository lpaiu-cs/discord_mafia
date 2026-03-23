import assert from "node:assert/strict";
import { test } from "node:test";
import { JoinTicketService } from "../src/web/join-ticket";

test("join ticket 은 발급 후 1회만 소비할 수 있다", () => {
  const service = new JoinTicketService("join-secret");
  const ticket = service.issue({
    gameId: "game-1",
    discordUserId: "user-1",
    ttlMs: 180_000,
  });

  const payload = service.consume(ticket);

  assert.equal(payload.gameId, "game-1");
  assert.equal(payload.discordUserId, "user-1");
  assert.equal(payload.purpose, "join");
  assert.throws(() => service.consume(ticket), /이미 사용된 join ticket/);
});

test("join ticket 은 만료 시간을 넘기면 거부된다", () => {
  const service = new JoinTicketService("join-secret");
  const originalNow = Date.now;
  const issuedAt = 1_700_000_000_000;

  try {
    Date.now = () => issuedAt;
    const ticket = service.issue({
      gameId: "game-1",
      discordUserId: "user-1",
      ttlMs: 120_000,
    });

    Date.now = () => issuedAt + 120_001;

    assert.throws(() => service.consume(ticket), /만료/);
  } finally {
    Date.now = originalNow;
  }
});
