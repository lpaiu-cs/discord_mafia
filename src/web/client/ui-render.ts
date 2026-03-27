import { GameState, ChatThread, PersonalRecentMatch, PersonalRoleStat, Seat } from "./types.js";
import { collectSeatActionMarkers, SeatActionMarkerMap } from "./action-markers.js";
import { actionableControlCount, actionControlHtml, captureActionDraftState, restoreActionDraftState } from "./actions.js";
import { chatMessagesHtml, chatFooterHtml, captureChatDraftState, restoreChatDraftState, captureChatScrollState, queueChatAutoscroll } from "./chat.js";
import { estimateServerNow, currentState } from "./state-sync.js";

// --- HTML Escape utilities ---
export function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

// --- DOM helpers ---
export function updateHtml(selector: string | HTMLElement | null, html: string, parent: Document | HTMLElement = document) {
    const el = typeof selector === 'string' ? parent.querySelector(selector) : selector;
    if (el && el.innerHTML !== html) el.innerHTML = html;
}
export function updateClass(selector: string | HTMLElement | null, className: string, parent: Document | HTMLElement = document) {
    const el = typeof selector === 'string' ? parent.querySelector(selector) : selector;
    if (el && el.className !== className) el.className = className;
}

export function formatClock(timestamp?: number): string {
  if (!timestamp) return "없음";
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return "없음";
  return new Date(timestamp).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDeadline(timestamp?: number | null): string {
  if (!timestamp) return "마감 없음";
  const remaining = Math.max(0, timestamp - estimateServerNow());
  return `${Math.ceil(remaining / 1000)}초 남음`;
}

// --- Audio Manager ---
export const AUDIO_FILES: Record<string, string> = {
  bgm_day: "/resource/audio/bgm_day.mp3",
  bgm_night: "/resource/audio/bgm_night.mp3",
  bgm_vote: "/resource/audio/bgm_vote.wav",
  fanfare: "/resource/audio/fanfare.wav",
  click: "/resource/audio/click.wav",
  action: "/resource/audio/action.wav",
  tick: "/resource/audio/tick.wav",
  beast_howling: "/resource/audio/beast_howling.mp3",
  camera_shutter: "/resource/audio/camera_shutter.mp3",
  charm: "/resource/audio/charm.mp3",
  doctor_save: "/resource/audio/%EC%95%84%EB%B3%91%EC%9B%90%EC%9D%B4%EC%9A%94%EC%95%88%EC%8B%AC%ED%95%98%EC%84%B8%EC%9A%94.mp3",
  door: "/resource/audio/door.mp3",
  explosion: "/resource/audio/explosion.mp3",
  gavel: "/resource/audio/gavel.mp3",
  gunshots: "/resource/audio/gunshots.mp3",
  magical: "/resource/audio/magical.mp3",
  punch: "/resource/audio/punch.mp3",
  revive: "/resource/audio/revive.mp3",
  rogerthatover: "/resource/audio/rogerthatover.mp3",
};

export const AudioManager = {
  ctx: null as AudioContext | null,
  buffers: {} as Record<string, AudioBuffer>,
  bgmNode: null as { source: AudioBufferSourceNode, gain: GainNode } | null,
  currentBgmUrl: null as string | null,
  
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },
  async load(url: string) {
    if (this.buffers[url]) return this.buffers[url];
    try {
      const res = await fetch(url, { cache: "force-cache" });
      const arrayBuffer = await res.arrayBuffer();
      if (!this.ctx) this.init();
      const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
      this.buffers[url] = audioBuffer;
      return audioBuffer;
    } catch(e) { return null; }
  },
  playSfx(url: string, options: { gain?: number } = {}) {
    try {
      this.init();
      this.load(url).then(buf => {
        if (!buf || !this.ctx) return;
        const source = this.ctx.createBufferSource();
        source.buffer = buf;
        const gain = this.ctx.createGain();
        gain.gain.value = typeof options.gain === "number" ? options.gain : 0.5;
        source.connect(gain);
        gain.connect(this.ctx.destination);
        source.start();
      });
    } catch(e) {}
  },
  playBgm(url: string) {
    if (this.currentBgmUrl === url) return;
    try {
      this.init();
      this.currentBgmUrl = url;
      this.load(url).then(buf => {
        if (!buf || this.currentBgmUrl !== url || !this.ctx) return;
        const oldNode = this.bgmNode;
        const source = this.ctx.createBufferSource();
        source.buffer = buf;
        source.loop = true;
        
        const gain = this.ctx.createGain();
        gain.gain.value = 0.0;
        source.connect(gain);
        gain.connect(this.ctx.destination);
        source.start();
        
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
export function preloadAudio() {
  if (audioPreloaded) return;
  audioPreloaded = true;
  Object.values(AUDIO_FILES).forEach((url) => {
    AudioManager.load(url);
  });
}

const playedAudioCueIds = new Set<string>();
const audioSessionStartedAt = Date.now();
let audioCueTimer: number | null = null;
const queuedAudioCueKeys: { key: string, delayMs: number }[] = [];

function queueAudioCuePlayback(key: string, delayMs = 0) {
  const url = AUDIO_FILES[key];
  if (!url) return;
  queuedAudioCueKeys.push({ key, delayMs });
  flushQueuedAudioCues();
}

function flushQueuedAudioCues() {
  if (audioCueTimer || queuedAudioCueKeys.length === 0) return;
  const next = queuedAudioCueKeys.shift();
  if (!next) return;
  audioCueTimer = window.setTimeout(() => {
    audioCueTimer = null;
    AudioManager.playSfx(AUDIO_FILES[next.key]);
    flushQueuedAudioCues();
  }, next.delayMs);
}

function playNewAudioCues(state: GameState, options: { phaseChanged?: boolean } = {}) {
  const phaseChanged = Boolean(options.phaseChanged);
  const newCues = (state.audioCues || [])
    .filter((cue) => cue && !playedAudioCueIds.has(cue.id) && cue.createdAt >= audioSessionStartedAt - 500)
    .sort((left, right) => left.createdAt - right.createdAt);

  if (newCues.length === 0) return;

  const baseDelay = phaseChanged ? 180 : 0;
  newCues.forEach((cue, index) => {
    playedAudioCueIds.add(cue.id);
    queueAudioCuePlayback(cue.key, baseDelay + index * 220);
  });
}

function bgmForPhase(phase: string) {
  if (phase === "night") return AUDIO_FILES.bgm_night;
  if (phase === "vote" || phase === "trial" || phase === "defense") return AUDIO_FILES.bgm_vote;
  if (phase === "ended") return AUDIO_FILES.fanfare;
  return AUDIO_FILES.bgm_day;
}

// --- Toast & Overlay ---
export function showToast(message: string, type = "info") {
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

function showPhaseOverlay(phaseName: string, label: string) {
   let icon = "/resource/images/sun_icon.svg";
   if (phaseName === "night") icon = "/resource/images/moon_icon.svg";
   if (phaseName === "vote" || phaseName === "trial") icon = "/resource/images/gavel_icon.svg";
   
   const html = `<div class="phase-overlay" id="phaseOverlay">
       <img src="${icon}" />
       <h2>${escapeHtml(label)}</h2>
   </div>`;
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

// --- Icons & Labels ---
export const ROLE_ICONS = [
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

export function roleIconUrl(key: string) {
  return "/resource/roles/" + key + "_icon.png";
}

export function nicknameClassForUser(state: GameState, userId?: string) {
  if (!userId) {
    return "nick-color-7";
  }

  const occupiedSeats = state.room.seats.filter((seat) => !seat.empty);
  const seatIndex = occupiedSeats.findIndex((seat) => seat.userId === userId);
  if (seatIndex >= 0) {
    return `nick-color-${(seatIndex % 8) + 1}`;
  }

  let hash = 0;
  for (const char of String(userId)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `nick-color-${(hash % 8) + 1}`;
}

export const dockSections = [
  { id: "state", label: "상태", icon: "👤" },
  { id: "actions", label: "행동", icon: "⚡" },
  { id: "public", label: "공개", icon: "💬" },
  { id: "secret", label: "비밀", icon: "🤫" },
  { id: "logs", label: "개인", icon: "🔒" },
];

export let activeSection = "state";
export function setActiveSection(section: string) { activeSection = section; }

function pickDefaultSection(state: GameState) {
  if (state.room.phase === "ended") return "state";
  if (actionableControlCount(state) > 0) return "actions";
  if (state.publicChat.canWrite) return "public";
  if (state.secretChats.length > 0) return "secret";
  return "state";
}

export function ensureActiveSection(state: GameState) {
  if (!activeSection && currentState) activeSection = pickDefaultSection(currentState);
  const valid = dockSections.map((section) => section.id);
  if (!valid.includes(activeSection)) {
    activeSection = pickDefaultSection(state);
  }
}

// --- Memos ---
const getMemoKey = () => "mafia_memos_" + (currentState?.room?.gameId || "default");
export const seatMemos: Record<number, string> = (() => {
  try {
    const raw = localStorage.getItem(getMemoKey());
    return raw ? Object.assign(Object.create(null), JSON.parse(raw)) : Object.create(null);
  } catch { return Object.create(null); }
})();
export function saveMemos() {
  try { localStorage.setItem(getMemoKey(), JSON.stringify(seatMemos)); } catch {}
}
export let memoOverlayTarget: number | null = null;
export function setMemoOverlayTarget(val: number | null) { memoOverlayTarget = val; }

// --- Render Logic ---
let pointerRenderLock = false;
let pointerReleaseTimer: number | null = null;
let pendingRenderState: GameState | null = null;

export function hasFocusedChatInput() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement)) return false;
  return (
    active.name === "content" &&
    active.value.length > 0 &&
    active.form instanceof HTMLFormElement &&
    active.form.classList.contains("chat-form")
  );
}

export function flushPendingRender() {
  if (pointerRenderLock || hasFocusedChatInput() || !pendingRenderState) return;
  const nextState = pendingRenderState;
  pendingRenderState = null;
  renderNow(nextState);
}

export function holdRenderDuringPointer() {
  pointerRenderLock = true;
  if (pointerReleaseTimer) {
    clearTimeout(pointerReleaseTimer);
    pointerReleaseTimer = null;
  }
}

export function releaseRenderAfterPointer() {
  if (pointerReleaseTimer) clearTimeout(pointerReleaseTimer);
  pointerReleaseTimer = window.setTimeout(() => {
    pointerReleaseTimer = null;
    pointerRenderLock = false;
    flushPendingRender();
  }, 0);
}

let currentPhaseStr = "";
let currentBgmPhase: string | null = null;
const chatSeenCount = { public: 0, secret: 0, logs: 0 };

export function updateDeadlineDisplays() {
  if(!currentState) return;
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

  if (remainingSec <= 10 && remainingSec > 0 && (window as any).lastTickSec !== remainingSec) {
     (window as any).lastTickSec = remainingSec;
     try { AudioManager.playSfx(AUDIO_FILES.tick); } catch(e){}
  }

  document.querySelectorAll(".timer-chip").forEach((chip) => {
    chip.classList.toggle("is-critical", remainingSec > 0 && remainingSec <= 10);
    chip.classList.toggle("is-urgent", remainingSec > 10 && remainingSec <= 30);
  });
}

function teamClass(state: GameState) {
  return state.viewer.teamLabel === "마피아팀" ? "mafia" : "citizen";
}

function phaseDisplayText(state: GameState) {
  const phase = state.room.phase;
  const label = state.room.phaseLabel;
  if (phase === "night") return `${state.room.nightNumber}일째 밤`;
  if (phase === "discussion") return `${state.room.dayNumber}일째 낮 토론`;
  if (phase === "vote") return `${state.room.dayNumber}일째 투표`;
  if (phase === "defense") return `${state.room.dayNumber}일째 최후의 반론`;
  if (phase === "trial") return `${state.room.dayNumber}일째 찬반 투표`;
  return label;
}

export function renderHero(state: GameState) {
  const team = teamClass(state);
  const phase = state.room.phase;
  document.body.dataset.phase = phase;

  const heroEl = document.querySelector<HTMLElement>(".hero");
  updateClass(heroEl, "hero hero--" + phase);

  updateHtml(document.getElementById("hero-meta"), [
    '<div class="phase-chip phase-chip--' + phase + '">' + escapeHtml(phaseDisplayText(state)) + '</div>',
    '<div class="meta-chip role-chip role-chip--' + team + '"><strong>' + escapeHtml(state.viewer.roleLabel) + '</strong></div>',
    '<div class="timer-chip"><strong data-live-deadline></strong><div class="timer-bar" data-timer-total="' + (state.room.deadlineAt ? 300 : 0) + '"><div class="timer-bar-fill" data-live-timer-fill></div></div></div>',
  ].join(""));
}

export function renderMobileDock(state: GameState) {
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
        section.id !== "actions" && unread[section.id as keyof typeof unread] ? '<span class="dock-badge dock-badge--dot"></span>' : "",
        '</button>'
      ].join(''))
      .join(""),
    '</nav>'
  ].join(""));
}

function updateSectionFrame(sectionId: string, spanClass: string, bodyClassName: string) {
  const section = document.querySelector('[data-section="' + sectionId + '"]');
  if (section instanceof HTMLElement) {
    updateClass(section, `panel section-panel ${sectionId === activeSection ? "is-active" : ""} ${spanClass}`);
  }
  const body = section?.querySelector('[data-section-body="' + sectionId + '"]');
  if (body instanceof HTMLElement) {
    updateClass(body, bodyClassName);
  }
  return body instanceof HTMLElement ? body : null;
}

export function renderStateSection(state: GameState) {
  const body = updateSectionFrame("state", "span-4", "panel-body viewer-stack");
  if (!body) return;
  const actionMarkers = collectSeatActionMarkers(state);
  
  const team = teamClass(state);
  const roleIcon = ROLE_ICONS.find((role) => role.label === state.viewer.roleLabel);
  updateHtml(body, `
    ${!state.viewer.alive ? '<div class="spectator-banner">관전 중입니다</div>' : ""}
    <div class="viewer-card viewer-card--${team}${!state.viewer.alive ? " viewer-card--dead" : ""}">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        ${roleIcon ? `<img src="${roleIconUrl(roleIcon.key)}" alt="" style="width:42px;height:42px;border-radius:10px;object-fit:contain;flex-shrink:0;opacity:0.92;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));" />` : ""}
        <div>
          <strong>내 정보</strong>
          <div>직업: ${escapeHtml(state.viewer.roleLabel)}</div>
        </div>
      </div>
      <div class="muted" style="margin-top: 8px;">${escapeHtml(state.viewer.roleSummary)}</div>
      ${state.viewer.loverName ? `<div class="footer">연인: ${escapeHtml(state.viewer.loverName)}</div>` : ""}
      ${state.viewer.deadReason ? `<div class="footer">사망 사유: ${escapeHtml(state.viewer.deadReason)}</div>` : ""}
      ${state.viewer.ascended ? '<div class="footer">성불 상태</div>' : ""}
    </div>
    <div class="mini-grid">
      <div class="mini-card">
        <strong>남은 시간</strong>
        <div data-live-deadline></div>
      </div>
      <div class="mini-card">
        <strong>행동</strong>
      <div>${actionableControlCount(state)}개 가능</div>
      </div>
    </div>
    <div class="seat-grid">${state.room.seats.map((seat) => seatCard(state, seat, actionMarkers)).join("")}</div>
    ${state.room.currentTrialTargetName ? `<div class="line-item"><strong>현재 대상</strong><div>${escapeHtml(state.room.currentTrialTargetName)}</div></div>` : ""}
    ${buildEndedSummaryHtml(state)}
  `);
}

function buildEndedSummaryHtml(state: GameState) {
  if (!state.endedSummary) return "";
  return `
    <div class="viewer-card endgame-card${state.endedSummary.viewerResultLabel === "승리" ? " endgame-card--win" : state.endedSummary.viewerResultLabel === "패배" ? " endgame-card--lose" : ""}">
      <strong>최종 결과</strong>
      <div>${escapeHtml(state.endedSummary.winnerLabel ?? state.endedSummary.reason ?? "게임 종료")}</div>
      ${state.endedSummary.reason && state.endedSummary.reason !== state.endedSummary.winnerLabel ? `<div class="footer">${escapeHtml(state.endedSummary.reason)}</div>` : ""}
      ${state.endedSummary.viewerResultLabel ? `<div class="footer">내 결과: ${escapeHtml(state.endedSummary.viewerResultLabel)}</div>` : ""}
    </div>
    <div class="reveal-grid">${state.endedSummary.revealedPlayers.map((revealed) => revealCard(state, revealed)).join("")}</div>
  `;
}

function revealCard(state: GameState, revealed: any) {
  const teamClass = revealed.teamLabel === "마피아팀" ? "mafia" : "citizen";
  const nickClass = nicknameClassForUser(state, revealed.userId);
  const status = revealed.alive ? "생존" : "사망";
  const extras = [
    revealed.teamLabel,
    status,
    revealed.ascended ? "성불" : "",
    revealed.deadReason ? `사유: ${revealed.deadReason}` : "",
  ].filter(Boolean).join(" · ");

  return `
    <div class="reveal-card reveal-card--${teamClass}">
      <div class="reveal-name ${nickClass}">${escapeHtml(revealed.displayName)}${revealed.isViewer ? " (나)" : ""}</div>
      <div class="reveal-role">${escapeHtml(revealed.roleLabel)}</div>
      <div class="reveal-meta">${escapeHtml(extras)}</div>
    </div>
  `;
}

function seatCard(state: GameState, seat: Seat, actionMarkers: SeatActionMarkerMap) {
  if (seat.empty) {
    return `
      <div class="seat-card is-empty">
        <div class="seat-avatar" style="background: rgba(255,255,255,0.06); color: var(--muted);">${seat.seat}</div>
        <div class="seat-name muted">빈 자리</div>
      </div>
    `;
  }
  const flags = [];
  if (seat.bullied) flags.push('<span class="seat-flag">협박</span>');
  if (seat.ascended) flags.push('<span class="seat-flag">성불</span>');

  const classes = ["seat-card"];
  if (seat.isViewer) classes.push("is-viewer");
  if (!seat.alive) classes.push("is-dead");
  const nickClass = nicknameClassForUser(state, seat.userId);
  const markerHtml = seat.userId ? seatActionMarkersHtml(actionMarkers[seat.userId]) : "";

  return `
    <div class="${classes.join(" ")}" data-memo-seat="${seat.seat}">
      <div class="seat-avatar ${nickClass}">${seat.seat}</div>
      ${markerHtml}
      <div class="seat-flags" style="position:absolute;top:26px;left:4px;z-index:4;flex-direction:column;">${flags.join("")}</div>
      ${seatMemoHtml(seat.seat)}
      <div class="seat-name ${nickClass}">${escapeHtml(seat.displayName || "")}</div>
    </div>
  `;
}

function seatActionMarkersHtml(markers?: { iconUrl: string; label: string }[]) {
  if (!markers || markers.length === 0) {
    return "";
  }

  return `
    <div class="seat-action-markers" aria-hidden="true">
      ${markers
        .map(
          (marker) =>
            `<img class="seat-action-marker" src="${escapeAttribute(marker.iconUrl)}" alt="" title="${escapeAttribute(marker.label)}" />`,
        )
        .join("")}
    </div>
  `;
}

function seatMemoHtml(seatNum: number) {
  const memoKey = seatMemos[seatNum];
  if (memoKey) {
    return `<div class="seat-memo"><img src="${roleIconUrl(memoKey)}" alt="memo" /></div>`;
  }
  return '<div class="seat-memo seat-memo--empty">?</div>';
}

export function renderMemoOverlay(seatNum: number) {
  const currentMemo = seatMemos[seatNum] || null;
  const seat = currentState?.room.seats.find((s) => s.seat === seatNum);
  const displayName = seat && !seat.empty ? seat.displayName : "#" + seatNum;
  const cells = ROLE_ICONS.map((role) => {
    const selected = currentMemo === role.key ? " is-selected" : "";
    const teamCls = role.team === "mafia" ? " is-mafia-role" : "";
    return `<div class="memo-role-cell${selected}${teamCls}" data-memo-role="${role.key}">
      <img class="memo-role-icon" src="${roleIconUrl(role.key)}" alt="${escapeHtml(role.label)}" />
      <div class="memo-role-name">${escapeHtml(role.label)}</div>
    </div>`;
  }).join("");

  return `<div class="memo-overlay" data-memo-overlay>
    <div class="memo-sheet">
      <div class="memo-sheet-head">
        <h3>${escapeHtml(displayName || "")} 추리 메모</h3>
        <button type="button" class="memo-close-btn" data-memo-close>✕</button>
      </div>
      <div class="memo-grid">${cells}</div>
      <div class="memo-clear-row">
        <button type="button" data-memo-clear>메모 지우기</button>
      </div>
    </div>
  </div>`;
}

export function openMemoOverlay(seatNum: number) {
  closeMemoOverlay();
  memoOverlayTarget = seatNum;
  document.body.insertAdjacentHTML("beforeend", renderMemoOverlay(seatNum));
}

export function closeMemoOverlay() {
  memoOverlayTarget = null;
  const existing = document.querySelector("[data-memo-overlay]");
  if (existing) existing.remove();
}

export function renderActionsSection(state: GameState) {
  const body = updateSectionFrame("actions", "span-5", "panel-body");
  if (!body) return;
  const notices = state.actions.notices.map((n) => `<div class="notice">${escapeHtml(n)}</div>`).join("");
  const controls = state.actions.controls.map(c => actionControlHtml(state, c)).join("");
  updateHtml(body, `<div class="control-list">${notices}${controls}</div>`);
}

function syncChatRoot(root: HTMLElement, state: GameState, viewerId: string, chat: ChatThread, withHeading: boolean) {
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
    if (heading instanceof HTMLElement) heading.textContent = chat.title;
  } else if (root.className) {
    root.className = "";
  }

  const list = root.querySelector(".chat-list");
  if (list instanceof HTMLElement) list.dataset.channel = chat.channel;
  const footer = root.querySelector(".footer");

  if (list instanceof HTMLElement) {
    updateHtml(list, chatMessagesHtml(state, viewerId, chat));
  }
  if (footer instanceof HTMLElement) {
    updateHtml(footer, chatFooterHtml(chat));
  }
}

export function renderPublicSection(state: GameState) {
  const body = updateSectionFrame("public", "span-8", "panel-body");
  if (!body) return;
  let chatRoot = body.querySelector('[data-chat-root="public"]') as HTMLElement;
  if (!chatRoot) {
    body.innerHTML = '<div data-chat-root="public"></div>';
    chatRoot = body.querySelector('[data-chat-root="public"]') as HTMLElement;
  }
  syncChatRoot(chatRoot, state, state.viewer.userId, state.publicChat, false);
}

export function renderSecretSection(state: GameState) {
  const body = updateSectionFrame("secret", "span-7", "panel-body secret-stack");
  if (!body) return;
  if (state.secretChats.length === 0) {
    delete body.dataset.secretChannels;
    updateHtml(body, '<div class="line-item muted">현재 접근 가능한 비밀 채팅이 없습니다.</div>');
    return;
  }

  const channels = state.secretChats.map((c) => c.channel).join(",");
  if (body.dataset.secretChannels !== channels) {
    body.dataset.secretChannels = channels;
    body.innerHTML = state.secretChats.map((c) => '<div data-secret-chat-channel="' + c.channel + '"></div>').join("");
  }

  state.secretChats.forEach((chat) => {
    const chatRoot = body.querySelector('[data-secret-chat-channel="' + chat.channel + '"]') as HTMLElement;
    syncChatRoot(chatRoot, state, state.viewer.userId, chat, true);
  });
}

export function renderLogsSection(state: GameState) {
  const body = updateSectionFrame("logs", "span-12", "panel-body");
  if (!body) return;
  const statsHtml = buildPersonalStatsHtml(state.personalStats);
  const lines = state.systemLog.privateLines.length > 0
    ? state.systemLog.privateLines.map((l) => `<div class="line-item success"><strong>${formatClock(l.createdAt)}</strong><div>${escapeHtml(l.line)}</div></div>`).join("")
    : '<div class="line-item muted">개인 결과가 아직 없습니다.</div>';
  updateHtml(
    body,
    `<div class="personal-tab-stack">
      ${statsHtml}
      <section class="personal-block">
        <div class="personal-block-head">
          <h3>개인 로그</h3>
          <span>현재 판 진행 기록</span>
        </div>
        <div class="line-list">${lines}</div>
      </section>
    </div>`,
  );
}

export function ensureDashboardScaffold() {
  const app = document.getElementById("app");
  if (!app) return;
  if (!app.querySelector("[data-dashboard-grid]")) {
    app.innerHTML = `
      <div class="dashboard-grid" data-dashboard-grid>
        <section class="panel section-panel span-4" data-section="state"><div class="panel-head"><div><h2>현재 상태</h2></div></div><div class="panel-body viewer-stack" data-section-body="state"></div></section>
        <section class="panel section-panel span-8" data-section="public"><div class="panel-head"><div><h2>공개 채팅</h2></div></div><div class="panel-body" data-section-body="public"></div></section>
        <section class="panel section-panel span-5" data-section="actions"><div class="panel-head"><div><h2>개인 행동</h2></div></div><div class="panel-body" data-section-body="actions"></div></section>
        <section class="panel section-panel span-7" data-section="secret"><div class="panel-head"><div><h2>비밀 채팅</h2></div></div><div class="panel-body secret-stack" data-section-body="secret"></div></section>
        <section class="panel section-panel span-12" data-section="logs"><div class="panel-head"><div><h2>개인 기록</h2></div></div><div class="panel-body" data-section-body="logs"></div></section>
      </div>
    `;
  }
}

function phaseOverlayTitle(phase: string) {
  if (phase === "night") return "밤이 되었습니다";
  if (phase === "vote") return "투표 시간입니다";
  if (phase === "defense") return "최후의 변론";
  if (phase === "trial") return "찬반 투표";
  if (phase === "ended") return "게임 종료";
  return "아침이 밝았습니다";
}

export function renderNow(state: GameState) {
  const phaseChanged = currentPhaseStr !== state.room.phase;

  if (currentBgmPhase !== state.room.phase) {
    currentBgmPhase = state.room.phase;
    AudioManager.playBgm(bgmForPhase(state.room.phase));
  }

  if (phaseChanged) {
    currentPhaseStr = state.room.phase;
    showPhaseOverlay(currentPhaseStr, phaseOverlayTitle(currentPhaseStr));
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
  queueChatAutoscroll(chatScrollState);
  playNewAudioCues(state, { phaseChanged });
}

export function render(state: GameState) {
  if (pointerRenderLock || hasFocusedChatInput()) {
    pendingRenderState = state;
    return;
  }
  pendingRenderState = null;
  renderNow(state);
}

function buildPersonalStatsHtml(stats: GameState["personalStats"]): string {
  if (!stats.enabled) {
    return `
      <section class="personal-block">
        <div class="personal-block-head">
          <h3>플레이 전적</h3>
          <span>DB 미연결</span>
        </div>
        <div class="line-item muted">전적 DB가 아직 연결되지 않았습니다.</div>
      </section>
    `;
  }

  if (!stats.hasRecordedMatches) {
    return `
      <section class="personal-block">
        <div class="personal-block-head">
          <h3>플레이 전적</h3>
          <span>기록 없음</span>
        </div>
        <div class="line-item muted">완료된 게임 기록이 아직 없습니다. 현재 게임이 끝나면 여기부터 누적됩니다.</div>
      </section>
    `;
  }

  const summary = stats.summary;
  const summaryCards = [
    { label: "총 판수", value: String(summary.matchesPlayed), tone: "neutral" },
    { label: "승률", value: `${summary.winRatePercent}%`, tone: "accent" },
    { label: "승 / 패", value: `${summary.wins} / ${summary.losses}`, tone: "neutral" },
    { label: "마피아 / 시민 승", value: `${summary.mafiaWins} / ${summary.citizenWins}`, tone: "neutral" },
  ]
    .map(
      (card) => `
        <div class="stat-chip stat-chip--${card.tone}">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
        </div>
      `,
    )
    .join("");

  const roleStats = stats.roleStats.length > 0
    ? stats.roleStats.map((roleStat) => roleStatRow(roleStat)).join("")
    : '<div class="line-item muted">직업별 전적이 아직 없습니다.</div>';

  const recentMatches = stats.recentMatches.length > 0
    ? stats.recentMatches.map((match) => recentMatchCard(match)).join("")
    : '<div class="line-item muted">최근 경기 기록이 아직 없습니다.</div>';

  return `
    <section class="personal-block">
      <div class="personal-block-head">
        <h3>플레이 전적</h3>
        <span>Discord ID 기준 누적</span>
      </div>
      <div class="stat-chip-grid">${summaryCards}</div>
    </section>
    <section class="personal-block">
      <div class="personal-block-head">
        <h3>직업별 성적</h3>
        <span>누적 승률</span>
      </div>
      <div class="role-stat-list">${roleStats}</div>
    </section>
    <section class="personal-block">
      <div class="personal-block-head">
        <h3>최근 경기</h3>
        <span>최근 10판</span>
      </div>
      <div class="match-history-list">${recentMatches}</div>
    </section>
  `;
}

function roleStatRow(roleStat: PersonalRoleStat): string {
  return `
    <div class="role-stat-row">
      <div>
        <strong>${escapeHtml(roleStat.roleLabel)}</strong>
        <span>${roleStat.plays}판</span>
      </div>
      <div>
        <strong>${roleStat.winRatePercent}%</strong>
        <span>${roleStat.wins}승 ${roleStat.losses}패</span>
      </div>
    </div>
  `;
}

function recentMatchCard(match: PersonalRecentMatch): string {
  const guildLabel = match.guildName ? escapeHtml(match.guildName) : "이름 없는 서버";
  const outcomeClass = match.resultLabel === "승리" ? "match-card--win" : match.resultLabel === "패배" ? "match-card--lose" : "match-card--neutral";
  const finalRoleLine =
    match.finalRoleLabel !== match.originalRoleLabel
      ? `<span>최종 직업 ${escapeHtml(match.finalRoleLabel)}</span>`
      : "";
  const deathLine = match.survived
    ? `<span>생존</span>`
    : `<span>${escapeHtml(match.deathReason ?? "사망")}</span>`;

  return `
    <article class="match-card ${outcomeClass}">
      <div class="match-card-head">
        <div>
          <strong>${escapeHtml(match.resultLabel)}</strong>
          <span>${escapeHtml(match.statusLabel)} · ${escapeHtml(match.rulesetLabel)}</span>
        </div>
        <div>
          <strong>${escapeHtml(match.originalRoleLabel)}</strong>
          <span>${escapeHtml(match.teamLabel)}</span>
        </div>
      </div>
      <div class="match-card-meta">
        <span>${guildLabel}</span>
        <span>${formatDateTime(match.endedAt)}</span>
        <span>${match.playerCount}인</span>
        ${match.winnerTeamLabel ? `<span>승리팀 ${escapeHtml(match.winnerTeamLabel)}</span>` : ""}
        ${finalRoleLine}
        ${deathLine}
      </div>
      ${match.endedReason ? `<div class="match-card-reason">${escapeHtml(match.endedReason)}</div>` : ""}
    </article>
  `;
}
