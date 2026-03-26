const initialState = JSON.parse(document.getElementById("initial-state").textContent);
      const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
      const dockSections = [
        { id: "state", label: "상태", icon: "👤" },
        { id: "actions", label: "행동", icon: "⚡" },
        { id: "public", label: "공개", icon: "💬" },
        { id: "secret", label: "비밀", icon: "🤫" },
        { id: "logs", label: "개인", icon: "🔒" },
      ];

      /* ── Memo / deduction note state ── */
      const memoStorageKey = "mafia_memos_" + initialState.room.gameId;
      const seatMemos = (() => {
        try {
          const raw = localStorage.getItem(memoStorageKey);
          return raw ? Object.assign(Object.create(null), JSON.parse(raw)) : Object.create(null);
        } catch { return Object.create(null); }
      })();
      function saveMemos() {
        try { localStorage.setItem(memoStorageKey, JSON.stringify(seatMemos)); } catch {}
      }
      let memoOverlayTarget = null;

      /* ── Toast notification ── */
      function showToast(message, type = "info") {
        const container = document.getElementById("toast-container");
        if (!container) return;
        const el = document.createElement("div");
        el.className = "toast-item toast-item--" + type;
        el.textContent = message;
        container.appendChild(el);
        el.addEventListener("animationend", (e) => {
          if (e.animationName === "toast-out") el.remove();
        });
        setTimeout(() => { if (el.parentNode) el.remove(); }, 3000);
      }

      const ROLE_ICONS = [
        { key: "mafia", label: "마피아", team: "mafia" },
        { key: "spy", label: "스파이", team: "mafia" },
        { key: "beastman", label: "짐승인간", team: "mafia" },
        { key: "hostess", label: "마담", team: "mafia" },
        { key: "police", label: "경찰", team: "citizen" },
        { key: "doctor", label: "의사", team: "citizen" },
        { key: "soldier", label: "군인", team: "citizen" },
        { key: "politician", label: "정치인", team: "citizen" },
        { key: "medium", label: "영매", team: "citizen" },
        { key: "lover", label: "연인", team: "citizen" },
        { key: "gangster", label: "건달", team: "citizen" },
        { key: "reporter", label: "기자", team: "citizen" },
        { key: "detective", label: "탐정", team: "citizen" },
        { key: "ghoul", label: "도굴꾼", team: "citizen" },
        { key: "terrorist", label: "테러리스트", team: "citizen" },
        { key: "priest", label: "성직자", team: "citizen" },
      ];

      function roleIconUrl(key) {
        return "/resource/roles/" + key + "_icon.png";
      }

      /* ── Advanced UI/UX: Audio Manager ── */
      const AudioManager = {
        ctx: null,
        buffers: {},
        bgmNode: null,
        currentBgmUrl: null,
        
        init() {
          if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
          }
          if (this.ctx.state === 'suspended') {
            this.ctx.resume();
          }
        },
        async load(url) {
          if (this.buffers[url]) return this.buffers[url];
          try {
            const res = await fetch(url, { cache: "force-cache" });
            const arrayBuffer = await res.arrayBuffer();
            if (!this.ctx) this.init();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.buffers[url] = audioBuffer;
            return audioBuffer;
          } catch(e) { return null; }
        },
        playSfx(url) {
          try {
            this.init();
            this.load(url).then(buf => {
              if (!buf) return;
              const source = this.ctx.createBufferSource();
              source.buffer = buf;
              const gain = this.ctx.createGain();
              gain.gain.value = 0.5;
              source.connect(gain);
              gain.connect(this.ctx.destination);
              source.start();
            });
          } catch(e) {}
        },
        playBgm(url) {
          if (this.currentBgmUrl === url) return;
          try {
            this.init();
            this.currentBgmUrl = url;
            this.load(url).then(buf => {
              if (!buf || this.currentBgmUrl !== url) return;
              
              const oldNode = this.bgmNode;
              
              const source = this.ctx.createBufferSource();
              source.buffer = buf;
              source.loop = true;
              
              const gain = this.ctx.createGain();
              gain.gain.value = 0.0;
              source.connect(gain);
              gain.connect(this.ctx.destination);
              source.start();
              
              // Crossfade
              const now = this.ctx.currentTime;
              gain.gain.linearRampToValueAtTime(0.4, now + 1.0);
              
              this.bgmNode = { source, gain };
              
              if (oldNode) {
                oldNode.gain.gain.linearRampToValueAtTime(0.0, now + 1.0);
                setTimeout(() => {
                  try { oldNode.source.stop(); } catch(e){}
                }, 1000);
              }
            });
          } catch(e) {}
        }
      };

      let audioPreloaded = false;
      function preloadAudio() {
        if (audioPreloaded) return;
        audioPreloaded = true;
        AudioManager.load("/resource/audio/bgm_day.mp3");
        AudioManager.load("/resource/audio/bgm_night.mp3");
        AudioManager.load("/resource/audio/bgm_vote.mp3");
        AudioManager.load("/resource/audio/fanfare.mp3");
        AudioManager.load("/resource/audio/click.mp3");
        AudioManager.load("/resource/audio/action.mp3");
        AudioManager.load("/resource/audio/tick.mp3");
      }

      let pointerRenderLock = false;
      let pointerReleaseTimer = null;
      let pendingRenderState = null;

      function hasFocusedChatInput() {
        const active = document.activeElement;
        if (!(active instanceof HTMLInputElement)) {
          return false;
        }
        return (
          active.name === "content" &&
          active.value.length > 0 &&
          active.form instanceof HTMLFormElement &&
          active.form.classList.contains("chat-form")
        );
      }

      function flushPendingRender() {
        if (pointerRenderLock || hasFocusedChatInput() || !pendingRenderState) {
          return;
        }
        const nextState = pendingRenderState;
        pendingRenderState = null;
        renderNow(nextState);
      }

      function holdRenderDuringPointer() {
        pointerRenderLock = true;
        if (pointerReleaseTimer) {
          clearTimeout(pointerReleaseTimer);
          pointerReleaseTimer = null;
        }
      }

      function releaseRenderAfterPointer() {
        if (pointerReleaseTimer) {
          clearTimeout(pointerReleaseTimer);
        }
        pointerReleaseTimer = setTimeout(() => {
          pointerReleaseTimer = null;
          pointerRenderLock = false;
          flushPendingRender();
        }, 0);
      }

      document.body.addEventListener("pointerdown", (event) => {
         holdRenderDuringPointer();
         preloadAudio();
         const target = event.target;
         if (target instanceof Element && target.closest('button, .action-grid-cell, .memo-role-cell, .dock-button')) {
            AudioManager.playSfx("/resource/audio/click.mp3");
         }
      }, { capture: true });
      document.addEventListener("pointerup", releaseRenderAfterPointer, true);
      document.addEventListener("pointercancel", releaseRenderAfterPointer, true);
      document.addEventListener("focusout", () => {
        setTimeout(flushPendingRender, 0);
      }, true);
      window.addEventListener("blur", releaseRenderAfterPointer);

      function showPhaseOverlay(phaseName, label) {
         let icon = "/resource/images/sun_icon.svg";
         if (phaseName === "night") icon = "/resource/images/moon_icon.svg";
         if (phaseName === "vote" || phaseName === "trial") icon = "/resource/images/gavel_icon.svg";
         
         const html = \`<div class="phase-overlay" id="phaseOverlay">
             <img src="\${icon}" />
             <h2>\${escapeHtml(label)}</h2>
         </div>\`;
         const existing = document.getElementById("phaseOverlay");
         if (existing) existing.remove();
         document.body.insertAdjacentHTML('beforeend', html);
         
         requestAnimationFrame(() => {
             const el = document.getElementById("phaseOverlay");
             if (el) {
                 el.classList.add('is-active');
                 setTimeout(() => {
                    el.classList.remove('is-active');
                    setTimeout(() => el.remove(), 400);
                 }, 1800);
             }
         });
      }

      let currentPhaseStr = initialState.room.phase;
      let currentState = initialState;
      let sinceVersion = initialState.version;
      let pollTimer = null;
      let deadlineTimer = null;

      function schedulePolling() {
         if (pollTimer) clearTimeout(pollTimer);
         const isWsOpen = ws && ws.readyState === WebSocket.OPEN;
         const interval = isWsOpen ? 15000 : (document.hidden ? 8000 : 3000);
         pollTimer = setTimeout(async () => {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
               await refreshState();
            }
            schedulePolling();
         }, interval);
      }
      let syncedServerNowMs = initialState.serverNow;
      let syncedClientPerfMs = performance.now();
      let activeSection = "actions";
      const chatDrafts = Object.create(null);
      const pendingAutoscrollChannels = new Set();

      function updateHtml(selector, html, parent = document) {
          const el = typeof selector === 'string' ? parent.querySelector(selector) : selector;
          if (el && el.innerHTML !== html) el.innerHTML = html;
      }
      function updateClass(selector, className, parent = document) {
          const el = typeof selector === 'string' ? parent.querySelector(selector) : selector;
          if (el && el.className !== className) el.className = className;
      }

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

        const deadlineAt = currentState.room.deadlineAt;
        const remaining = deadlineAt ? Math.max(0, deadlineAt - estimateServerNow()) : 0;
        const remainingSec = Math.ceil(remaining / 1000);

        document.querySelectorAll("[data-live-timer-fill]").forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (!deadlineAt) {
            node.style.width = "0%";
            return;
          }
          const totalMs = 300 * 1000;
          const pct = Math.min(100, (remaining / totalMs) * 100);
          node.style.width = pct + "%";
          if (pct < 20) {
            node.classList.add("is-urgent");
          } else {
            node.classList.remove("is-urgent");
          }
        });

        /* Timer chip urgency and tick sound */
        if (remainingSec <= 10 && remainingSec > 0 && window.lastTickSec !== remainingSec) {
           window.lastTickSec = remainingSec;
           try { AudioManager.playSfx("/resource/audio/tick.mp3"); } catch(e){}
        }

        document.querySelectorAll(".timer-chip").forEach((chip) => {
          chip.classList.toggle("is-critical", remainingSec > 0 && remainingSec <= 10);
          chip.classList.toggle("is-urgent", remainingSec > 10 && remainingSec <= 30);
        });
      }

      function captureChatScrollState() {
        const snapshot = Object.create(null);
        document.querySelectorAll(".chat-list").forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          const channel = node.dataset.channel;
          if (!channel) {
            return;
          }

          if (node.clientHeight <= 0) {
            return;
          }

          const distanceFromBottom = node.scrollHeight - (node.scrollTop + node.clientHeight);
          snapshot[channel] = {
            scrollTop: node.scrollTop,
            nearBottom: distanceFromBottom <= 72,
          };
        });
        return snapshot;
      }

      function restoreChatScrollState(snapshot) {
        document.querySelectorAll(".chat-list").forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          const channel = node.dataset.channel;
          if (!channel) {
            return;
          }

          const previous = snapshot[channel];
          const shouldStickToBottom = pendingAutoscrollChannels.has(channel) || !previous || previous.nearBottom;
          if (shouldStickToBottom) {
            node.scrollTop = node.scrollHeight;
            return;
          }

          const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
          node.scrollTop = Math.min(previous.scrollTop, maxScrollTop);
        });
        pendingAutoscrollChannels.clear();
      }

      function queueChatAutoscroll(snapshot) {
        requestAnimationFrame(() => {
          restoreChatScrollState(snapshot);
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

          if (document.activeElement !== input) {
            input.value = typeof chatDrafts[channel] === "string" ? chatDrafts[channel] : "";
          }

          if (focused && focused.channel === channel && document.activeElement !== input) {
            input.focus({ preventScroll: true });
            const end = Math.min(focused.end, input.value.length);
            const start = Math.min(focused.start, end);
            input.setSelectionRange(start, end);
          }
        });
      }

      function captureActionDraftState() {
        const drafts = [];
        document.querySelectorAll(".action-form").forEach((form) => {
          if (!(form instanceof HTMLFormElement)) return;
          const actionType = form.dataset.actionType;
          const input = form.elements.namedItem("targetId");
          if (input instanceof HTMLInputElement && input.value) {
            drafts.push({ actionType, targetId: input.value });
          }
        });
        return drafts;
      }

      function restoreActionDraftState(drafts) {
        if (!drafts) return;
        drafts.forEach((draft) => {
          const form = document.querySelector('.action-form[data-action-type="' + escapeAttribute(draft.actionType) + '"]');
          if (form instanceof HTMLFormElement) {
            const input = form.elements.namedItem("targetId");
            const btn = form.querySelector('button[type="submit"]');
            if (input instanceof HTMLInputElement && btn instanceof HTMLButtonElement) {
              input.value = draft.targetId;
              btn.disabled = false;
            }
            const gridParent = form.previousElementSibling;
            if (gridParent && gridParent.classList.contains("action-grid")) {
              const gridCell = gridParent.querySelector('.action-grid-cell[data-grid-value="' + escapeAttribute(draft.targetId) + '"]');
              if (gridCell instanceof HTMLElement) {
                gridCell.classList.add("is-selected");
              }
            }
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
        if (state.room.phase === "ended") {
          return "state";
        }
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

      function phaseDisplayText(state) {
        const phase = state.room.phase;
        const label = state.room.phaseLabel;
        if (phase === "night") return \`\${state.room.nightNumber}일째 밤\`;
        if (phase === "discussion") return \`\${state.room.dayNumber}일째 낮 토론\`;
        if (phase === "vote") return \`\${state.room.dayNumber}일째 투표\`;
        if (phase === "defense") return \`\${state.room.dayNumber}일째 최후의 반론\`;
        if (phase === "trial") return \`\${state.room.dayNumber}일째 찬반 투표\`;
        return label;
      }

      function renderHero(state) {
        const team = teamClass(state);
        const phase = state.room.phase;
        document.body.dataset.phase = phase;

        const heroEl = document.querySelector(".hero");
        updateClass(heroEl, "hero hero--" + phase);

        updateHtml(document.getElementById("hero-meta"), [
          '<div class="phase-chip phase-chip--' + phase + '">' + escapeHtml(phaseDisplayText(state)) + '</div>',
    '<div class="meta-chip role-chip role-chip--' + team + '"><strong>' + escapeHtml(state.viewer.roleLabel) + '</strong></div>',
    '<div class="timer-chip"><strong data-live-deadline></strong><div class="timer-bar" data-timer-total="' + (state.room.deadlineAt ? 300 : 0) + '"><div class="timer-bar-fill" data-live-timer-fill></div></div></div>',
        ].join(""));
}
let chatSeenCount = { public: 0, secret: 0, logs: 0 };
function renderMobileDock(state) {
  if (activeSection === "public") chatSeenCount.public = state.publicChat.messages.length;
  if (activeSection === "secret") chatSeenCount.secret = state.secretChats.reduce((acc, c) => acc + c.messages.length, 0);
  if (activeSection === "logs") chatSeenCount.logs = state.systemLog.privateLines.length;

  const currentSecretCount = state.secretChats.reduce((acc, c) => acc + c.messages.length, 0);

  const unread = {
    state: false,
    actions: false,
    public: state.publicChat.messages.length > chatSeenCount.public,
    secret: currentSecretCount > chatSeenCount.secret,
    logs: state.systemLog.privateLines.length > chatSeenCount.logs,
  };

  const actionCount = actionableControlCount(state);

  updateHtml(document.getElementById("mobile-dock-root"), [
    '<nav class="mobile-dock">',
    dockSections
      .map((section) => [
        '<button type="button" class="dock-button',
        activeSection === section.id ? ' is-active"' : '"',
        ' data-nav-section="' + section.id + '">',
        '<span class="dock-icon">' + section.icon + '</span>',
        '<strong>' + section.label + '</strong>',
        section.id === "actions" && actionCount > 0 ? '<span class="dock-badge">' + actionCount + '</span>' : "",
        section.id !== "actions" && unread[section.id] ? '<span class="dock-badge dock-badge--dot"></span>' : "",
        '</button>'
      ].join(''))
      .join(""),
    '</nav>'
  ].join(""));
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
          const isTrialVote = control.actionType === "trial_vote";
          const buttons = (control.buttons || [])
            .map(
              (button) => {
                const cls = isTrialVote ? (button.value === "yes" ? " vote-yes" : " vote-no") : "";
                return \`<button type="button" class="\${cls}" data-action-type="\${escapeHtml(control.actionType)}" data-value="\${escapeHtml(button.value)}">\${escapeHtml(button.label)}</button>\`;
              },
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

        const selectableValues = new Set((control.options || []).map((o) => o.value));
        const gridCells = currentState.room.seats.map((seat) => {
          const seatNum = seat.seat;
          const nickClass = seat.empty ? "" : nicknameClassForUser(currentState, seat.userId);
          const isSelectable = !seat.empty && selectableValues.has(seat.userId);
          const selected = !seat.empty && control.currentValue === seat.userId ? " is-selected" : "";
          const disabledCls = (!isSelectable) ? " is-disabled" : "";
          const label = seat.empty ? "빈 자리" : seat.displayName;
          const deadCls = (!seat.empty && !seat.alive) ? " is-dead-cell" : "";

          const actionIconHtml = selected ? \`<img src="/resource/actions/\${currentState.viewer.role}_action.png" class="action-target-icon" />\` : "";

          return \`<div class="action-grid-cell\${selected}\${disabledCls}\${deadCls}"\${isSelectable ? \` data-grid-value="\${escapeHtml(seat.userId)}" data-action-type="\${escapeHtml(control.actionType)}" data-action="\${escapeHtml(control.action || "")}"\` : ""}>
            <div class="action-grid-avatar \${nickClass}">\${seatNum}</div>
            <div class="action-grid-name">\${escapeHtml(label)}</div>
            \${actionIconHtml}
          </div>\`;
        }).join("");
        const current = control.currentLabel ? \`<div class="footer">현재 선택: \${escapeHtml(control.currentLabel)}</div>\` : "";
        return \`
          <div class="control">
            <strong>\${escapeHtml(control.title)}</strong>
            <div class="muted">\${escapeHtml(control.description)}</div>
            <div class="action-grid" data-action-type="\${escapeHtml(control.actionType)}" data-action="\${escapeHtml(control.action || "")}">\${gridCells}</div>
            <form class="action-form" data-action-type="\${escapeHtml(control.actionType)}" data-action="\${escapeHtml(control.action || "")}" style="margin-top:8px">
              <input type="hidden" name="targetId" value="\${escapeHtml(control.currentValue || "")}" />
              <button type="submit"\${control.currentValue ? "" : " disabled"}>제출</button>
            </form>
            \${current}
          </div>
        \`;
      }

      function displayAuthorName(viewerId, message) {
        return message.authorId === viewerId ? "나" : message.authorName;
      }

      function authorInitial(state, authorId) {
        const seat = state.room.seats.find((s) => s.userId === authorId);
        return seat ? String(seat.seat) : "?";
      }

      function shouldContinueChat(previousMessage, message) {
        if (!previousMessage || previousMessage.kind !== "player" || message.kind !== "player") {
          return false;
        }

        if (previousMessage.authorId !== message.authorId) {
          return false;
        }

        return Math.abs(message.createdAt - previousMessage.createdAt) <= 10000;
      }

      function chatMessage(state, viewerId, message, previousMessage) {
        if (message.kind === "system") {
          return \`
            <div class="chat-row chat-row--system" data-message-id="\${escapeHtml(message.id)}">
              <div class="chat-bubble chat-bubble--system">\${escapeHtml(message.content)}</div>
            </div>
          \`;
        }

        const mine = message.authorId === viewerId;
        const continued = shouldContinueChat(previousMessage, message);
        const rowClass = [mine ? "chat-row chat-row--mine" : "chat-row", continued ? "chat-row--continued" : ""]
          .filter(Boolean)
          .join(" ");
        const stackClass = mine ? "chat-stack chat-stack--mine" : "chat-stack";
        const bubbleClass = mine ? "chat-bubble chat-bubble--mine" : "chat-bubble chat-bubble--other";
        const nickClass = nicknameClassForUser(state, message.authorId);
        const avatar = mine
          ? ""
          : continued
            ? '<div class="chat-avatar chat-avatar--ghost"></div>'
            : \`<div class="chat-avatar \${nickClass}">\${escapeHtml(authorInitial(state, message.authorId))}</div>\`;
        const head = continued
          ? ""
          : \`
              <div class="chat-head">
                <div class="chat-author \${nickClass}">\${escapeHtml(displayAuthorName(viewerId, message))}</div>
                <div class="chat-meta">\${formatClock(message.createdAt)}</div>
              </div>
            \`;

        return \`
          <div class="\${rowClass}" data-message-id="\${escapeHtml(message.id)}">
            \${avatar}
            <div class="\${stackClass}">
              \${head}
              <div class="\${bubbleClass}">\${escapeHtml(message.content)}</div>
            </div>
          </div>
        \`;
      }

      function chatMessagesHtml(state, viewerId, chat) {
        return chat.messages.length > 0
          ? chat.messages
              .map((message, index) => chatMessage(state, viewerId, message, index > 0 ? chat.messages[index - 1] : null))
              .join("")
          : '<div class="line-item muted">아직 메시지가 없습니다.</div>';
      }

      function chatFooterHtml(chat) {
        return chat.canWrite
          ? \`
              <form class="chat-form" data-channel="\${escapeHtml(chat.channel)}">
                <input name="content" maxlength="500" placeholder="\${escapeHtml(chat.title)} 메시지 입력" />
                <button type="submit">전송</button>
              </form>
            \`
          : '<div class="notice" style="text-align: center; color: var(--muted); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);">🔒 현재 이 채널에 쓸 수 없습니다.</div>';
      }

      function chatSection(state, viewerId, chat, withHeading) {
        const heading = withHeading
          ? \`
              <div class="panel-head">
                <div>
                  <h3>\${escapeHtml(chat.title)}</h3>
                </div>
              </div>
            \`
          : "";

        const channelTheme = withHeading ? \` secret-chat--\${chat.channel}\` : "";
        return \`
          <div class="\${withHeading ? "secret-chat" : ""}\${channelTheme}">
            \${heading}
            <div class="chat-shell">
              <div class="chat-list" data-channel="\${escapeHtml(chat.channel)}">\${chatMessagesHtml(state, viewerId, chat)}</div>
              <div class="footer">\${chatFooterHtml(chat)}</div>
            </div>
          </div>
        \`;
      }

      function sectionClass(sectionId) {
        return \`panel section-panel \${sectionId === activeSection ? "is-active" : ""}\`;
      }

      function dashboardScaffoldHtml() {
        return \`
          <div class="dashboard-grid" data-dashboard-grid>
            <section class="panel section-panel span-4" data-section="state">
              <div class="panel-head">
                <div>
                  <h2>현재 상태</h2>
                </div>
              </div>
              <div class="panel-body viewer-stack" data-section-body="state"></div>
            </section>

            <section class="panel section-panel span-8" data-section="public">
              <div class="panel-head">
                <div>
                  <h2>공개 채팅</h2>
                </div>
              </div>
              <div class="panel-body" data-section-body="public"></div>
            </section>

            <section class="panel section-panel span-5" data-section="actions">
              <div class="panel-head">
                <div>
                  <h2>개인 행동</h2>
                </div>
              </div>
              <div class="panel-body" data-section-body="actions"></div>
            </section>

            <section class="panel section-panel span-7" data-section="secret">
              <div class="panel-head">
                <div>
                  <h2>비밀 채팅</h2>
                </div>
              </div>
              <div class="panel-body secret-stack" data-section-body="secret"></div>
            </section>

            <section class="panel section-panel span-12" data-section="logs">
              <div class="panel-head">
                <div>
                  <h2>개인 기록</h2>
                </div>
              </div>
              <div class="panel-body" data-section-body="logs"></div>
            </section>
          </div>
        \`;
      }

      function ensureDashboardScaffold() {
        const app = document.getElementById("app");
        if (!(app instanceof HTMLElement)) {
          return null;
        }
        if (!app.querySelector("[data-dashboard-grid]")) {
          app.innerHTML = dashboardScaffoldHtml();
        }
        return app;
      }

      function getSectionNode(sectionId) {
        return document.querySelector('[data-section="' + sectionId + '"]');
      }

      function getSectionBody(sectionId) {
        const section = getSectionNode(sectionId);
        if (!(section instanceof HTMLElement)) {
          return null;
        }
        const body = section.querySelector('[data-section-body="' + sectionId + '"]');
        return body instanceof HTMLElement ? body : null;
      }

      function updateSectionFrame(sectionId, spanClass, bodyClassName) {
        const section = getSectionNode(sectionId);
        if (section instanceof HTMLElement) {
          updateClass(section, sectionClass(sectionId) + " " + spanClass);
        }
        const body = getSectionBody(sectionId);
        if (body instanceof HTMLElement) {
          updateClass(body, bodyClassName);
        }
        return body;
      }

      function buildEndedSummaryHtml(state) {
        if (!state.endedSummary) {
          return "";
        }
        return \`
          <div class="viewer-card endgame-card\${state.endedSummary.viewerResultLabel === "승리" ? " endgame-card--win" : state.endedSummary.viewerResultLabel === "패배" ? " endgame-card--lose" : ""}">
            <strong>최종 결과</strong>
            <div>\${escapeHtml(state.endedSummary.winnerLabel ?? state.endedSummary.reason ?? "게임 종료")}</div>
            \${state.endedSummary.reason && state.endedSummary.reason !== state.endedSummary.winnerLabel ? \`<div class="footer">\${escapeHtml(state.endedSummary.reason)}</div>\` : ""}
            \${state.endedSummary.viewerResultLabel ? \`<div class="footer">내 결과: \${escapeHtml(state.endedSummary.viewerResultLabel)}</div>\` : ""}
          </div>
          <div class="reveal-grid">\${state.endedSummary.revealedPlayers.map((revealed) => revealCard(state, revealed)).join("")}</div>
        \`;
      }

      function renderStateSection(state) {
        const body = updateSectionFrame("state", "span-4", "panel-body viewer-stack");
        if (!(body instanceof HTMLElement)) {
          return;
        }
        const team = teamClass(state);
        const roleIcon = ROLE_ICONS.find((role) => role.label === state.viewer.roleLabel);
        updateHtml(body, \`
          \${!state.viewer.alive ? '<div class="spectator-banner">관전 중입니다</div>' : ""}
          <div class="viewer-card viewer-card--\${team}\${!state.viewer.alive ? " viewer-card--dead" : ""}">
            <div style="display:flex;gap:12px;align-items:flex-start;">
              \${roleIcon ? \`<img src="\${roleIconUrl(roleIcon.key)}" alt="" style="width:42px;height:42px;border-radius:10px;object-fit:contain;flex-shrink:0;opacity:0.92;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));" />\` : ""}
              <div>
                <strong>내 정보</strong>
                <div>직업: \${escapeHtml(state.viewer.roleLabel)}</div>
              </div>
            </div>
            <div class="muted" style="margin-top: 8px;">\${escapeHtml(state.viewer.roleSummary)}</div>
            \${state.viewer.loverName ? \`<div class="footer">연인: \${escapeHtml(state.viewer.loverName)}</div>\` : ""}
            \${state.viewer.deadReason ? \`<div class="footer">사망 사유: \${escapeHtml(state.viewer.deadReason)}</div>\` : ""}
            \${state.viewer.ascended ? '<div class="footer">성불 상태</div>' : ""}
          </div>
          <div class="mini-grid">
            <div class="mini-card">
              <strong>남은 시간</strong>
              <div data-live-deadline></div>
            </div>
            <div class="mini-card">
              <strong>행동</strong>
              <div>\${actionableControlCount(state)}개 가능</div>
            </div>
          </div>
          <div class="seat-grid">\${state.room.seats.map((seat) => seatCard(state, seat)).join("")}</div>
          \${state.room.currentTrialTargetName ? \`<div class="line-item"><strong>현재 대상</strong><div>\${escapeHtml(state.room.currentTrialTargetName)}</div></div>\` : ""}
          \${buildEndedSummaryHtml(state)}
        \`);
      }

      function renderActionsSection(state) {
        const body = updateSectionFrame("actions", "span-5", "panel-body");
        if (!(body instanceof HTMLElement)) {
          return;
        }
        const notices = state.actions.notices.map((notice) => \`<div class="notice">\${escapeHtml(notice)}</div>\`).join("");
        const controls = state.actions.controls.map(actionControl).join("");
        updateHtml(body, \`<div class="control-list">\${notices}\${controls}</div>\`);
      }

      function ensureChatRoot(root, chat, withHeading) {
        if (!(root instanceof HTMLElement)) {
          return null;
        }

        const mode = withHeading ? "secret" : "public";
        if (root.dataset.chatMode !== mode) {
          root.dataset.chatMode = mode;
          root.innerHTML = withHeading
            ? '<div class="panel-head"><div><h3></h3></div></div><div class="chat-shell"><div class="chat-list"></div><div class="footer"></div></div>'
            : '<div class="chat-shell"><div class="chat-list"></div><div class="footer"></div></div>';
        }

        if (withHeading) {
          updateClass(root, "secret-chat secret-chat--" + chat.channel);
          const heading = root.querySelector("h3");
          if (heading instanceof HTMLElement) {
            heading.textContent = chat.title;
          }
        } else if (root.className) {
          root.className = "";
        }

        const list = root.querySelector(".chat-list");
        if (list instanceof HTMLElement) {
          list.dataset.channel = chat.channel;
        }
        const footer = root.querySelector(".footer");
        return {
          list: list instanceof HTMLElement ? list : null,
          footer: footer instanceof HTMLElement ? footer : null,
        };
      }

      function syncChatRoot(root, state, viewerId, chat, withHeading) {
        const nodes = ensureChatRoot(root, chat, withHeading);
        if (!nodes) {
          return;
        }
        if (nodes.list) {
          updateHtml(nodes.list, chatMessagesHtml(state, viewerId, chat));
        }
        if (nodes.footer) {
          updateHtml(nodes.footer, chatFooterHtml(chat));
        }
      }

      function renderPublicSection(state) {
        const body = updateSectionFrame("public", "span-8", "panel-body");
        if (!(body instanceof HTMLElement)) {
          return;
        }
        let chatRoot = body.querySelector('[data-chat-root="public"]');
        if (!(chatRoot instanceof HTMLElement)) {
          body.innerHTML = '<div data-chat-root="public"></div>';
          chatRoot = body.querySelector('[data-chat-root="public"]');
        }
        syncChatRoot(chatRoot, state, state.viewer.userId, state.publicChat, false);
      }

      function renderSecretSection(state) {
        const body = updateSectionFrame("secret", "span-7", "panel-body secret-stack");
        if (!(body instanceof HTMLElement)) {
          return;
        }
        if (state.secretChats.length === 0) {
          delete body.dataset.secretChannels;
          updateHtml(body, '<div class="line-item muted">현재 접근 가능한 비밀 채팅이 없습니다.</div>');
          return;
        }

        const secretChannels = state.secretChats.map((chat) => chat.channel).join(",");
        if (body.dataset.secretChannels !== secretChannels) {
          body.dataset.secretChannels = secretChannels;
          body.innerHTML = state.secretChats
            .map((chat) => '<div data-secret-chat-channel="' + chat.channel + '"></div>')
            .join("");
        }

        state.secretChats.forEach((chat) => {
          const chatRoot = body.querySelector('[data-secret-chat-channel="' + chat.channel + '"]');
          syncChatRoot(chatRoot, state, state.viewer.userId, chat, true);
        });
      }

      function renderLogsSection(state) {
        const body = updateSectionFrame("logs", "span-12", "panel-body");
        if (!(body instanceof HTMLElement)) {
          return;
        }
        const privateLines =
          state.systemLog.privateLines.length > 0
            ? state.systemLog.privateLines
                .map(
                  (line) =>
                    \`<div class="line-item success"><strong>\${formatClock(line.createdAt)}</strong><div>\${escapeHtml(line.line)}</div></div>\`,
                )
                .join("")
            : '<div class="line-item muted">개인 결과가 아직 없습니다.</div>';
        updateHtml(body, '<div class="line-list">' + privateLines + '</div>');
      }

      function revealCard(state, revealed) {
        const teamClass = revealed.teamLabel === "마피아팀" ? "mafia" : "citizen";
        const nickClass = nicknameClassForUser(state, revealed.userId);
        const status = revealed.alive ? "생존" : "사망";
        const extras = [
          revealed.teamLabel,
          status,
          revealed.ascended ? "성불" : "",
          revealed.deadReason ? \`사유: \${revealed.deadReason}\` : "",
        ].filter(Boolean).join(" · ");

        return \`
          <div class="reveal-card reveal-card--\${teamClass}">
            <div class="reveal-name \${nickClass}">\${escapeHtml(revealed.displayName)}\${revealed.isViewer ? " (나)" : ""}</div>
            <div class="reveal-role">\${escapeHtml(revealed.roleLabel)}</div>
            <div class="reveal-meta">\${escapeHtml(extras)}</div>
          </div>
        \`;
      }

      function seatMemoHtml(seatNum) {
        const memoKey = seatMemos[seatNum];
        if (memoKey) {
          return \`<div class="seat-memo"><img src="\${roleIconUrl(memoKey)}" alt="memo" /></div>\`;
        }
        return '<div class="seat-memo seat-memo--empty">?</div>';
      }

      function seatCard(state, seat) {
        if (seat.empty) {
          return \`
            <div class="seat-card is-empty">
              <div class="seat-avatar" style="background: rgba(255,255,255,0.06); color: var(--muted);">\${seat.seat}</div>
              <div class="seat-name muted">빈 자리</div>
            </div>
          \`;
        }

        const flags = [];
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
          <div class="\${classes.join(" ")}" data-memo-seat="\${seat.seat}">
            <div class="seat-avatar \${nickClass}">\${seat.seat}</div>
            <div class="seat-flags" style="position:absolute;top:26px;left:4px;z-index:4;flex-direction:column;">\${flags.join("")}</div>
            \${seatMemoHtml(seat.seat)}
            <div class="seat-name \${nickClass}">\${escapeHtml(seat.displayName)}</div>
          </div>
        \`;
      }

      function renderMemoOverlay(seatNum) {
        const currentMemo = seatMemos[seatNum] || null;
        const seat = currentState.room.seats.find((s) => s.seat === seatNum);
        const displayName = seat && !seat.empty ? seat.displayName : "#" + seatNum;
        const cells = ROLE_ICONS.map((role) => {
          const selected = currentMemo === role.key ? " is-selected" : "";
          const teamCls = role.team === "mafia" ? " is-mafia-role" : "";
          return \`<div class="memo-role-cell\${selected}\${teamCls}" data-memo-role="\${role.key}">
            <img class="memo-role-icon" src="\${roleIconUrl(role.key)}" alt="\${escapeHtml(role.label)}" />
            <div class="memo-role-name">\${escapeHtml(role.label)}</div>
          </div>\`;
        }).join("");

        return \`<div class="memo-overlay" data-memo-overlay>
          <div class="memo-sheet">
            <div class="memo-sheet-head">
              <h3>\${escapeHtml(displayName)} 추리 메모</h3>
              <button type="button" class="memo-close-btn" data-memo-close>✕</button>
            </div>
            <div class="memo-grid">\${cells}</div>
            <div class="memo-clear-row">
              <button type="button" data-memo-clear>메모 지우기</button>
            </div>
          </div>
        </div>\`;
      }

      function openMemoOverlay(seatNum) {
        closeMemoOverlay();
        memoOverlayTarget = seatNum;
        document.body.insertAdjacentHTML("beforeend", renderMemoOverlay(seatNum));
      }

      function closeMemoOverlay() {
        memoOverlayTarget = null;
        const existing = document.querySelector("[data-memo-overlay]");
        if (existing) existing.remove();
      }

      function render(state) {
        if (pointerRenderLock || hasFocusedChatInput()) {
          pendingRenderState = state;
          return;
        }
        pendingRenderState = null;
        renderNow(state);
      }

      function renderNow(state) {
        if (currentPhaseStr !== state.room.phase) {
          currentPhaseStr = state.room.phase;
          
          let bgm = "/resource/audio/bgm_day.mp3";
          if (currentPhaseStr === "night") bgm = "/resource/audio/bgm_night.mp3";
          if (currentPhaseStr === "vote" || currentPhaseStr === "trial" || currentPhaseStr === "defense") bgm = "/resource/audio/bgm_vote.mp3";
          if (currentPhaseStr === "ended") bgm = "/resource/audio/fanfare.mp3";
          AudioManager.playBgm(bgm);
          
          let title = "아침이 밝았습니다";
          if (currentPhaseStr === "night") title = "밤이 되었습니다";
          if (currentPhaseStr === "vote") title = "투표 시간입니다";
          if (currentPhaseStr === "defense") title = "최후의 변론";
          if (currentPhaseStr === "trial") title = "찬반 투표";
          if (currentPhaseStr === "ended") title = "게임 종료";
          
          showPhaseOverlay(currentPhaseStr, title);
        }

        const focusedChat = captureChatDraftState();
        const actionDrafts = captureActionDraftState();
        const chatScrollState = captureChatScrollState();
        ensureActiveSection(state);
        ensureDashboardScaffold();
        renderHero(state);
        renderMobileDock(state);
        renderStateSection(state);
        renderPublicSection(state);
        renderActionsSection(state);
        renderSecretSection(state);
        renderLogsSection(state);

        restoreChatDraftState(focusedChat);
        restoreActionDraftState(actionDrafts);
        updateDeadlineDisplays();
        scheduleDeadlineTicker();
        queueChatAutoscroll(chatScrollState);
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

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.classList.add("is-loading");

        try {
          if (form.classList.contains("action-form")) {
            const data = new FormData(form);
            await postJson(\`/api/game/\${encodeURIComponent(currentState.room.gameId)}/actions\`, {
              actionType: form.dataset.actionType,
              action: form.dataset.action || undefined,
              targetId: data.get("targetId"),
            });
            showToast("행동을 제출했습니다", "success");
            AudioManager.playSfx("/resource/audio/action.mp3");
            await refreshState();
          }

          if (form.classList.contains("chat-form")) {
            const data = new FormData(form);
            const channel = form.dataset.channel;
            const content = data.get("content");
            form.reset();
            if (channel) {
              delete chatDrafts[channel];
              pendingAutoscrollChannels.add(channel);
            }
            await postJson(\`/api/game/\${encodeURIComponent(currentState.room.gameId)}/chats/\${encodeURIComponent(form.dataset.channel)}\`, {
              content,
            });
          }
        } catch (error) {
          showToast(error.message || "요청 실패", "error");
        } finally {
          if (submitBtn) submitBtn.classList.remove("is-loading");
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
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        /* ── Memo overlay interactions ── */
        if (target.closest("[data-memo-close]")) {
          closeMemoOverlay();
          return;
        }

        if (target.closest("[data-memo-clear]")) {
          if (memoOverlayTarget != null) {
            delete seatMemos[memoOverlayTarget];
            saveMemos();
            closeMemoOverlay();
            render(currentState);
          }
          return;
        }

        const memoRoleCell = target.closest("[data-memo-role]");
        if (memoRoleCell instanceof HTMLElement) {
          const roleKey = memoRoleCell.dataset.memoRole;
          if (memoOverlayTarget != null && roleKey) {
            seatMemos[memoOverlayTarget] = roleKey;
            saveMemos();
            closeMemoOverlay();
            render(currentState);
          }
          return;
        }

        const memoOverlayBg = target.closest("[data-memo-overlay]");
        if (memoOverlayBg && !target.closest(".memo-sheet")) {
          closeMemoOverlay();
          return;
        }

        /* ── Seat card memo tap (status tab) ── */
        const seatCardEl = target.closest("[data-memo-seat]");
        if (seatCardEl instanceof HTMLElement && seatCardEl.closest('[data-section="state"]')) {
          const seatNum = Number(seatCardEl.dataset.memoSeat);
          if (!Number.isNaN(seatNum)) {
            openMemoOverlay(seatNum);
            return;
          }
        }

        const gridCell = target.closest(".action-grid-cell");
        if (gridCell instanceof HTMLElement) {
          const gridValue = gridCell.dataset.gridValue;
          const gridParent = gridCell.closest(".action-grid");
          if (gridValue && gridParent) {
            gridParent.querySelectorAll(".action-grid-cell").forEach((c) => c.classList.remove("is-selected"));
            gridCell.classList.add("is-selected");
            const form = gridParent.nextElementSibling;
            if (form instanceof HTMLFormElement) {
              const hiddenInput = form.querySelector('input[name="targetId"]');
              if (hiddenInput instanceof HTMLInputElement) {
                hiddenInput.value = gridValue;
              }
              const submitButton = form.querySelector('button[type="submit"]');
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }
          }
          return;
        }

        const button = target.closest("button");
        if (!(button instanceof HTMLButtonElement)) {
          return;
        }

        const navSection = button.dataset.navSection;
        if (navSection) {
          activeSection = navSection;
          render(currentState);
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
          showToast(error.message || "요청 실패", "error");
        }
      });

      let ws = null;
      let wsReconnectTimer = null;
      function connectWebSocket() {
         if (ws) return;
         const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
         const wsUrl = protocol + '//' + location.host + '/api/game/' + encodeURIComponent(currentState.room.gameId) + '/ws';
         ws = new WebSocket(wsUrl);
         ws.onopen = () => {
            if (wsReconnectTimer) {
               clearTimeout(wsReconnectTimer);
               wsReconnectTimer = null;
            }
            refreshState();
            schedulePolling();
         };
         ws.onmessage = (event) => {
            try {
               const msg = JSON.parse(event.data);
               if (msg.type === "state" && msg.payload) {
                  syncServerClock(msg.payload.serverNow);
                  if (msg.payload.changed && msg.payload.state) {
                     currentState = msg.payload.state;
                     sinceVersion = msg.payload.version;
                     render(currentState);
                  } else {
                     sinceVersion = msg.payload.version;
                     scheduleDeadlineTicker();
                  }
               }
            } catch (e) {}
         };
         ws.onclose = () => {
            ws = null;
            wsReconnectTimer = setTimeout(connectWebSocket, 2000);
         };
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

      document.addEventListener("visibilitychange", () => {
         if (!document.hidden && !ws) connectWebSocket();
         schedulePolling();
      });

      activeSection = pickDefaultSection(currentState);
      syncServerClock(initialState.serverNow);
      render(currentState);
      connectWebSocket();
      schedulePolling();
      scheduleDeadlineTicker();