import { PublicRole, Role, RoleAssignmentResult, RoleTemplate, Ruleset, Team, getTeam } from "./model";

const SUPPORT_POOL: PublicRole[] = ["spy", "beastman", "madam"];
const SPECIAL_POOL: PublicRole[] = [
  "soldier",
  "politician",
  "medium",
  "lover",
  "thug",
  "reporter",
  "detective",
  "graverobber",
  "terrorist",
  "priest",
];

const TEMPLATES: Record<4 | 5 | 6 | 7 | 8, RoleTemplate> = {
  4: { mafia: 1, support: 0, police: 1, doctor: 1, special: 1 },
  5: { mafia: 1, support: 0, police: 1, doctor: 1, special: 2 },
  6: { mafia: 1, support: 1, police: 1, doctor: 1, special: 2 },
  7: { mafia: 1, support: 1, police: 1, doctor: 1, special: 3 },
  8: { mafia: 2, support: 1, police: 1, doctor: 1, special: 3 },
};

export const ROLE_LABELS: Record<Role, string> = {
  mafia: "마피아",
  spy: "스파이",
  beastman: "짐승인간",
  madam: "마담",
  police: "경찰",
  doctor: "의사",
  soldier: "군인",
  politician: "정치인",
  medium: "영매",
  lover: "연인",
  thug: "건달",
  reporter: "기자",
  detective: "탐정",
  graverobber: "도굴꾼",
  terrorist: "테러리스트",
  priest: "성직자",
  citizen: "시민",
  evil: "악인",
};

export const TEAM_LABELS: Record<Team, string> = {
  citizen: "시민팀",
  mafia: "마피아팀",
};

export function getTemplate(playerCount: number): RoleTemplate | null {
  if (playerCount < 4 || playerCount > 8) {
    return null;
  }

  return TEMPLATES[playerCount as 4 | 5 | 6 | 7 | 8];
}

export function assignRoles(playerCount: number): RoleAssignmentResult {
  const template = getTemplate(playerCount);
  if (!template) {
    throw new Error("지원 인원은 4명 이상 8명 이하입니다.");
  }

  const roles: Role[] = [];

  for (let index = 0; index < template.mafia; index += 1) {
    roles.push("mafia");
  }

  for (let index = 0; index < template.support; index += 1) {
    roles.push(...drawUnique(SUPPORT_POOL, template.support));
    break;
  }

  if (template.police === 1) {
    roles.push("police");
  }

  if (template.doctor === 1) {
    roles.push("doctor");
  }

  roles.push(...drawSpecialRoles(template.special));

  return { roles: shuffle(roles), template };
}

function drawUnique(pool: PublicRole[], count: number): PublicRole[] {
  return shuffle([...pool]).slice(0, count);
}

function drawSpecialRoles(slotCount: number): Role[] {
  const candidates = shuffle([...SPECIAL_POOL]);
  const chosen: Role[] = [];
  let remaining = slotCount;

  while (remaining > 0 && candidates.length > 0) {
    const role = candidates.shift()!;

    if (role === "lover") {
      if (remaining < 2) {
        continue;
      }

      chosen.push("lover", "lover");
      remaining -= 2;
      continue;
    }

    chosen.push(role);
    remaining -= 1;
  }

  if (remaining !== 0) {
    throw new Error("특수직업 배치에 실패했습니다.");
  }

  return chosen;
}

export function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

export function getRoleSummary(role: Role, ruleset: Ruleset): string {
  switch (role) {
    case "mafia":
      return "밤마다 한 명을 처형 대상으로 고릅니다. 다른 마피아와 밤 대화를 할 수 있습니다.";
    case "spy":
      return "밤마다 한 명의 직업을 확인합니다. 마피아를 조사하면 접선합니다.";
    case "beastman":
      return ruleset === "balance"
        ? "접선 전에는 밤마다 한 명을 표시합니다. 표시한 사람이 마피아에게 죽으면 접선합니다. 회피 발동 시 즉시 접선합니다."
        : "접선 전에는 밤마다 한 명을 표시합니다. 표시한 사람이 마피아에게 죽으면 접선합니다.";
    case "madam":
      return ruleset === "balance"
        ? "투표 시간에 한 명을 유혹해 그날 밤 효과를 막습니다. 전 직업에 적용됩니다."
        : "투표 시간에 한 명을 유혹해 그날 밤 능력 사용을 막습니다.";
    case "police":
      return "밤마다 한 명을 조사해 마피아 여부를 확인합니다.";
    case "doctor":
      return "밤마다 한 명을 치료합니다. 시즌4 기준 자기 자신도 치료할 수 있습니다.";
    case "soldier":
      return "마피아 공격을 한 번 버팁니다. 스파이에게 조사당하면 그 사실을 압니다.";
    case "politician":
      return "투표 표가 2표로 계산되며 투표 처형되지 않습니다.";
    case "medium":
      return "죽은 사람의 채팅을 보고 밤마다 죽은 플레이어 한 명을 성불시킵니다.";
    case "lover":
      return "연인과 밤에 대화할 수 있습니다. 한 명이 마피아에게 지목되면 다른 연인이 대신 죽습니다.";
    case "thug":
      return "밤마다 한 명을 협박해 다음 날 투표권을 빼앗습니다.";
    case "reporter":
      return "밤에 취재를 하면 이후 낮에 기사를 공개할 수 있습니다. 첫째 낮에는 기사를 낼 수 없습니다.";
    case "detective":
      return "밤에 한 명을 조사해 그 사람이 고른 대상을 확인합니다.";
    case "graverobber":
      return "첫째 밤 마피아에게 죽은 플레이어의 직업을 도굴합니다.";
    case "terrorist":
      return "밤에 표시한 상대에게 실제로 마피아에게 살해당하면 함께 죽습니다. 투표 처형 시 적을 지목해 산화할 수 있습니다.";
    case "priest":
      return "한 번만 죽은 플레이어 한 명을 부활시킵니다.";
    case "citizen":
      return "특수 능력이 없는 시민입니다.";
    case "evil":
      return "마피아팀과 같은 승리조건을 갖는 악인입니다.";
  }
}

export function normalizeStolenRole(stolenRole: Role, ruleset: Ruleset): Role {
  if (stolenRole === "mafia" || stolenRole === "spy" || stolenRole === "beastman" || stolenRole === "madam") {
    return ruleset === "balance" ? "evil" : "citizen";
  }

  return stolenRole;
}

export function getRoleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export function getTeamLabel(role: Role): string {
  return TEAM_LABELS[getTeam(role)];
}
