import { ActionControl, GameState } from "./types.js";

export interface SeatActionMarker {
  iconUrl: string;
  label: string;
}

export type SeatActionMarkerMap = Record<string, SeatActionMarker[]>;

const ACTION_ICON_KEY_BY_ROLE: Record<string, string> = {
  mafia: "mafia",
  spy: "spy",
  beastman: "beastman",
  madam: "hostess",
  police: "police",
  doctor: "doctor",
  medium: "medium",
  thug: "gangster",
  reporter: "reporter",
  detective: "detective",
  priest: "priest",
  terrorist: "terrorist",
};

export function collectSeatActionMarkers(state: GameState): SeatActionMarkerMap {
  const iconUrl = actionIconUrlForRole(state.viewer.role);
  if (!iconUrl) {
    return Object.create(null) as SeatActionMarkerMap;
  }

  const markers: SeatActionMarkerMap = Object.create(null);
  for (const control of state.actions.controls) {
    if (!isTargetedSelectControl(control)) {
      continue;
    }

    const targetId = control.currentValue;
    if (!markers[targetId]) {
      markers[targetId] = [];
    }

    markers[targetId].push({
      iconUrl,
      label: control.currentLabel ? `${control.title}: ${control.currentLabel}` : control.title,
    });
  }

  return markers;
}

export function actionIconUrlForRole(role: string): string | null {
  const iconKey = ACTION_ICON_KEY_BY_ROLE[role];
  if (!iconKey) {
    return null;
  }

  return `/resource/actions/${iconKey}_action.png`;
}

export function actionMarkerCssValueForRole(role: string): string | null {
  const iconUrl = actionIconUrlForRole(role);
  return iconUrl ? `url(${iconUrl})` : null;
}

function isTargetedSelectControl(control: ActionControl): control is ActionControl & { currentValue: string } {
  return control.type === "select" && typeof control.currentValue === "string" && control.currentValue.length > 0;
}
