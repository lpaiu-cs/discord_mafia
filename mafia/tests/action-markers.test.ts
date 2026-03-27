import assert from "node:assert/strict";
import { test } from "node:test";
import { actionMarkerCssValueForRole, collectSeatActionMarkers } from "../src/web/client/action-markers";
import { GameState } from "../src/web/client/types";

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    room: {
      gameId: "game-1",
      rulesetLabel: "시즌4 밸런스",
      phase: "night",
      phaseLabel: "밤",
      dayNumber: 0,
      nightNumber: 1,
      deadlineAt: null,
      currentTrialTargetName: null,
      seats: [
        { seat: 1, empty: false, userId: "u1", displayName: "나", alive: true, bullied: false, ascended: false, isViewer: true },
        { seat: 2, empty: false, userId: "u2", displayName: "대상", alive: true, bullied: false, ascended: false, isViewer: false },
      ],
      alivePlayers: [
        { userId: "u1", displayName: "나", bullied: false },
        { userId: "u2", displayName: "대상", bullied: false },
      ],
      deadPlayers: [],
    },
    viewer: {
      userId: "u1",
      displayName: "나",
      role: "mafia",
      roleLabel: "마피아",
      roleSummary: "summary",
      teamLabel: "마피아팀",
      alive: true,
      contacted: false,
      loverName: null,
      deadReason: null,
      ascended: false,
    },
    publicLines: [],
    actions: {
      notices: [],
      controls: [],
    },
    publicChat: {
      channel: "public",
      title: "공개 채팅",
      canWrite: false,
      messages: [],
    },
    secretChats: [],
    systemLog: {
      privateLines: [],
    },
    personalStats: {
      enabled: false,
      hasRecordedMatches: false,
      summary: {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        winRatePercent: 0,
        mafiaWins: 0,
        citizenWins: 0,
      },
      roleStats: [],
      recentMatches: [],
    },
    ...overrides,
  };
}

test("seat action markers 는 제출된 대상 좌석에만 생성된다", () => {
  const state = createState({
    actions: {
      notices: [],
      controls: [
        {
          id: "night:mafiaKill",
          type: "select",
          actionType: "night_select",
          action: "mafiaKill",
          title: "마피아 처형 대상 선택",
          description: "desc",
          options: [{ label: "대상", value: "u2" }],
          currentValue: "u2",
          currentLabel: "대상",
        },
      ],
    },
  });

  const markers = collectSeatActionMarkers(state);

  assert.deepEqual(Object.keys(markers), ["u2"]);
  assert.equal(markers.u2.length, 1);
  assert.equal(markers.u2[0].iconUrl, "/resource/actions/mafia_action.png");
  assert.equal(markers.u2[0].label, "마피아 처형 대상 선택: 대상");
});

test("역할별 action 아이콘 키 매핑을 사용한다", () => {
  const madamMarkers = collectSeatActionMarkers(
    createState({
      viewer: {
        userId: "u1",
        displayName: "나",
        role: "madam",
        roleLabel: "마담",
        roleSummary: "summary",
        teamLabel: "마피아팀",
        alive: true,
        contacted: false,
        loverName: null,
        deadReason: null,
        ascended: false,
      },
      actions: {
        notices: [],
        controls: [
          {
            id: "madam-select",
            type: "select",
            actionType: "madam_select",
            title: "마담 유혹",
            description: "desc",
            options: [{ label: "대상", value: "u2" }],
            currentValue: "u2",
            currentLabel: "대상",
          },
        ],
      },
    }),
  );

  const thugMarkers = collectSeatActionMarkers(
    createState({
      viewer: {
        userId: "u1",
        displayName: "나",
        role: "thug",
        roleLabel: "건달",
        roleSummary: "summary",
        teamLabel: "시민팀",
        alive: true,
        contacted: false,
        loverName: null,
        deadReason: null,
        ascended: false,
      },
      actions: {
        notices: [],
        controls: [
          {
            id: "night:thug",
            type: "select",
            actionType: "night_select",
            action: "thugThreaten",
            title: "건달 협박",
            description: "desc",
            options: [{ label: "대상", value: "u2" }],
            currentValue: "u2",
            currentLabel: "대상",
          },
        ],
      },
    }),
  );

  assert.equal(madamMarkers.u2[0].iconUrl, "/resource/actions/hostess_action.png");
  assert.equal(thugMarkers.u2[0].iconUrl, "/resource/actions/gangster_action.png");
});

test("action grid marker 는 역할별 css 좌표 값을 노출한다", () => {
  assert.equal(actionMarkerCssValueForRole("mafia"), "url(/resource/actions/mafia_action.png)");
  assert.equal(actionMarkerCssValueForRole("madam"), "url(/resource/actions/hostess_action.png)");
  assert.equal(actionMarkerCssValueForRole("thug"), "url(/resource/actions/gangster_action.png)");
  assert.equal(actionMarkerCssValueForRole("citizen"), null);
});
