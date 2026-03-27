import { GameState, InitialPayload } from "./types.js";
import { render } from "./ui-render.js";
import { updateDeadlineDisplays } from "./ui-render.js";

const initialDataNode = document.getElementById("initial-state");
export const initialPayload: InitialPayload = initialDataNode ? JSON.parse(initialDataNode.textContent || "{}") : {} as any;
export const csrfToken: string = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";

export let currentState: GameState = initialPayload as GameState;
export let sinceVersion: number = initialPayload.version;
export let syncedServerNowMs: number = initialPayload.serverNow;
export let syncedClientPerfMs: number = performance.now();

export let pollTimer: number | null = null;
export let deadlineTimer: number | null = null;
export let ws: WebSocket | null = null;
let wsReconnectTimer: number | null = null;

export function syncServerClock(serverNow: number) {
  if (typeof serverNow === "number") {
    syncedServerNowMs = serverNow;
    syncedClientPerfMs = performance.now();
  }
}

export function estimateServerNow(): number {
  return syncedServerNowMs + (performance.now() - syncedClientPerfMs);
}

export function setCurrentState(state: GameState, version: number) {
  currentState = state;
  sinceVersion = version;
}

export async function refreshState() {
  if (!currentState?.room?.gameId) return;
  try {
    const response = await fetch(`/api/game/${encodeURIComponent(currentState.room.gameId)}/state?sinceVersion=${encodeURIComponent(String(sinceVersion))}`, {
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
      setCurrentState(payload.state, payload.version);
      render(currentState);
    } else {
      sinceVersion = payload.version;
      scheduleDeadlineTicker();
    }
  } catch (error) {
    console.error(error);
  }
}

export function schedulePolling() {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  const isWsOpen = ws && ws.readyState === WebSocket.OPEN;
  const interval = isWsOpen ? 15000 : (document.hidden ? 8000 : 3000);
  pollTimer = window.setTimeout(async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      await refreshState();
    }
    schedulePolling();
  }, interval);
}

export function scheduleDeadlineTicker() {
  if (deadlineTimer !== null) {
    window.clearTimeout(deadlineTimer);
    deadlineTimer = null;
  }

  updateDeadlineDisplays();

  const deadlineAt = currentState?.room?.deadlineAt;
  if (!deadlineAt) return;

  const remaining = Math.max(0, deadlineAt - estimateServerNow());
  if (remaining <= 0) return;

  const untilNextSecond = remaining % 1000 || 1000;
  deadlineTimer = window.setTimeout(scheduleDeadlineTicker, Math.max(40, untilNextSecond + 12));
}

export function connectWebSocket() {
  if (ws) return;
  if (!currentState?.room?.gameId) return;
  
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + location.host + '/api/game/' + encodeURIComponent(currentState.room.gameId) + '/ws';
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    if (wsReconnectTimer !== null) {
      window.clearTimeout(wsReconnectTimer);
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
          setCurrentState(msg.payload.state, msg.payload.version);
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
    wsReconnectTimer = window.setTimeout(connectWebSocket, 2000);
  };
}

export async function postJson(url: string, body: any) {
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
