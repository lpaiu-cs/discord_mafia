import assert from "node:assert/strict";
import { test } from "node:test";
import { ButtonStyle } from "discord.js";
import { buildDashboardReply, buildDashboardWaitingReply } from "../src/discord/dashboard";
import { DashboardAccessService } from "../src/web/access";
import { JoinTicketService } from "../src/web/join-ticket";
import { FixedBaseUrlProvider } from "../src/web/public-base-url";

test("대시보드 입장 URL 은 auth/exchange join ticket 형태로 발급된다", async () => {
  const access = new DashboardAccessService(
    new FixedBaseUrlProvider("https://mafia.example.com"),
    new JoinTicketService("join-secret"),
    180_000,
  );

  const url = new URL(await access.issueJoinUrl("game-1", "user-1"));

  assert.equal(url.origin, "https://mafia.example.com");
  assert.equal(url.pathname, "/auth/exchange");
  assert.ok(url.searchParams.get("ticket"));
});

test("대시보드 응답에는 링크 버튼과 새 링크 발급 버튼이 함께 포함된다", () => {
  const payload = buildDashboardReply("game-1", "https://mafia.example.com/auth/exchange?ticket=abc", 180);
  const row = payload.components?.[0]?.toJSON();
  const [linkButton, refreshButton] = row?.components ?? [];

  assert.equal(linkButton?.style, ButtonStyle.Link);
  assert.equal(linkButton?.url, "https://mafia.example.com/auth/exchange?ticket=abc");
  assert.equal(refreshButton?.custom_id, "dashboard:game-1:refresh");
});

test("대기 중 대시보드 응답에는 열기 버튼과 상태 새로고침 버튼이 함께 포함된다", () => {
  const payload = buildDashboardWaitingReply("game-1");
  const row = payload.components?.[0]?.toJSON();
  const [openButton, refreshButton] = row?.components ?? [];

  assert.equal(openButton?.style, ButtonStyle.Primary);
  assert.equal(openButton?.custom_id, "dashboard:game-1:open");
  assert.equal(refreshButton?.custom_id, "dashboard:game-1:refresh");
});
