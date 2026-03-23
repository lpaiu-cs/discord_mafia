import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionStore } from "../src/web/session-store";

test("세션 쿠키는 서명되고 파싱된다", () => {
  const store = new SessionStore("session-secret");
  const session = store.create("game-1", "user-1");

  const cookieValue = store.serializeCookieValue(session.id);
  const parsedSessionId = store.parseCookieValue(cookieValue);

  assert.equal(parsedSessionId, session.id);
  assert.equal(store.get(parsedSessionId!), session);
});

test("같은 게임 같은 유저의 새 세션은 이전 세션을 무효화한다", () => {
  const store = new SessionStore("session-secret");
  const first = store.create("game-1", "user-1");
  const second = store.create("game-1", "user-1");

  assert.equal(store.get(first.id), null);
  assert.equal(store.get(second.id)?.id, second.id);
});
