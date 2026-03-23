import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuickTunnelUrl } from "../src/web/public-base-url";

test("quick tunnel 출력에서 trycloudflare URL 을 파싱한다", () => {
  const parsed = parseQuickTunnelUrl("INF Your quick Tunnel has been created! Visit it at https://amber-field.trycloudflare.com");
  assert.equal(parsed, "https://amber-field.trycloudflare.com");
});

test("quick tunnel URL 이 없으면 null 을 반환한다", () => {
  assert.equal(parseQuickTunnelUrl("no tunnel here"), null);
});
