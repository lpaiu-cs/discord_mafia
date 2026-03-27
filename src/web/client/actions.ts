import { GameState, ActionControl } from "./types.js";
import { actionMarkerCssValueForRole } from "./action-markers.js";
import { escapeHtml, escapeAttribute, nicknameClassForUser } from "./ui-render.js";

export function captureActionDraftState(): { actionType: string, targetId: string }[] {
  const drafts: { actionType: string, targetId: string }[] = [];
  document.querySelectorAll(".action-form").forEach((form) => {
    if (!(form instanceof HTMLFormElement)) return;
    const actionType = form.dataset.actionType;
    const input = form.elements.namedItem("targetId");
    if (input instanceof HTMLInputElement && input.value && actionType) {
      drafts.push({ actionType, targetId: input.value });
    }
  });
  return drafts;
}

export function restoreActionDraftState(drafts: { actionType: string, targetId: string }[] | null) {
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
          gridCell.classList.add("is-draft-selected");
        }
      }
    }
  });
}

export function actionableControlCount(state: GameState): number {
  return state.actions.controls.filter((control) => control.actionType !== "noop").length;
}

export function actionControlHtml(state: GameState, control: ActionControl): string {
  if (control.type === "info") {
    return `<div class="control"><strong>${escapeHtml(control.title)}</strong><div class="muted">${escapeHtml(control.description)}</div></div>`;
  }

  if (control.type === "button") {
    return `
      <div class="control">
        <strong>${escapeHtml(control.title)}</strong>
        <div class="muted">${escapeHtml(control.description)}</div>
        <div class="button-row">
          <button type="button" data-action-type="${escapeHtml(control.actionType)}">${escapeHtml(control.title)}</button>
        </div>
      </div>
    `;
  }

  if (control.type === "buttons") {
    const isTrialVote = control.actionType === "trial_vote";
    const buttons = (control.buttons || [])
      .map(
        (button) => {
          const cls = isTrialVote ? (button.value === "yes" ? " vote-yes" : " vote-no") : "";
          return `<button type="button" class="${cls}" data-action-type="${escapeHtml(control.actionType)}" data-value="${escapeHtml(button.value)}">${escapeHtml(button.label)}</button>`;
        },
      )
      .join("");
    const current = control.currentLabel ? `<div class="footer">현재 선택: ${escapeHtml(control.currentLabel)}</div>` : "";
    return `
      <div class="control">
        <strong>${escapeHtml(control.title)}</strong>
        <div class="muted">${escapeHtml(control.description)}</div>
        <div class="button-row">${buttons}</div>
        ${current}
      </div>
    `;
  }

  const selectableValues = new Set((control.options || []).map((o) => o.value));
  const gridCells = state.room.seats.map((seat) => {
    const seatNum = seat.seat;
    const nickClass = seat.empty ? "" : nicknameClassForUser(state, seat.userId);
    const isSelectable = !seat.empty && !!seat.userId && selectableValues.has(seat.userId);
    const submitted = !seat.empty && control.currentValue === seat.userId ? " is-submitted" : "";
    const disabledCls = (!isSelectable) ? " is-disabled" : "";
    const label = seat.empty ? "빈 자리" : seat.displayName;
    const deadCls = (!seat.empty && !seat.alive) ? " is-dead-cell" : "";
    const markerCssValue = actionMarkerCssValueForRole(state.viewer.role);
    const markerStyle = markerCssValue && (isSelectable || submitted)
      ? ` style="--action-marker-url:${escapeAttribute(markerCssValue)}"`
      : "";

    return `<div class="action-grid-cell${submitted}${disabledCls}${deadCls}"${isSelectable ? ` data-grid-value="${escapeHtml(seat.userId || "")}" data-action-type="${escapeHtml(control.actionType)}" data-action="${escapeHtml(control.action || "")}"` : ""}${markerStyle}>
      <div class="action-grid-avatar-wrap">
        <div class="action-grid-avatar ${nickClass}">${seatNum}</div>
      </div>
      <div class="action-grid-name">${escapeHtml(label || "")}</div>
    </div>`;
  }).join("");
  
  const current = control.currentLabel ? `<div class="footer">현재 선택: ${escapeHtml(control.currentLabel)}</div>` : "";
  return `
    <div class="control">
      <strong>${escapeHtml(control.title)}</strong>
      <div class="muted">${escapeHtml(control.description)}</div>
      <div class="action-grid" data-action-type="${escapeHtml(control.actionType)}" data-action="${escapeHtml(control.action || "")}">${gridCells}</div>
      <form class="action-form" data-action-type="${escapeHtml(control.actionType)}" data-action="${escapeHtml(control.action || "")}" style="margin-top:8px">
        <input type="hidden" name="targetId" value="${escapeHtml(control.currentValue || "")}" />
        <button type="submit"${control.currentValue ? "" : " disabled"}>제출</button>
      </form>
      ${current}
    </div>
  `;
}
