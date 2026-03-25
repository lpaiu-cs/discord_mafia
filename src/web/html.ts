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
        transition: background 0.8s ease;
      }

      /* Phase 2-A: Phase-specific ambient backgrounds */
      body[data-phase="night"] {
        background:
          radial-gradient(circle at top left, rgba(60, 80, 180, 0.15), transparent 30%),
          radial-gradient(circle at bottom right, rgba(100, 60, 160, 0.1), transparent 28%),
          linear-gradient(145deg, #040408 0%, #0a0a14 42%, #10101c 100%);
      }

      body[data-phase="discussion"] {
        background:
          radial-gradient(circle at top left, rgba(245, 200, 100, 0.14), transparent 30%),
          radial-gradient(circle at bottom right, rgba(200, 160, 60, 0.08), transparent 26%),
          linear-gradient(145deg, #0a0906 0%, #121008 42%, #181610 100%);
      }

      body[data-phase="vote"] {
        background:
          radial-gradient(circle at top left, rgba(255, 160, 80, 0.14), transparent 30%),
          radial-gradient(circle at bottom right, rgba(255, 120, 60, 0.1), transparent 26%),
          linear-gradient(145deg, #0a0806 0%, #12100a 42%, #181410 100%);
      }

      body[data-phase="defense"],
      body[data-phase="trial"] {
        background:
          radial-gradient(circle at top left, rgba(255, 80, 80, 0.14), transparent 30%),
          radial-gradient(circle at bottom right, rgba(200, 40, 40, 0.1), transparent 26%),
          linear-gradient(145deg, #0a0606 0%, #120a0a 42%, #181010 100%);
      }

      body[data-phase="ended"] {
        background:
          radial-gradient(circle at top left, rgba(150, 150, 150, 0.1), transparent 30%),
          radial-gradient(circle at bottom right, rgba(100, 100, 100, 0.06), transparent 26%),
          linear-gradient(145deg, #080808 0%, #0e0e0e 42%, #141414 100%);
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

      #hero-subtitle {
        display: none;
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
        animation: section-fade-in 0.22s ease-out;
      }

      @keyframes section-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
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
        gap: 7px;
        height: 100%;
        max-height: none;
        overflow: auto;
        padding: 2px 2px 1px;
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
        flex-direction: column;
        justify-content: flex-end;
        aspect-ratio: 1 / 1;
        padding: 6px 6px 6px;
        overflow: visible;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 12px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03)),
          rgba(18, 18, 20, 0.82);
        transition: transform 0.1s, box-shadow 0.15s;
        cursor: pointer;
      }

      .seat-card:active {
        transform: scale(0.95);
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
        line-height: 1.15;
        word-break: break-all;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
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
        gap: 9px;
        height: 420px;
      }

      .chat-row {
        display: flex;
        align-items: flex-end;
        gap: 7px;
      }

      .chat-row--mine {
        justify-content: flex-end;
      }

      .chat-row--system {
        justify-content: center;
      }

      .chat-row--continued {
        margin-top: -3px;
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

      .chat-avatar--ghost {
        visibility: hidden;
      }

      .chat-stack {
        display: grid;
        gap: 2px;
        max-width: min(78%, 480px);
      }

      .chat-stack--mine {
        justify-items: end;
      }

      .chat-head {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 0 2px;
      }

      .chat-stack--mine .chat-head {
        justify-content: flex-end;
      }

      .chat-author {
        font-size: 0.75rem;
        line-height: 1.2;
      }

      .chat-bubble {
        padding: 9px 12px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 19px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--text);
        line-height: 1.38;
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
        max-width: min(88%, 540px);
        padding: 2px 8px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #aeb8c8;
        font-size: 0.74rem;
        line-height: 1.45;
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
        font-size: 0.8rem;
        line-height: 1.2;
        opacity: 0.9;
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
        transition: transform 0.1s, opacity 0.1s;
      }

      button:active:not([disabled]) {
        transform: scale(0.96);
        opacity: 0.85;
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
        padding: 6px 4px;
        border: 0;
        border-radius: 16px;
        background: transparent;
        color: var(--muted);
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: transform 0.1s, background 0.2s, color 0.2s;
      }

      .dock-button:active {
        transform: scale(0.92);
      }

      .dock-icon {
        display: block;
        font-size: 1.1rem;
        margin-bottom: 2px;
        pointer-events: none;
      }

      .dock-button strong {
        display: block;
        font-size: 0.75rem;
        pointer-events: none;
      }

      .dock-badge {
        position: absolute;
        top: 2px;
        right: 4px;
        min-width: 16px;
        padding: 1px 4px;
        border-radius: 999px;
        background: #ff4747;
        color: #ffffff;
        font-size: 0.7rem;
        font-weight: 800;
        line-height: 1.2;
        pointer-events: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.5);
        animation: badge-pulse 2s ease-in-out infinite;
      }

      @keyframes badge-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
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

      .endgame-card {
        border-width: 1px;
      }

      .endgame-card--win {
        border-color: rgba(117, 209, 162, 0.28);
        background: rgba(117, 209, 162, 0.12);
      }

      .endgame-card--lose {
        border-color: rgba(255, 113, 113, 0.26);
        background: rgba(255, 113, 113, 0.12);
      }

      .reveal-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .reveal-card {
        padding: 12px 13px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
      }

      .reveal-card--mafia {
        border-color: var(--mafia-border);
        background: rgba(255, 115, 115, 0.1);
      }

      .reveal-card--citizen {
        border-color: var(--citizen-border);
        background: rgba(115, 160, 255, 0.08);
      }

      .reveal-name {
        margin: 0 0 6px;
        font-size: 0.95rem;
        font-weight: 800;
      }

      .reveal-role {
        color: var(--text);
        font-size: 0.86rem;
        line-height: 1.35;
      }

      .reveal-meta {
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.78rem;
        line-height: 1.35;
      }

      /* Phase 1: Phase label chip */
      .phase-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 36px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 0.84rem;
        font-weight: 700;
        border: 1px solid;
      }

      .phase-chip--night {
        background: rgba(60, 80, 160, 0.22);
        border-color: rgba(100, 130, 220, 0.32);
        color: #a8c4ff;
      }

      .phase-chip--discussion {
        background: rgba(245, 180, 95, 0.18);
        border-color: rgba(245, 200, 120, 0.32);
        color: #ffe0a8;
      }

      .phase-chip--vote {
        background: rgba(255, 140, 80, 0.18);
        border-color: rgba(255, 160, 100, 0.3);
        color: #ffd0b0;
      }

      .phase-chip--defense {
        background: rgba(255, 100, 100, 0.18);
        border-color: rgba(255, 120, 120, 0.3);
        color: #ffc0c0;
      }

      .phase-chip--trial {
        background: rgba(200, 60, 60, 0.22);
        border-color: rgba(220, 80, 80, 0.35);
        color: #ffb0b0;
      }

      .phase-chip--ended {
        background: rgba(120, 120, 120, 0.18);
        border-color: rgba(160, 160, 160, 0.3);
        color: #c8c8c8;
      }

      .phase-chip--lobby {
        background: rgba(120, 200, 160, 0.15);
        border-color: rgba(140, 210, 170, 0.3);
        color: #b0e8cc;
      }

      /* Phase 1: Hero border glow per phase */
      .hero.hero--night {
        border-color: rgba(80, 110, 200, 0.3);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(100, 140, 230, 0.12);
      }

      .hero.hero--discussion {
        border-color: rgba(245, 190, 100, 0.3);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(245, 200, 120, 0.12);
      }

      .hero.hero--vote {
        border-color: rgba(255, 150, 90, 0.3);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 160, 100, 0.12);
      }

      .hero.hero--defense,
      .hero.hero--trial {
        border-color: rgba(220, 80, 80, 0.3);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(230, 100, 100, 0.12);
      }

      /* Phase 1: Timer progress bar */
      .timer-chip {
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

      .timer-chip strong {
        color: var(--text);
        font-size: 0.9rem;
      }

      .timer-bar {
        position: relative;
        width: 40px;
        height: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }

      .timer-bar-fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        border-radius: 3px;
        background: linear-gradient(90deg, var(--accent), var(--accent-strong));
        transition: width 1s linear;
      }

      .timer-bar-fill.is-urgent {
        background: linear-gradient(90deg, var(--danger), #ff4040);
      }

      /* Phase 2: Seat avatar – top-left badge style */
      .seat-avatar {
        position: absolute;
        top: 4px;
        left: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        font-size: 0.6rem;
        font-weight: 800;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.12);
        z-index: 5;
      }

      .seat-card.is-dead .seat-avatar {
        opacity: 0.4;
      }

      .seat-dead-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -60%);
        font-size: 1.1rem;
        z-index: 5;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
        pointer-events: none;
      }

      .seat-card.is-viewer {
        border-color: rgba(245, 180, 95, 0.42);
        box-shadow: inset 0 0 0 1px rgba(245, 180, 95, 0.16), 0 0 10px rgba(245, 180, 95, 0.12);
      }

      /* Phase 3: Action grid selector */
      .action-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }

      .action-grid-cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 10px 4px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s, transform 0.1s;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      .action-grid-cell:active:not(.is-disabled) {
        transform: scale(0.95);
      }

      .action-grid-cell:hover {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.07);
      }

      .action-grid-cell.is-disabled {
        opacity: 0.3;
        pointer-events: none;
        cursor: default;
      }

      .action-grid-cell.is-dead-cell {
        opacity: 0.35;
        pointer-events: none;
      }

      .action-grid-cell.is-selected {
        border-color: rgba(245, 180, 95, 0.5);
        background: rgba(245, 180, 95, 0.12);
        box-shadow: 0 0 8px rgba(245, 180, 95, 0.15);
      }

      .action-grid-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.78rem;
        font-weight: 800;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      /* Memo feature styles */
      .seat-memo {
        position: absolute;
        top: 2px;
        left: 50%;
        transform: translateX(-50%);
        width: 70%;
        aspect-ratio: 1 / 1;
        border-radius: 8px;
        overflow: hidden;
        z-index: 2;
        pointer-events: none;
      }

      .seat-memo img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
        opacity: 0.88;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
      }

      .seat-memo--empty {
        display: none;
      }

      .memo-overlay {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(6px);
        animation: memo-fade-in 0.18s ease-out;
      }

      @keyframes memo-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes memo-slide-up {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }

      .memo-sheet {
        width: 100%;
        max-width: 420px;
        max-height: 80vh;
        overflow-y: auto;
        padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
        border-radius: 20px 20px 0 0;
        border: 1px solid var(--border);
        border-bottom: 0;
        background: linear-gradient(180deg, rgba(22, 22, 26, 0.98), rgba(14, 14, 16, 0.99));
        box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
        animation: memo-slide-up 0.22s ease-out;
      }

      .memo-sheet-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
      }

      .memo-sheet-head h3 {
        margin: 0;
        font-size: 1rem;
      }

      .memo-close-btn {
        width: 36px !important;
        min-width: 36px !important;
        min-height: 36px !important;
        padding: 0 !important;
        border-radius: 50% !important;
        background: rgba(255, 255, 255, 0.1) !important;
        color: var(--text) !important;
        font-size: 1.1rem !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      .memo-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .memo-role-cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        padding: 10px 4px 8px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s, transform 0.1s;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      .memo-role-cell:hover {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.07);
      }

      .memo-role-cell:active {
        transform: scale(0.95);
      }

      .memo-role-cell.is-selected {
        border-color: rgba(245, 180, 95, 0.5);
        background: rgba(245, 180, 95, 0.12);
        box-shadow: 0 0 8px rgba(245, 180, 95, 0.15);
      }

      .memo-role-cell.is-mafia-role {
        border-color: rgba(255, 115, 115, 0.15);
      }

      .memo-role-cell.is-mafia-role.is-selected {
        border-color: rgba(255, 115, 115, 0.5);
        background: rgba(255, 115, 115, 0.12);
        box-shadow: 0 0 8px rgba(255, 115, 115, 0.15);
      }

      .memo-role-icon {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        object-fit: cover;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .memo-role-name {
        font-size: 0.65rem;
        font-weight: 700;
        text-align: center;
        line-height: 1.15;
        color: var(--muted);
      }

      .memo-role-cell.is-selected .memo-role-name {
        color: var(--text);
      }

      .memo-clear-row {
        margin-top: 10px;
      }

      .memo-clear-row button {
        background: rgba(255, 255, 255, 0.08) !important;
        color: var(--muted) !important;
        font-weight: 600 !important;
        min-height: 42px !important;
      }

      .action-grid-name {
        font-size: 0.68rem;
        font-weight: 700;
        text-align: center;
        line-height: 1.15;
        word-break: break-all;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* Phase 3: Trial vote button colors */
      button.vote-yes {
        background: linear-gradient(145deg, #ff6b6b, #e84545);
        color: #fff;
      }

      button.vote-no {
        background: linear-gradient(145deg, #5b8def, #3d6dd8);
        color: #fff;
      }

      /* Phase 4: System message left bar */
      .chat-bubble--system {
        position: relative;
        padding-left: 14px;
        text-align: left;
        border-left: 3px solid var(--accent);
        border-radius: 4px;
      }

      /* Phase 4: Secret chat channel themes */
      .secret-chat--mafia .panel-head h3 { color: #ff7171; }
      .secret-chat--lover .panel-head h3 { color: #ff94d1; }
      .secret-chat--graveyard .panel-head h3 { color: #9ca8b8; }

      .secret-chat--mafia { border-color: rgba(255, 115, 115, 0.2); }
      .secret-chat--lover { border-color: rgba(255, 148, 209, 0.2); }
      .secret-chat--graveyard { border-color: rgba(156, 168, 184, 0.2); }

      /* ── Phase 1: Toast notification ── */
      .toast-container {
        position: fixed;
        top: calc(12px + env(safe-area-inset-top));
        left: 50%;
        transform: translateX(-50%);
        z-index: 200;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        pointer-events: none;
        width: min(92%, 420px);
      }

      .toast-item {
        padding: 10px 18px;
        border-radius: 14px;
        font-size: 0.84rem;
        font-weight: 700;
        line-height: 1.35;
        text-align: center;
        pointer-events: auto;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
        animation: toast-in 0.25s ease-out, toast-out 0.3s ease-in forwards;
        animation-delay: 0s, 2.2s;
      }

      .toast-item--success {
        background: rgba(60, 170, 110, 0.92);
        color: #f0fff5;
        border: 1px solid rgba(117, 209, 162, 0.3);
      }

      .toast-item--error {
        background: rgba(200, 55, 55, 0.92);
        color: #fff0f0;
        border: 1px solid rgba(255, 113, 113, 0.3);
      }

      .toast-item--info {
        background: rgba(40, 60, 120, 0.92);
        color: #e0ecff;
        border: 1px solid rgba(100, 150, 240, 0.3);
      }

      @keyframes toast-in {
        from { opacity: 0; transform: translateY(-16px) scale(0.92); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes toast-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-12px) scale(0.95); }
      }

      /* ── Phase 1: Timer urgency pulse ── */
      .timer-chip.is-urgent {
        border-color: rgba(255, 80, 80, 0.3);
        background: rgba(255, 60, 60, 0.14);
        color: #ffaaaa;
      }

      .timer-chip.is-urgent strong {
        color: #ff8888;
      }

      @keyframes timer-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.55; }
      }

      .timer-chip.is-critical {
        animation: timer-pulse 0.8s ease-in-out infinite;
        border-color: rgba(255, 50, 50, 0.45);
        background: rgba(255, 40, 40, 0.2);
        color: #ff9090;
      }

      .timer-chip.is-critical strong {
        color: #ff6060;
      }

      /* ── Phase 1: Button loading state ── */
      button.is-loading {
        position: relative;
        color: transparent !important;
        pointer-events: none;
      }

      button.is-loading::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 18px;
        height: 18px;
        margin: -9px 0 0 -9px;
        border: 2px solid rgba(0, 0, 0, 0.2);
        border-top-color: currentColor;
        border-radius: 50%;
        animation: btn-spin 0.6s linear infinite;
      }

      @keyframes btn-spin {
        to { transform: rotate(360deg); }
      }

      @media (min-width: 960px) {
        .shell {
          width: min(1280px, calc(100vw - 44px));
          padding: 22px 20px 36px;
        }

        #hero-subtitle {
          display: block;
        }

        .seat-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
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

        .reveal-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
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
    <div class="toast-container" id="toast-container"></div>
    <script id="initial-state" type="application/json">${stateJson}</script>
    <script>
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
      const seatMemos = Object.create(null);
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
        return "/resource/" + key + "_icon.svg";
      }
      let currentState = initialState;
      let sinceVersion = initialState.version;
      let pollTimer = null;
      let deadlineTimer = null;
      let syncedServerNowMs = initialState.serverNow;
      let syncedClientPerfMs = performance.now();
      let activeSection = "actions";
      const chatDrafts = Object.create(null);
      const pendingAutoscrollChannels = new Set();

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

        /* Timer chip urgency */
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

          const distanceFromBottom = node.scrollHeight - (node.scrollTop + node.clientHeight);
          snapshot[channel] = {
            scrollTop: node.scrollTop,
            nearBottom: distanceFromBottom <= 28,
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
        const heroTitle = document.getElementById("hero-title");
        heroTitle.textContent = state.viewer.displayName;
        heroTitle.className = nicknameClassForUser(state, state.viewer.userId);
        document.getElementById("hero-subtitle").textContent = \`게임 ID \${state.room.gameId}\`;

        const heroEl = document.querySelector(".hero");
        heroEl.className = "hero hero--" + phase;

        document.getElementById("hero-meta").innerHTML = [
          \`<div class="phase-chip phase-chip--\${phase}">\${escapeHtml(phaseDisplayText(state))}</div>\`,
          \`<div class="meta-chip role-chip role-chip--\${team}"><strong>\${escapeHtml(state.viewer.roleLabel)}</strong></div>\`,
          \`<div class="timer-chip"><strong data-live-deadline>\${escapeHtml(formatDeadline(state.room.deadlineAt))}</strong><div class="timer-bar" data-timer-total="\${state.room.deadlineAt ? 300 : 0}"><div class="timer-bar-fill" data-live-timer-fill></div></div></div>\`,
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
                  <span class="dock-icon">\${section.icon}</span>
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

          return \`<div class="action-grid-cell\${selected}\${disabledCls}\${deadCls}"\${isSelectable ? \` data-grid-value="\${escapeHtml(seat.userId)}" data-action-type="\${escapeHtml(control.actionType)}" data-action="\${escapeHtml(control.action || "")}"\` : ""}>
            <div class="action-grid-avatar \${nickClass}">\${seatNum}</div>
            <div class="action-grid-name">\${escapeHtml(label)}</div>
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

      function chatSection(state, viewerId, chat, withHeading) {
        const messages =
          chat.messages.length > 0
            ? chat.messages
                .map((message, index) => chatMessage(state, viewerId, message, index > 0 ? chat.messages[index - 1] : null))
                .join("")
            : '<div class="line-item muted">아직 메시지가 없습니다.</div>';

        const form = chat.canWrite
          ? \`
              <form class="chat-form" data-channel="\${escapeHtml(chat.channel)}">
                <input name="content" maxlength="500" placeholder="\${escapeHtml(chat.title)} 메시지 입력" />
                <button type="submit">전송</button>
              </form>
            \`
          : '<div class="notice" style="text-align: center; color: var(--muted); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);">🔒 현재 이 채널에 쓸 수 없습니다.</div>';

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
              <div class="chat-list" data-channel="\${escapeHtml(chat.channel)}">\${messages}</div>
              <div class="footer">\${form}</div>
            </div>
          </div>
        \`;
      }

      function sectionClass(sectionId) {
        return \`panel section-panel \${sectionId === activeSection ? "is-active" : ""}\`;
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
        const deadIcon = !seat.alive ? '<span class="seat-dead-icon">💀</span>' : '';

        return \`
          <div class="\${classes.join(" ")}" data-memo-seat="\${seat.seat}">
            <div class="seat-avatar \${nickClass}">\${seat.seat}</div>
            <div class="seat-flags" style="position:absolute;top:26px;left:4px;z-index:4;flex-direction:column;">\${flags.join("")}</div>
            \${seatMemoHtml(seat.seat)}
            \${deadIcon}
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
        const focusedChat = captureChatDraftState();
        const chatScrollState = captureChatScrollState();
        ensureActiveSection(state);
        renderHero(state);
        renderMobileDock(state);

        const team = teamClass(state);
        const notices = state.actions.notices.map((notice) => \`<div class="notice">\${escapeHtml(notice)}</div>\`).join("");
        const controls = state.actions.controls.map(actionControl).join("");
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
        const endedSummary = state.endedSummary
          ? \`
              <div class="viewer-card endgame-card\${state.endedSummary.viewerResultLabel === "승리" ? " endgame-card--win" : state.endedSummary.viewerResultLabel === "패배" ? " endgame-card--lose" : ""}">
                <strong>최종 결과</strong>
                <div>\${escapeHtml(state.endedSummary.winnerLabel ?? state.endedSummary.reason ?? "게임 종료")}</div>
                \${state.endedSummary.reason && state.endedSummary.reason !== state.endedSummary.winnerLabel ? \`<div class="footer">\${escapeHtml(state.endedSummary.reason)}</div>\` : ""}
                \${state.endedSummary.viewerResultLabel ? \`<div class="footer">내 결과: \${escapeHtml(state.endedSummary.viewerResultLabel)}</div>\` : ""}
              </div>
              <div class="reveal-grid">\${state.endedSummary.revealedPlayers.map((revealed) => revealCard(state, revealed)).join("")}</div>
            \`
          : "";

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
                  <div style="display:flex;gap:12px;align-items:flex-start;">
                    <img src="\${roleIconUrl(state.viewer.roleLabel === '마피아' ? 'mafia' : state.viewer.roleLabel === '스파이' ? 'spy' : state.viewer.roleLabel === '짐승인간' ? 'beastman' : state.viewer.roleLabel === '마담' ? 'madam' : state.viewer.roleLabel === '경찰' ? 'police' : state.viewer.roleLabel === '의사' ? 'doctor' : state.viewer.roleLabel === '군인' ? 'soldier' : state.viewer.roleLabel === '정치인' ? 'politician' : state.viewer.roleLabel === '영매' ? 'medium' : state.viewer.roleLabel === '연인' ? 'lover' : state.viewer.roleLabel === '건달' ? 'thug' : state.viewer.roleLabel === '기자' ? 'reporter' : state.viewer.roleLabel === '탐정' ? 'detective' : state.viewer.roleLabel === '도굴꾼' ? 'graverobber' : state.viewer.roleLabel === '테러리스트' ? 'terrorist' : state.viewer.roleLabel === '성직자' ? 'priest' : 'citizen')}" alt="" style="width:42px;height:42px;border-radius:10px;object-fit:contain;flex-shrink:0;opacity:0.92;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));" />
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
                    <div data-live-deadline>\${escapeHtml(formatDeadline(state.room.deadlineAt))}</div>
                  </div>
                  <div class="mini-card">
                    <strong>행동</strong>
                    <div>\${actionableControlCount(state)}개 가능</div>
                  </div>
                </div>
                <div class="seat-grid">\${state.room.seats.map((seat) => seatCard(state, seat)).join("")}</div>
                \${state.room.currentTrialTargetName ? \`<div class="line-item"><strong>현재 대상</strong><div>\${escapeHtml(state.room.currentTrialTargetName)}</div></div>\` : ""}
                \${endedSummary}
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
                  <h2>개인 기록</h2>
                </div>
              </div>
              <div class="panel-body">
                <div class="line-list">\${privateLines}</div>
              </div>
            </section>
          </div>
        \`;
        restoreChatDraftState(focusedChat);
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
              pendingAutoscrollChannels.add(channel);
            }
            await refreshState();
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
