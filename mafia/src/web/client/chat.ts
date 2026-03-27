import { GameState, ChatMessage, ChatThread } from "./types.js";
import { escapeHtml, formatClock, nicknameClassForUser } from "./ui-render.js"; // Wait, some of these might need to be imported

export const chatDrafts: Record<string, string> = Object.create(null);
export const pendingAutoscrollChannels = new Set<string>();

export function captureChatScrollState(): Record<string, { scrollTop: number, nearBottom: boolean }> {
  const snapshot: Record<string, { scrollTop: number, nearBottom: boolean }> = Object.create(null);
  document.querySelectorAll(".chat-list").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const channel = node.dataset.channel;
    if (!channel) return;
    if (node.clientHeight <= 0) return;

    const distanceFromBottom = node.scrollHeight - (node.scrollTop + node.clientHeight);
    snapshot[channel] = {
      scrollTop: node.scrollTop,
      nearBottom: distanceFromBottom <= 72,
    };
  });
  return snapshot;
}

export function restoreChatScrollState(snapshot: Record<string, { scrollTop: number, nearBottom: boolean }>) {
  document.querySelectorAll(".chat-list").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const channel = node.dataset.channel;
    if (!channel) return;

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

export function queueChatAutoscroll(snapshot: Record<string, { scrollTop: number, nearBottom: boolean }>) {
  requestAnimationFrame(() => {
    restoreChatScrollState(snapshot);
  });
}

export function captureChatDraftState(): { channel: string, start: number, end: number } | null {
  let focused: { channel: string, start: number, end: number } | null = null;
  document.querySelectorAll(".chat-form").forEach((form) => {
    if (!(form instanceof HTMLFormElement)) return;
    const input = form.elements.namedItem("content");
    if (!(input instanceof HTMLInputElement)) return;
    const channel = form.dataset.channel;
    if (!channel) return;

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

export function restoreChatDraftState(focused: { channel: string, start: number, end: number } | null) {
  document.querySelectorAll(".chat-form").forEach((form) => {
    if (!(form instanceof HTMLFormElement)) return;
    const input = form.elements.namedItem("content");
    if (!(input instanceof HTMLInputElement)) return;
    const channel = form.dataset.channel;
    if (!channel) return;

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

export function shouldContinueChat(previousMessage: ChatMessage | null | undefined, message: ChatMessage): boolean {
  if (!previousMessage || previousMessage.kind !== "player" || message.kind !== "player") {
    return false;
  }
  if (previousMessage.authorId !== message.authorId) {
    return false;
  }
  return Math.abs(message.createdAt - previousMessage.createdAt) <= 10000;
}

export function displayAuthorName(viewerId: string, message: ChatMessage): string {
  return message.authorId === viewerId ? "나" : (message.authorName || "?");
}

export function authorInitial(state: GameState, authorId?: string): string {
  const seat = state.room.seats.find((s) => s.userId === authorId);
  return seat ? String(seat.seat) : "?";
}

export function chatMessage(state: GameState, viewerId: string, message: ChatMessage, previousMessage?: ChatMessage | null) {
  if (message.kind === "system") {
    return `
      <div class="chat-row chat-row--system" data-message-id="${escapeHtml(message.id)}">
        <div class="chat-bubble chat-bubble--system">${escapeHtml(message.content)}</div>
      </div>
    `;
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
      : `<div class="chat-avatar ${nickClass}">${escapeHtml(authorInitial(state, message.authorId))}</div>`;
  const head = continued
    ? ""
    : `
        <div class="chat-head">
          <div class="chat-author ${nickClass}">${escapeHtml(displayAuthorName(viewerId, message))}</div>
          <div class="chat-meta">${formatClock(message.createdAt)}</div>
        </div>
      `;

  return `
    <div class="${rowClass}" data-message-id="${escapeHtml(message.id)}">
      ${avatar}
      <div class="${stackClass}">
        ${head}
        <div class="${bubbleClass}">${escapeHtml(message.content)}</div>
      </div>
    </div>
  `;
}

export function chatMessagesHtml(state: GameState, viewerId: string, chat: ChatThread) {
  return chat.messages.length > 0
    ? chat.messages
        .map((message, index) => chatMessage(state, viewerId, message, index > 0 ? chat.messages[index - 1] : null))
        .join("")
    : '<div class="line-item muted">아직 메시지가 없습니다.</div>';
}

export function chatFooterHtml(chat: ChatThread) {
  return chat.canWrite
    ? `
        <form class="chat-form" data-channel="${escapeHtml(chat.channel)}">
          <input name="content" maxlength="500" placeholder="${escapeHtml(chat.title)} 메시지 입력" />
          <button type="submit">전송</button>
        </form>
      `
    : '<div class="notice" style="text-align: center; color: var(--muted); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);">🔒 현재 이 채널에 쓸 수 없습니다.</div>';
}
