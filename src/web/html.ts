import { DashboardStatePayload } from "./presenter";

export function renderDashboardPage(initialState: DashboardStatePayload, csrfToken: string): string {
  const stateJson = JSON.stringify(initialState).replace(/</g, "\\u003c");
  const safeCsrf = escapeAttribute(csrfToken);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="csrf-token" content="${safeCsrf}" />
    <title>Discord Mafia Dashboard</title>
    <style>
      :root {
        --bg: #0d1321;
        --bg-soft: #182237;
        --panel: rgba(255, 255, 255, 0.08);
        --panel-strong: rgba(255, 255, 255, 0.13);
        --border: rgba(255, 255, 255, 0.12);
        --text: #f4f7fb;
        --muted: #b8c4d8;
        --accent: #f7b267;
        --accent-strong: #ff8c42;
        --danger: #ff6b6b;
        --ok: #75d0a2;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(247, 178, 103, 0.18), transparent 36%),
          radial-gradient(circle at bottom right, rgba(117, 208, 162, 0.14), transparent 32%),
          linear-gradient(140deg, #09101d 0%, #0d1321 55%, #11192b 100%);
        color: var(--text);
        font-family: "Segoe UI Variable", "Noto Sans KR", "Malgun Gothic", sans-serif;
      }

      .shell {
        width: min(1440px, calc(100vw - 24px));
        margin: 0 auto;
        padding: 20px 0 32px;
      }

      .hero {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
        padding: 18px 22px;
        border: 1px solid var(--border);
        border-radius: 24px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.04));
        box-shadow: var(--shadow);
      }

      .hero h1 {
        margin: 0;
        font-size: clamp(1.5rem, 2vw, 2.2rem);
        letter-spacing: 0.02em;
      }

      .hero p {
        margin: 8px 0 0;
        color: var(--muted);
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--muted);
        font-size: 0.92rem;
      }

      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(12, minmax(0, 1fr));
      }

      .panel {
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--panel);
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .panel-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 18px 20px 12px;
      }

      .panel-head h2,
      .panel-head h3 {
        margin: 0;
        font-size: 1rem;
      }

      .panel-head p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 0.92rem;
      }

      .panel-body {
        padding: 0 20px 20px;
      }

      .span-4 { grid-column: span 4; }
      .span-5 { grid-column: span 5; }
      .span-6 { grid-column: span 6; }
      .span-7 { grid-column: span 7; }
      .span-8 { grid-column: span 8; }
      .span-12 { grid-column: span 12; }

      .stat-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .stat {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.05);
      }

      .stat strong {
        display: block;
        margin-bottom: 6px;
        color: var(--accent);
      }

      .card-list,
      .line-list,
      .chat-list,
      .control-list {
        display: grid;
        gap: 12px;
      }

      .line-list,
      .chat-list {
        max-height: 320px;
        overflow: auto;
        padding-right: 4px;
      }

      .chat-message,
      .line-item,
      .control,
      .secret-chat,
      .viewer-card {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.05);
      }

      .chat-message strong,
      .line-item strong {
        display: block;
        margin-bottom: 6px;
      }

      .chat-meta,
      .muted {
        color: var(--muted);
        font-size: 0.88rem;
      }

      form,
      .button-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      select,
      input,
      button,
      textarea {
        font: inherit;
      }

      select,
      input,
      textarea {
        width: 100%;
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(6, 11, 20, 0.46);
        color: var(--text);
      }

      button {
        padding: 10px 14px;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #111;
        cursor: pointer;
        font-weight: 700;
      }

      button.secondary {
        background: rgba(255, 255, 255, 0.12);
        color: var(--text);
      }

      button[disabled] {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .notice {
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255, 107, 107, 0.13);
        color: #ffd1d1;
      }

      .success {
        background: rgba(117, 208, 162, 0.12);
        color: #d8ffeb;
      }

      .footer {
        margin-top: 14px;
        color: var(--muted);
        font-size: 0.88rem;
      }

      @media (max-width: 1080px) {
        .span-4,
        .span-5,
        .span-6,
        .span-7,
        .span-8 {
          grid-column: span 12;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <div>
          <div class="pill">게임 ID <span id="hero-game-id"></span></div>
          <h1 id="hero-title"></h1>
          <p id="hero-subtitle"></p>
        </div>
        <div class="pill">Polling <span id="polling-status">2초</span></div>
      </div>
      <div id="app"></div>
    </div>
    <script id="initial-state" type="application/json">${stateJson}</script>
    <script>
      const initialState = JSON.parse(document.getElementById("initial-state").textContent);
      const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
      let currentState = initialState;
      let sinceVersion = initialState.version;
      let pollTimer = null;

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
        return new Date(timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }

      function formatDeadline(timestamp) {
        if (!timestamp) {
          return "마감 없음";
        }
        const remaining = Math.max(0, timestamp - Date.now());
        return \`\${Math.ceil(remaining / 1000)}초 남음 (\${formatClock(timestamp)})\`;
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
              <div class="button-row" style="margin-top:10px;">
                <button type="button" data-action-type="\${escapeHtml(control.actionType)}">\${escapeHtml(control.title)}</button>
              </div>
            </div>
          \`;
        }

        if (control.type === "buttons") {
          const buttons = (control.buttons || []).map((button) => (
            \`<button type="button" data-action-type="\${escapeHtml(control.actionType)}" data-value="\${escapeHtml(button.value)}">\${escapeHtml(button.label)}</button>\`
          )).join("");
          const current = control.currentLabel ? \`<div class="footer">현재 선택: \${escapeHtml(control.currentLabel)}</div>\` : "";
          return \`
            <div class="control">
              <strong>\${escapeHtml(control.title)}</strong>
              <div class="muted">\${escapeHtml(control.description)}</div>
              <div class="button-row" style="margin-top:10px;">\${buttons}</div>
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
              <select name="targetId" required style="margin-top:10px;">
                <option value="">대상을 선택하세요</option>
                \${options}
              </select>
              <button type="submit">제출</button>
            </form>
            \${current}
          </div>
        \`;
      }

      function chatSection(chat, allowHeading) {
        const messages = chat.messages.length > 0
          ? chat.messages.map((message) => \`
              <div class="chat-message">
                <strong>\${escapeHtml(message.authorName)}</strong>
                <div>\${escapeHtml(message.content)}</div>
                <div class="chat-meta">\${formatClock(message.createdAt)}</div>
              </div>
            \`).join("")
          : '<div class="line-item muted">아직 메시지가 없습니다.</div>';
        const form = chat.canWrite
          ? \`
              <form class="chat-form" data-channel="\${escapeHtml(chat.channel)}">
                <input name="content" maxlength="500" placeholder="\${escapeHtml(chat.title)} 메시지 입력" />
                <button type="submit">전송</button>
              </form>
            \`
          : '<div class="footer">현재 이 채널에 쓸 수 없습니다.</div>';
        const heading = allowHeading ? \`<div class="panel-head"><div><h3>\${escapeHtml(chat.title)}</h3></div></div>\` : "";
        return \`
          <div class="\${allowHeading ? "secret-chat" : ""}">
            \${heading}
            <div class="chat-list">\${messages}</div>
            <div style="margin-top:12px;">\${form}</div>
          </div>
        \`;
      }

      function render(state) {
        document.getElementById("hero-game-id").textContent = state.room.gameId;
        document.getElementById("hero-title").textContent = \`\${state.room.phaseLabel} · \${state.room.rulesetLabel}\`;
        document.getElementById("hero-subtitle").textContent = \`\${state.viewer.displayName} / \${state.viewer.roleLabel} / \${state.viewer.teamLabel}\`;

        const notices = state.actions.notices.map((notice) => \`<div class="notice">\${escapeHtml(notice)}</div>\`).join("");
        const controls = state.actions.controls.map(actionControl).join("");
        const publicLines = state.publicLines.length > 0
          ? state.publicLines.map((line) => \`<div class="line-item"><strong>공개 결과</strong><div>\${escapeHtml(line)}</div></div>\`).join("")
          : '<div class="line-item muted">최근 공개 결과가 없습니다.</div>';
        const privateLines = state.systemLog.privateLines.length > 0
          ? state.systemLog.privateLines.map((line) => \`<div class="line-item success"><strong>\${formatClock(line.createdAt)}</strong><div>\${escapeHtml(line.line)}</div></div>\`).join("")
          : '<div class="line-item muted">개인 결과가 아직 없습니다.</div>';
        const secretChats = state.secretChats.length > 0
          ? state.secretChats.map((chat) => chatSection(chat, true)).join("")
          : '<div class="line-item muted">현재 접근 가능한 비밀 채팅이 없습니다.</div>';

        document.getElementById("app").innerHTML = \`
          <div class="grid">
            <section class="panel span-4">
              <div class="panel-head">
                <div>
                  <h2>공개 게임 상태</h2>
                  <p>\${escapeHtml(state.room.phaseLabel)} / 마감 \${escapeHtml(formatDeadline(state.room.deadlineAt))}</p>
                </div>
              </div>
              <div class="panel-body card-list">
                <div class="viewer-card">
                  <strong>내 정보</strong>
                  <div>직업: \${escapeHtml(state.viewer.roleLabel)}</div>
                  <div>팀: \${escapeHtml(state.viewer.teamLabel)}</div>
                  <div class="muted" style="margin-top:6px;">\${escapeHtml(state.viewer.roleSummary)}</div>
                  \${state.viewer.loverName ? \`<div class="footer">연인: \${escapeHtml(state.viewer.loverName)}</div>\` : ""}
                  \${state.viewer.contacted ? '<div class="footer">접선 상태</div>' : ""}
                  \${state.viewer.deadReason ? \`<div class="footer">사망 사유: \${escapeHtml(state.viewer.deadReason)}</div>\` : ""}
                </div>
                <div class="stat-grid">
                  <div class="stat"><strong>낮</strong><span>\${state.room.dayNumber}</span></div>
                  <div class="stat"><strong>밤</strong><span>\${state.room.nightNumber}</span></div>
                </div>
                <div class="line-item">
                  <strong>생존자</strong>
                  <div>\${state.room.alivePlayers.length > 0 ? state.room.alivePlayers.map((player) => escapeHtml(player.displayName + (player.bullied ? " (협박)" : ""))).join("<br/>") : "없음"}</div>
                </div>
                <div class="line-item">
                  <strong>사망자</strong>
                  <div>\${state.room.deadPlayers.length > 0 ? state.room.deadPlayers.map((player) => escapeHtml(player.displayName + (player.ascended ? " (성불)" : ""))).join("<br/>") : "없음"}</div>
                </div>
                \${state.room.currentTrialTargetName ? \`<div class="line-item"><strong>현재 대상</strong><div>\${escapeHtml(state.room.currentTrialTargetName)}</div></div>\` : ""}
              </div>
            </section>

            <section class="panel span-8">
              <div class="panel-head">
                <div>
                  <h2>공개 채팅</h2>
                  <p>생존자만 현재 허용된 단계에서 작성할 수 있습니다.</p>
                </div>
              </div>
              <div class="panel-body">\${chatSection(state.publicChat, false)}</div>
            </section>

            <section class="panel span-5">
              <div class="panel-head">
                <div>
                  <h2>개인 행동</h2>
                  <p>현재 세션 기준으로 허용된 행동만 표시됩니다.</p>
                </div>
              </div>
              <div class="panel-body">
                <div class="control-list">\${notices}\${controls}</div>
              </div>
            </section>

            <section class="panel span-7">
              <div class="panel-head">
                <div>
                  <h2>비밀 채팅</h2>
                  <p>역할과 생존 상태에 따라 접근이 달라집니다.</p>
                </div>
              </div>
              <div class="panel-body card-list">\${secretChats}</div>
            </section>

            <section class="panel span-12">
              <div class="panel-head">
                <div>
                  <h2>시스템 로그 / 결과</h2>
                  <p>공개 결과와 개인 결과를 분리해서 표시합니다.</p>
                </div>
              </div>
              <div class="panel-body">
                <div class="grid">
                  <div class="span-6"><div class="line-list">\${publicLines}</div></div>
                  <div class="span-6"><div class="line-list">\${privateLines}</div></div>
                </div>
              </div>
            </section>
          </div>
        \`;
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
          if (payload.changed && payload.state) {
            currentState = payload.state;
            sinceVersion = payload.version;
            render(currentState);
          } else {
            sinceVersion = payload.version;
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
            await postJson(\`/api/game/\${encodeURIComponent(currentState.room.gameId)}/chats/\${encodeURIComponent(form.dataset.channel)}\`, {
              content: data.get("content"),
            });
            form.reset();
            await refreshState();
          }
        } catch (error) {
          alert(error.message || "요청 실패");
        }
      });

      document.addEventListener("click", async (event) => {
        const button = event.target;
        if (!(button instanceof HTMLButtonElement)) {
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
        document.getElementById("polling-status").textContent = document.hidden ? "7초" : "2초";
        pollTimer = setInterval(refreshState, intervalMs);
      }

      document.addEventListener("visibilitychange", schedulePolling);

      render(currentState);
      schedulePolling();
    </script>
  </body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
