import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuickTunnelUrl, resolveCloudflaredExecutable } from "../src/web/public-base-url";

test("quick tunnel 출력에서 trycloudflare URL 을 파싱한다", () => {
  const parsed = parseQuickTunnelUrl("INF Your quick Tunnel has been created! Visit it at https://amber-field.trycloudflare.com");
  assert.equal(parsed, "https://amber-field.trycloudflare.com");
});

test("quick tunnel URL 이 없으면 null 을 반환한다", () => {
  assert.equal(parseQuickTunnelUrl("no tunnel here"), null);
});

test("명시된 cloudflared 경로가 있으면 그 경로를 사용한다", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-test-"));
  const executable = path.join(directory, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  fs.writeFileSync(executable, "stub");

  assert.equal(resolveCloudflaredExecutable(executable), executable);
});
