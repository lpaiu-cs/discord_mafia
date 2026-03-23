import { DashboardStatePayload } from "./presenter";

export function renderDashboardPage(initialState: DashboardStatePayload, csrfToken: string): string {
  const stateJson = JSON.stringify(initialState).replace(/</g, "\\u003c");
  const safeCsrf = escapeAttribute(csrfToken);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="csrf-token" content="${safeCsrf}" />
    <title>Discord Mafia Dashboard</title>
    <style>
      :root {
        --bg: #0a0a0b;
        --panel: rgba(255, 255, 255, 0.07);
        --panel-soft: rgba(255, 255, 255, 0.045);
        --panel-strong: rgba(255, 255, 255, 0.09);
        --border: rgba(255, 255, 255, 0.1);
        --text: #f5f7fb;
        --muted: #b8c4d6;
        --accent: #f5b45f;
        --accent-strong: #ff9248;
        --danger: #ff7171;
        --success: #75d1a2;
        --mafia-bg: rgba(255, 115, 115, 0.16);
        --mafia-border: rgba(255, 130, 130, 0.22);
        --citizen-bg: rgba(115, 160, 255, 0.14);
        --citizen-border: rgba(143, 179, 255, 0.22);
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        --dock-shadow: 0 18px 36px rgba(0, 0, 0, 0.36);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(245, 180, 95, 0.12), transparent 30%),
          radial-gradient(circle at bottom right, rgba(255, 104, 104, 0.08), transparent 26%),
          linear-gradient(145deg, #060606 0%, #101011 42%, #171719 100%);
        color: var(--text);
        font-family: "Segoe UI Variable", "Noto Sans KR", "Malgun Gothic", sans-serif;
      }

      .shell {
        width: min(100%, 980px);
        margin: 0 auto;
        padding: 12px 12px calc(104px + env(safe-area-inset-bottom));
      }

      .hero {
        display: grid;
        gap: 12px;
        margin-bottom: 14px;
        padding: 14px;
        border: 1px solid var(--border);
        border-radius: 22px;
        background:
          linear-gradient(150deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.025)),
          linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent);
        box-shadow: var(--shadow);
      }

      .hero-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }

      .hero-copy {
        min-width: 0;
        display: grid;
        gap: 4px;
      }

      .hero h1 {
        margin: 0;
        font-size: 1.12rem;
        line-height: 1.2;
      }

      .nick-color-1 { color: #ff7171; }
      .nick-color-2 { color: #ffab63; }
      .nick-color-3 { color: #ffe168; }
      .nick-color-4 { color: #75dd9f; }
      .nick-color-5 { color: #70b4ff; }
      .nick-color-6 { color: #c597ff; }
      .nick-color-7 { color: #f5f7fb; }
      .nick-color-8 { color: #ff94d1; }

      .hero p {
        margin: 0;
        color: var(--muted);
        font-size: 0.84rem;
        line-height: 1.35;
      }

      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .meta-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 8px 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
        font-size: 0.84rem;
      }

      .meta-chip strong {
        color: var(--text);
        font-size: 0.9rem;
      }

      .role-chip {
        color: var(--text);
      }

      .role-chip--mafia {
        background: var(--mafia-bg);
        border-color: var(--mafia-border);
      }

      .role-chip--citizen {
        background: var(--citizen-bg);
        border-color: var(--citizen-border);
      }

      .hero-compact-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .dashboard-grid {
        display: block;
      }

      .panel {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 24px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.03));
        box-shadow: var(--shadow);
      }

      .section-panel {
        display: none;
        margin-bottom: 14px;
      }

      .section-panel.is-active {
        display: block;
      }

      .panel-head {
        display: grid;
        gap: 5px;
        padding: 18px 16px 12px;
      }

      .panel-head h2,
      .panel-head h3 {
        margin: 0;
        font-size: 1rem;
      }

      .panel-head p {
        margin: 0;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.4;
      }

      .panel-body {
        padding: 0 16px 16px;
      }

      .viewer-stack,
      .card-list,
      .line-list,
      .control-list,
      .secret-stack {
        display: grid;
        gap: 10px;
      }

      .line-list {
        max-height: min(42vh, 360px);
        overflow: auto;
        padding-right: 2px;
      }

      .chat-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        max-height: none;
        overflow: auto;
        padding: 4px 2px 2px;
        scroll-behavior: smooth;
      }

      .viewer-card,
      .line-item,
      .control,
      .secret-chat {
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 18px;
        background: var(--panel-soft);
      }

      .viewer-card--mafia {
        background: var(--mafia-bg);
        border-color: var(--mafia-border);
      }

      .viewer-card--citizen {
        background: var(--citizen-bg);
        border-color: var(--citizen-border);
      }

      .viewer-card strong,
      .line-item strong,
      .control strong {
        display: block;
        margin-bottom: 6px;
      }

      .mini-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .seat-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        margin-top: 2px;
      }

      .seat-card {
        position: relative;
        display: flex;
        align-items: flex-end;
        aspect-ratio: 1 / 1;
        padding: 16px 8px 8px;
        overflow: visible;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 12px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03)),
          rgba(18, 18, 20, 0.82);
      }

      .seat-card.is-viewer {
        border-color: rgba(245, 180, 95, 0.42);
        box-shadow: inset 0 0 0 1px rgba(245, 180, 95, 0.16);
      }

      .seat-card.is-empty {
        border-style: dashed;
        background: rgba(255, 255, 255, 0.03);
      }

      .seat-card.is-dead {
        color: rgba(245, 247, 251, 0.78);
        background: linear-gradient(
          34deg,
          transparent 45.2%,
          rgba(255, 58, 58, 0.08) 47.2%,
          rgba(255, 58, 58, 0.82) 49.1%,
          rgba(255, 46, 46, 0.94) 50%,
          rgba(255, 58, 58, 0.82) 50.9%,
          rgba(255, 58, 58, 0.08) 52.8%,
          transparent 54.8%
        ),
        linear-gradient(
          -31deg,
          transparent 45.5%,
          rgba(255, 58, 58, 0.08) 47.4%,
          rgba(255, 58, 58, 0.78) 49.2%,
          rgba(255, 46, 46, 0.9) 50%,
          rgba(255, 58, 58, 0.78) 50.8%,
          rgba(255, 58, 58, 0.08) 52.6%,
          transparent 54.5%
        ),
        linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03)),
        rgba(18, 18, 20, 0.82);
      }

      .seat-head {
        position: absolute;
        inset: 0;
        z-index: 3;
      }

      .seat-index {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: absolute;
        left: 8px;
        top: -11px;
        min-width: 28px;
        min-height: 28px;
        padding: 0 9px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(38, 49, 71, 0.92);
        color: #c7d4e7;
        font-size: 0.7rem;
        font-weight: 700;
        line-height: 1;
        z-index: 4;
      }

      .seat-flags {
        position: absolute;
        top: 8px;
        right: 8px;
        display: inline-flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 4px;
        max-width: calc(100% - 44px);
      }

      .seat-flag {
        display: inline-flex;
        align-items: center;
        min-height: 18px;
        padding: 0 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--muted);
        font-size: 0.62rem;
        font-weight: 700;
      }

      .seat-flag--accent {
        background: rgba(245, 180, 95, 0.16);
        color: #ffd7ab;
      }

      .seat-name {
        position: relative;
        z-index: 3;
        width: 100%;
        padding: 0 2px 1px;
        font-size: 0.7rem;
        font-weight: 800;
        line-height: 1.12;
        word-break: keep-all;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 4;
        overflow: hidden;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.28);
      }

      .mini-card {
        padding: 12px 14px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 18px;
        background: var(--panel-soft);
      }

      .mini-card strong {
        display: block;
        margin-bottom: 6px;
        color: var(--accent);
        font-size: 0.84rem;
        letter-spacing: 0.03em;
      }

      .chat-shell {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 12px;
        height: 420px;
      }

      .chat-row {
        display: flex;
        align-items: flex-end;
        gap: 9px;
      }

      .chat-row--mine {
        justify-content: flex-end;
      }

      .chat-row--system {
        justify-content: center;
      }

      .chat-avatar {
        flex: 0 0 34px;
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        color: #dfe8f7;
        font-size: 0.78rem;
        font-weight: 800;
      }

      .chat-stack {
        display: grid;
        gap: 4px;
        max-width: min(78%, 480px);
      }

      .chat-stack--mine {
        justify-items: end;
      }

      .chat-author {
        font-size: 0.75rem;
        line-height: 1.2;
        padding: 0 2px;
      }

      .chat-bubble {
        padding: 11px 13px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 19px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--text);
        line-height: 1.45;
        word-break: break-word;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);
      }

      .chat-bubble--other {
        border-bottom-left-radius: 8px;
      }

      .chat-bubble--mine {
        border-color: rgba(255, 201, 141, 0.18);
        border-bottom-right-radius: 8px;
        background: linear-gradient(145deg, #ffbe73, #ff9850);
        color: #17120b;
      }

      .chat-bubble--system {
        max-width: min(92%, 520px);
        padding: 8px 12px;
        border-color: rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.07);
        color: #d4deed;
        font-size: 0.78rem;
        line-height: 1.35;
        text-align: center;
        box-shadow: none;
      }

      .chat-meta,
      .muted {
        color: var(--muted);
        font-size: 0.84rem;
        line-height: 1.4;
      }

      .chat-meta {
        padding: 0 2px;
        font-size: 0.72rem;
        line-height: 1.2;
      }

      .action-form,
      .chat-form {
        display: grid;
        gap: 10px;
      }

      .chat-form {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
      }

      .button-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 10px;
      }

      select,
      input,
      button {
        font: inherit;
      }

      select,
      input {
        width: 100%;
        min-height: 48px;
        padding: 12px 14px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 15px;
        background: rgba(17, 17, 19, 0.88);
        color: var(--text);
      }

      button {
        width: 100%;
        min-height: 48px;
        padding: 12px 14px;
        border: 0;
        border-radius: 15px;
        background: linear-gradient(145deg, var(--accent), var(--accent-strong));
        color: #101010;
        cursor: pointer;
        font-weight: 800;
        touch-action: manipulation;
      }

      button.secondary {
        background: rgba(255, 255, 255, 0.12);
        color: var(--text);
      }

      button[disabled] {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .chat-form input {
        min-height: 52px;
        border-radius: 18px;
        background: rgba(17, 17, 19, 0.94);
      }

      .chat-form button {
        width: auto;
        min-width: 84px;
        min-height: 52px;
        padding-inline: 18px;
        border-radius: 18px;
      }

      .notice {
        padding: 12px 14px;
        border: 1px solid rgba(255, 113, 113, 0.16);
        border-radius: 16px;
        background: rgba(255, 113, 113, 0.12);
        color: #ffd7d7;
      }

      .success {
        background: rgba(117, 209, 162, 0.12);
        color: #dfffee;
      }

      .footer {
        margin-top: 10px;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.4;
      }

      .split-list {
        display: grid;
        gap: 12px;
      }

      .mobile-dock {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom));
        z-index: 40;
        max-width: 980px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 22px;
        background: rgba(11, 11, 12, 0.95);
        backdrop-filter: blur(18px);
        box-shadow: var(--dock-shadow);
      }

      .dock-button {
        position: relative;
        min-height: 54px;
        padding: 10px 6px;
        border: 0;
        border-radius: 16px;
        background: transparent;
        color: var(--muted);
      }

      .dock-button strong {
        display: block;
        font-size: 0.8rem;
      }

      .dock-badge {
        position: absolute;
        top: 6px;
        right: 6px;
        min-width: 18px;
        padding: 2px 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        color: var(--text);
        font-size: 0.72rem;
        line-height: 1.2;
      }

      .dock-button.is-active {
        background: linear-gradient(145deg, var(--accent), var(--accent-strong));
        color: #101010;
      }

      .span-4 { grid-column: span 4; }
      .span-5 { grid-column: span 5; }
      .span-6 { grid-column: span 6; }
      .span-7 { grid-column: span 7; }
      .span-8 { grid-column: span 8; }
      .span-12 { grid-column: span 12; }

      @media (min-width: 960px) {
        .shell {
          width: min(1280px, calc(100vw - 44px));
          padding: 22px 20px 36px;
        }

        .hero {
          gap: 14px;
          padding: 18px 20px;
        }

        .hero-top {
          align-items: center;
        }

        .dashboard-grid {
          display: grid;
          gap: 16px;
          grid-template-columns: repeat(12, minmax(0, 1fr));
        }

        .section-panel {
          display: block;
          margin-bottom: 0;
        }

        .panel-head {
          padding: 20px 20px 12px;
        }

        .panel-body {
          padding: 0 20px 20px;
        }

        .line-list,
        .chat-shell {
          height: 500px;
        }

        .action-form,
        .chat-form {
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: start;
        }

        .action-form button,
        .chat-form button {
          width: auto;
          min-width: 112px;
        }

        .button-row {
          display: flex;
          flex-wrap: wrap;
        }

        .button-row button {
          width: auto;
          min-width: 124px;
        }

        .split-list {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .mobile-dock {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="hero">
        <div class="hero-top">
          <div class="hero-copy">
            <h1 id="hero-title"></h1>
            <p id="hero-subtitle"></p>
          </div>
          <div class="hero-meta" id="hero-meta"></div>
        </div>
      </header>
      <div id="app"></div>
      <div id="mobile-dock-root"></div>
    </div>
    <script id="initial-state" type="application/json">${stateJson}</script>
    <script>
      const initialState = JSON.parse(document.getElementById("initial-state").textContent);
      const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
      const dockSections = [
        { id: "state", label: "상태" },
        { id: "public", label: "공개" },
        { id: "actions", label: "행동" },
        { id: "secret", label: "비밀" },
        { id: "logs", label: "로그" },
      ];
      let currentState = initialState;
      let sinceVersion = initialState.version;
      let pollTimer = null;
      let deadlineTimer = null;
      let syncedServerNowMs = initialState.serverNow;
      let syncedClientPerfMs = performance.now();
      let activeSection = "actions";
      const chatDrafts = Object.create(null);

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function formatClock(timestamp) {
        if (!timestamp) {
          return "없음";
        }
        return new Date(timestamp).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }

      function formatDeadline(timestamp) {
        if (!timestamp) {
          return "마감 없음";
        }
        const remaining = Math.max(0, timestamp - estimateServerNow());
        return \`\${Math.ceil(remaining / 1000)}초 남음\`;
      }

      function estimateServerNow() {
        return syncedServerNowMs + (performance.now() - syncedClientPerfMs);
      }

      function syncServerClock(serverNow) {
        if (typeof serverNow === "number") {
          syncedServerNowMs = serverNow;
          syncedClientPerfMs = performance.now();
        }
      }

      function updateDeadlineDisplays() {
        const text = formatDeadline(currentState.room.deadlineAt);
        document.querySelectorAll("[data-live-deadline]").forEach((node) => {
          node.textContent = text;
        });
      }

      function scrollChatListsToBottom() {
        document.querySelectorAll(".chat-list").forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          node.scrollTop = node.scrollHeight;
          const last = node.lastElementChild;
          if (last instanceof HTMLElement) {
            last.scrollIntoView({ block: "end", inline: "nearest" });
          }
        });
      }

      function queueChatAutoscroll() {
        requestAnimationFrame(() => {
          scrollChatListsToBottom();
          setTimeout(scrollChatListsToBottom, 40);
        });
      }

      function captureChatDraftState() {
        let focused = null;
        document.querySelectorAll(".chat-form").forEach((form) => {
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          const input = form.elements.namedItem("content");
          if (!(input instanceof HTMLInputElement)) {
            return;
          }

          const channel = form.dataset.channel;
          if (!channel) {
            return;
          }

          if (input.value) {
            chatDrafts[channel] = input.value;
          } else {
            delete chatDrafts[channel];
          }

          if (document.activeElement === input) {
            focused = {
              channel,
              start: input.selectionStart ?? input.value.length,
              end: input.selectionEnd ?? input.value.length,
            };
          }
        });
        return focused;
      }

      function restoreChatDraftState(focused) {
        document.querySelectorAll(".chat-form").forEach((form) => {
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          const input = form.elements.namedItem("content");
          if (!(input instanceof HTMLInputElement)) {
            return;
          }

          const channel = form.dataset.channel;
          if (!channel) {
            return;
          }

          input.value = typeof chatDrafts[channel] === "string" ? chatDrafts[channel] : "";

          if (focused && focused.channel === channel) {
            input.focus({ preventScroll: true });
            const end = Math.min(focused.end, input.value.length);
            const start = Math.min(focused.start, end);
            input.setSelectionRange(start, end);
          }
        });
      }

      function teamClass(state) {
        return state.viewer.teamLabel === "마피아팀" ? "mafia" : "citizen";
      }

      function actionableControlCount(state) {
        return state.actions.controls.filter((control) => control.actionType !== "noop").length;
      }

      function pickDefaultSection(state) {
        if (actionableControlCount(state) > 0) {
          return "actions";
        }
        if (state.publicChat.canWrite) {
          return "public";
        }
        if (state.secretChats.length > 0) {
          return "secret";
        }
        return "state";
      }

      function ensureActiveSection(state) {
        const valid = dockSections.map((section) => section.id);
        if (!valid.includes(activeSection)) {
          activeSection = pickDefaultSection(state);
        }
      }

      function nicknameClassForUser(state, userId) {
        if (!userId) {
          return "nick-color-7";
        }

        const occupiedSeats = state.room.seats.filter((seat) => !seat.empty);
        const seatIndex = occupiedSeats.findIndex((seat) => seat.userId === userId);
        if (seatIndex >= 0) {
          return \`nick-color-\${(seatIndex % 8) + 1}\`;
        }

        let hash = 0;
        for (const char of String(userId)) {
          hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        }
        return \`nick-color-\${(hash % 8) + 1}\`;
      }

      function renderHero(state) {
        const team = teamClass(state);
        const heroTitle = document.getElementById("hero-title");
        heroTitle.textContent = state.viewer.displayName;
        heroTitle.className = nicknameClassForUser(state, state.viewer.userId);
        document.getElementById("hero-subtitle").textContent = \`게임 ID \${state.room.gameId}\`;
        document.getElementById("hero-meta").innerHTML = [
          \`<div class="meta-chip role-chip role-chip--\${team}"><strong>\${escapeHtml(state.viewer.roleLabel)}</strong></div>\`,
          \`<div class="meta-chip"><strong data-live-deadline>\${escapeHtml(formatDeadline(state.room.deadlineAt))}</strong></div>\`,
        ].join("");
      }

      function renderMobileDock(state) {
        const counts = {
          state: "",
          public: state.publicChat.messages.length > 0 ? String(state.publicChat.messages.length) : "",
          actions: actionableControlCount(state) > 0 ? String(actionableControlCount(state)) : "",
          secret: state.secretChats.length > 0 ? String(state.secretChats.length) : "",
          logs: state.systemLog.privateLines.length > 0 ? String(state.systemLog.privateLines.length) : "",
        };

        document.getElementById("mobile-dock-root").innerHTML = \`
          <nav class="mobile-dock">
            \${dockSections
              .map((section) => \`
                <button
                  type="button"
                  class="dock-button\${activeSection === section.id ? " is-active" : ""}"
                  data-nav-section="\${section.id}"
                >
                  <strong>\${section.label}</strong>
                  \${counts[section.id] ? \`<span class="dock-badge">\${escapeHtml(counts[section.id])}</span>\` : ""}
                </button>
              \`)
              .join("")}
          </nav>
        \`;
      }

      function actionControl(control) {
        if (control.type === "info") {
          return \`<div class="control"><strong>\${escapeHtml(control.title)}</strong><div class="muted">\${escapeHtml(control.description)}</div></div>\`;
        }

        if (control.type === "button") {
          return \`
            <div class="control">
              <strong>\${escapeHtml(control.title)}</strong>
              <div class="muted">\${escapeHtml(control.description)}</div>
              <div class="button-row">
                <button type="button" data-action-type="\${escapeHtml(control.actionType)}">\${escapeHtml(control.title)}</button>
              </div>
            </div>
          \`;
        }

        if (control.type === "buttons") {
          const buttons = (control.buttons || [])
            .map(
              (button) =>
                \`<button type="button" data-action-type="\${escapeHtml(control.actionType)}" data-value="\${escapeHtml(button.value)}">\${escapeHtml(button.label)}</button>\`,
            )
            .join("");
          const current = control.currentLabel ? \`<div class="footer">현재 선택: \${escapeHtml(control.currentLabel)}</div>\` : "";
          return \`
            <div class="control">
              <strong>\${escapeHtml(control.title)}</strong>
              <div class="muted">\${escapeHtml(control.description)}</div>
              <div class="button-row">\${buttons}</div>
              \${current}
            </div>
          \`;
        }

        const options = (control.options || [])
          .map((option) => \`<option value="\${escapeHtml(option.value)}">\${escapeHtml(option.label)}</option>\`)
          .join("");
        const current = control.currentLabel ? \`<div class="footer">현재 선택: \${escapeHtml(control.currentLabel)}</div>\` : "";
        return \`
          <div class="control">
            <strong>\${escapeHtml(control.title)}</strong>
            <div class="muted">\${escapeHtml(control.description)}</div>
            <form class="action-form" data-action-type="\${escapeHtml(control.actionType)}" data-action="\${escapeHtml(control.action || "")}">
              <select name="targetId" required>
                <option value="">대상을 선택하세요</option>
                \${options}
              </select>
              <button type="submit">제출</button>
            </form>
            \${current}
          </div>
        \`;
      }

      function displayAuthorName(viewerId, message) {
        return message.authorId === viewerId ? "나" : message.authorName;
      }

      function authorInitial(name) {
        const trimmed = String(name || "").trim();
        return trimmed ? trimmed.slice(0, 1) : "?";
      }

      function chatMessage(state, viewerId, message) {
        if (message.kind === "system") {
          return \`
            <div class="chat-row chat-row--system">
              <div class="chat-bubble chat-bubble--system">\${escapeHtml(message.content)}</div>
            </div>
          \`;
        }

        const mine = message.authorId === viewerId;
        const rowClass = mine ? "chat-row chat-row--mine" : "chat-row";
        const stackClass = mine ? "chat-stack chat-stack--mine" : "chat-stack";
        const bubbleClass = mine ? "chat-bubble chat-bubble--mine" : "chat-bubble chat-bubble--other";
        const nickClass = nicknameClassForUser(state, message.authorId);
        const avatar = mine ? "" : \`<div class="chat-avatar \${nickClass}">\${escapeHtml(authorInitial(message.authorName))}</div>\`;

        return \`
          <div class="\${rowClass}">
            \${avatar}
            <div class="\${stackClass}">
              <div class="chat-author \${nickClass}">\${escapeHtml(displayAuthorName(viewerId, message))}</div>
              <div class="\${bubbleClass}">\${escapeHtml(message.content)}</div>
              <div class="chat-meta">\${formatClock(message.createdAt)}</div>
            </div>
          </div>
        \`;
      }

      function chatSection(state, viewerId, chat, withHeading) {
        const messages =
          chat.messages.length > 0
            ? chat.messages
                .map((message) => chatMessage(state, viewerId, message))
                .join("")
            : '<div class="line-item muted">아직 메시지가 없습니다.</div>';

        const form = chat.canWrite
          ? \`
              <form class="chat-form" data-channel="\${escapeHtml(chat.channel)}">
                <input name="content" maxlength="500" placeholder="\${escapeHtml(chat.title)} 메시지 입력" />
                <button type="submit">전송</button>
              </form>
            \`
          : '<div class="footer">현재 이 채널에 쓸 수 없습니다.</div>';

        const heading = withHeading
          ? \`
              <div class="panel-head">
                <div>
                  <h3>\${escapeHtml(chat.title)}</h3>
                </div>
              </div>
            \`
          : "";

        return \`
          <div class="\${withHeading ? "secret-chat" : ""}">
            \${heading}
            <div class="chat-shell">
              <div class="chat-list" data-channel="\${escapeHtml(chat.channel)}">\${messages}</div>
              <div class="footer">\${form}</div>
            </div>
          </div>
        \`;
      }

      function sectionClass(sectionId) {
        return \`panel section-panel \${sectionId === activeSection ? "is-active" : ""}\`;
      }

      function seatCard(state, seat) {
        if (seat.empty) {
          return \`
            <div class="seat-card is-empty">
              <div class="seat-head">
                <span class="seat-index">\${seat.seat}</span>
              </div>
              <div class="seat-name muted">빈 자리</div>
            </div>
          \`;
        }

        const flags = [];
        if (seat.isViewer) {
          flags.push('<span class="seat-flag seat-flag--accent">나</span>');
        }
        if (seat.bullied) {
          flags.push('<span class="seat-flag">협박</span>');
        }
        if (seat.ascended) {
          flags.push('<span class="seat-flag">성불</span>');
        }

        const classes = ["seat-card"];
        if (seat.isViewer) {
          classes.push("is-viewer");
        }
        if (!seat.alive) {
          classes.push("is-dead");
        }
        const nickClass = nicknameClassForUser(state, seat.userId);

        return \`
          <div class="\${classes.join(" ")}">
            <div class="seat-head">
              <span class="seat-index">\${seat.seat}</span>
              <div class="seat-flags">\${flags.join("")}</div>
            </div>
            <div class="seat-name \${nickClass}">\${escapeHtml(seat.displayName)}</div>
          </div>
        \`;
      }

      function render(state) {
        const focusedChat = captureChatDraftState();
        ensureActiveSection(state);
        renderHero(state);
        renderMobileDock(state);

        const team = teamClass(state);
        const notices = state.actions.notices.map((notice) => \`<div class="notice">\${escapeHtml(notice)}</div>\`).join("");
        const controls = state.actions.controls.map(actionControl).join("");
        const publicLines =
          state.publicLines.length > 0
            ? state.publicLines
                .map((line) => \`<div class="line-item"><strong>공개 결과</strong><div>\${escapeHtml(line)}</div></div>\`)
                .join("")
            : '<div class="line-item muted">최근 공개 결과가 없습니다.</div>';
        const privateLines =
          state.systemLog.privateLines.length > 0
            ? state.systemLog.privateLines
                .map(
                  (line) =>
                    \`<div class="line-item success"><strong>\${formatClock(line.createdAt)}</strong><div>\${escapeHtml(line.line)}</div></div>\`,
                )
                .join("")
            : '<div class="line-item muted">개인 결과가 아직 없습니다.</div>';
        const secretChats =
          state.secretChats.length > 0
            ? state.secretChats.map((chat) => chatSection(state, state.viewer.userId, chat, true)).join("")
            : '<div class="line-item muted">현재 접근 가능한 비밀 채팅이 없습니다.</div>';

        document.getElementById("app").innerHTML = \`
          <div class="dashboard-grid">
            <section class="\${sectionClass("state")} span-4" data-section="state">
              <div class="panel-head">
                <div>
                  <h2>현재 상태</h2>
                </div>
              </div>
              <div class="panel-body viewer-stack">
                <div class="viewer-card viewer-card--\${team}">
                  <strong>내 정보</strong>
                  <div>직업: \${escapeHtml(state.viewer.roleLabel)}</div>
                  <div class="muted" style="margin-top: 8px;">\${escapeHtml(state.viewer.roleSummary)}</div>
                  \${state.viewer.loverName ? \`<div class="footer">연인: \${escapeHtml(state.viewer.loverName)}</div>\` : ""}
                  \${state.viewer.deadReason ? \`<div class="footer">사망 사유: \${escapeHtml(state.viewer.deadReason)}</div>\` : ""}
                  \${state.viewer.ascended ? '<div class="footer">성불 상태</div>' : ""}
                </div>
                <div class="mini-grid">
                  <div class="mini-card">
                    <strong>남은 시간</strong>
                    <div data-live-deadline>\${escapeHtml(formatDeadline(state.room.deadlineAt))}</div>
                  </div>
                  <div class="mini-card">
                    <strong>행동</strong>
                    <div>\${actionableControlCount(state)}개 가능</div>
                  </div>
                </div>
                <div class="seat-grid">\${state.room.seats.map((seat) => seatCard(state, seat)).join("")}</div>
                \${state.room.currentTrialTargetName ? \`<div class="line-item"><strong>현재 대상</strong><div>\${escapeHtml(state.room.currentTrialTargetName)}</div></div>\` : ""}
              </div>
            </section>

            <section class="\${sectionClass("public")} span-8" data-section="public">
              <div class="panel-head">
                <div>
                  <h2>공개 채팅</h2>
                </div>
              </div>
              <div class="panel-body">\${chatSection(state, state.viewer.userId, state.publicChat, false)}</div>
            </section>

            <section class="\${sectionClass("actions")} span-5" data-section="actions">
              <div class="panel-head">
                <div>
                  <h2>개인 행동</h2>
                </div>
              </div>
              <div class="panel-body">
                <div class="control-list">\${notices}\${controls}</div>
              </div>
            </section>

            <section class="\${sectionClass("secret")} span-7" data-section="secret">
              <div class="panel-head">
                <div>
                  <h2>비밀 채팅</h2>
                </div>
              </div>
              <div class="panel-body secret-stack">\${secretChats}</div>
            </section>

            <section class="\${sectionClass("logs")} span-12" data-section="logs">
              <div class="panel-head">
                <div>
                  <h2>시스템 로그 / 결과</h2>
                </div>
              </div>
              <div class="panel-body">
                <div class="split-list">
                  <div class="line-list">\${publicLines}</div>
                  <div class="line-list">\${privateLines}</div>
                </div>
              </div>
            </section>
          </div>
        \`;
        restoreChatDraftState(focusedChat);
        updateDeadlineDisplays();
        scheduleDeadlineTicker();
        queueChatAutoscroll();
      }

      async function refreshState() {
        try {
          const response = await fetch(\`/api/game/\${encodeURIComponent(currentState.room.gameId)}/state?sinceVersion=\${encodeURIComponent(String(sinceVersion))}\`, {
            credentials: "same-origin",
            cache: "no-store",
          });

          if (response.status === 401) {
            window.location.reload();
            return;
          }

          const payload = await response.json();
          syncServerClock(payload.serverNow);
          if (payload.changed && payload.state) {
            currentState = payload.state;
            sinceVersion = payload.version;
            render(currentState);
          } else {
            sinceVersion = payload.version;
            scheduleDeadlineTicker();
          }
        } catch (error) {
          console.error(error);
        }
      }

      async function postJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({ error: "요청 실패" }));
          throw new Error(payload.error || "요청 실패");
        }
      }

      document.addEventListener("submit", async (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) {
          return;
        }

        event.preventDefault();

        try {
          if (form.classList.contains("action-form")) {
            const data = new FormData(form);
            await postJson(\`/api/game/\${encodeURIComponent(currentState.room.gameId)}/actions\`, {
              actionType: form.dataset.actionType,
              action: form.dataset.action || undefined,
              targetId: data.get("targetId"),
            });
            await refreshState();
          }

          if (form.classList.contains("chat-form")) {
            const data = new FormData(form);
            const channel = form.dataset.channel;
            await postJson(\`/api/game/\${encodeURIComponent(currentState.room.gameId)}/chats/\${encodeURIComponent(form.dataset.channel)}\`, {
              content: data.get("content"),
            });
            form.reset();
            if (channel) {
              delete chatDrafts[channel];
            }
            await refreshState();
          }
        } catch (error) {
          alert(error.message || "요청 실패");
        }
      });

      document.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.name !== "content") {
          return;
        }

        const form = target.form;
        if (!(form instanceof HTMLFormElement) || !form.classList.contains("chat-form")) {
          return;
        }

        const channel = form.dataset.channel;
        if (!channel) {
          return;
        }

        if (target.value) {
          chatDrafts[channel] = target.value;
        } else {
          delete chatDrafts[channel];
        }
      });

      document.addEventListener("click", async (event) => {
        const button = event.target;
        if (!(button instanceof HTMLButtonElement)) {
          return;
        }

        const navSection = button.dataset.navSection;
        if (navSection) {
          activeSection = navSection;
          render(currentState);
          queueChatAutoscroll();
          return;
        }

        const actionType = button.dataset.actionType;
        if (!actionType || button.type === "submit") {
          return;
        }

        try {
          await postJson(\`/api/game/\${encodeURIComponent(currentState.room.gameId)}/actions\`, {
            actionType,
            value: button.dataset.value || undefined,
          });
          await refreshState();
        } catch (error) {
          alert(error.message || "요청 실패");
        }
      });

      function schedulePolling() {
        if (pollTimer) {
          clearInterval(pollTimer);
        }

        const intervalMs = document.hidden ? 7000 : 2000;
        pollTimer = setInterval(refreshState, intervalMs);
      }

      function scheduleDeadlineTicker() {
        if (deadlineTimer) {
          clearTimeout(deadlineTimer);
          deadlineTimer = null;
        }

        updateDeadlineDisplays();

        const deadlineAt = currentState.room.deadlineAt;
        if (!deadlineAt) {
          return;
        }

        const remaining = Math.max(0, deadlineAt - estimateServerNow());
        if (remaining <= 0) {
          return;
        }

        const untilNextSecond = remaining % 1000 || 1000;
        deadlineTimer = setTimeout(scheduleDeadlineTicker, Math.max(40, untilNextSecond + 12));
      }

      document.addEventListener("visibilitychange", schedulePolling);

      activeSection = pickDefaultSection(currentState);
      syncServerClock(initialState.serverNow);
      render(currentState);
      schedulePolling();
      scheduleDeadlineTicker();
    </script>
  </body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
