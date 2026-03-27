import { 
  currentState,
  refreshState,
  postJson,
  connectWebSocket,
  schedulePolling,
  scheduleDeadlineTicker,
  syncServerClock,
  initialPayload
} from "./state-sync.js";

import { chatDrafts, pendingAutoscrollChannels } from "./chat.js";

import {
  showToast,
  AudioManager,
  AUDIO_FILES,
  preloadAudio,
  holdRenderDuringPointer,
  releaseRenderAfterPointer,
  flushPendingRender,
  render,
  ensureActiveSection,
  seatMemos,
  saveMemos,
  closeMemoOverlay,
  openMemoOverlay,
  memoOverlayTarget,
  setActiveSection
} from "./ui-render.js";

document.body.addEventListener("pointerdown", (event) => {
  holdRenderDuringPointer();
  preloadAudio();
  const target = event.target;
  if (target instanceof Element && target.closest('button, .action-grid-cell, .memo-role-cell, .dock-button')) {
    AudioManager.playSfx(AUDIO_FILES.click);
  }
}, { capture: true });

document.addEventListener("pointerup", releaseRenderAfterPointer, true);
document.addEventListener("pointercancel", releaseRenderAfterPointer, true);
document.addEventListener("focusout", () => {
  setTimeout(flushPendingRender, 0);
}, true);
window.addEventListener("blur", releaseRenderAfterPointer);

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.classList.add("is-loading");

  try {
    if (form.classList.contains("action-form")) {
      const data = new FormData(form);
      await postJson(`/api/game/${encodeURIComponent(currentState.room.gameId)}/actions`, {
        actionType: form.dataset.actionType,
        action: form.dataset.action || undefined,
        targetId: data.get("targetId"),
      });
      showToast("행동을 제출했습니다", "success");
      AudioManager.playSfx(AUDIO_FILES.action);
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
      await postJson(`/api/game/${encodeURIComponent(currentState.room.gameId)}/chats/${encodeURIComponent(channel || "")}`, {
        content,
      });
    }
  } catch (error: any) {
    showToast(error.message || "요청 실패", "error");
    AudioManager.playSfx(AUDIO_FILES.error);
  } finally {
    if (submitBtn) submitBtn.classList.remove("is-loading");
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.name !== "content") return;
  const form = target.form;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains("chat-form")) return;
  const channel = form.dataset.channel;
  if (!channel) return;

  if (target.value) {
    chatDrafts[channel] = target.value;
  } else {
    delete chatDrafts[channel];
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

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
      gridParent.querySelectorAll(".action-grid-cell").forEach((c) => c.classList.remove("is-draft-selected"));
      gridCell.classList.add("is-draft-selected");
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
  if (!(button instanceof HTMLButtonElement)) return;

  const navSection = button.dataset.navSection;
  if (navSection) {
    setActiveSection(navSection);
    render(currentState);
    return;
  }

  const actionType = button.dataset.actionType;
  if (!actionType || button.type === "submit") return;

  try {
    await postJson(`/api/game/${encodeURIComponent(currentState.room.gameId)}/actions`, {
      actionType,
      value: button.dataset.value || undefined,
    });
    await refreshState();
  } catch (error: any) {
    showToast(error.message || "요청 실패", "error");
    AudioManager.playSfx(AUDIO_FILES.error);
  }
});

document.addEventListener("visibilitychange", () => {
   if (!document.hidden) connectWebSocket(); // reconnect handles internally
   schedulePolling();
});

// Init
ensureActiveSection(currentState);
syncServerClock(initialPayload.serverNow);
render(currentState);
connectWebSocket();
schedulePolling();
scheduleDeadlineTicker();
