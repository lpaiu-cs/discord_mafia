import { randomUUID } from "node:crypto";
import {
  getDefaultLiarCategory,
  getLiarCategories,
  getLiarCategory,
  getLiarModeBPairs,
  LiarCategory,
  LiarCategoryWord,
} from "../content/categories";
import {
  LiarClue,
  LiarClueSubmissionResult,
  LiarKeywordView,
  LiarMode,
  LiarPhase,
  LiarPlayer,
  LiarResult,
  LiarVote,
  LiarVoteResolution,
  liarModeLabel,
  liarModeSummary,
} from "./model";

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 8;
const MAX_CLUE_LENGTH = 120;
const MAX_GUESS_LENGTH = 60;

type RandomSource = () => number;

interface KeywordAssignment {
  readonly category: LiarCategory;
  readonly word: string;
}

interface WeightedKeywordAssignment extends KeywordAssignment {
  readonly weight: number;
  readonly wordEntry: LiarCategoryWord;
}

interface ModeBCandidate {
  readonly citizen: WeightedKeywordAssignment;
  readonly liarAssignments: readonly WeightedKeywordAssignment[];
  readonly weight: number;
}

function normalizeWord(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function getDifficultyWeight(value: string | undefined): number {
  switch (value) {
    case "easy":
      return 6;
    case "medium":
      return 3;
    case "hard":
      return 1;
    default:
      return 3;
  }
}

function getToneWeight(value: string | undefined): number {
  switch (value) {
    case "familiar":
      return 3;
    case "quirky":
      return 2;
    case "specialized":
      return 1;
    default:
      return 2;
  }
}

function getTagRichnessWeight(tags: readonly string[]): number {
  if (tags.length === 0) {
    return 1;
  }

  return Math.min(3, tags.length + 1);
}

function getTagAffinityWeight(sourceTags: readonly string[], targetTags: readonly string[]): number {
  if (sourceTags.length === 0 || targetTags.length === 0) {
    return 1;
  }

  const normalizedSource = new Set(sourceTags.map((tag) => normalizeWord(tag)));
  let overlap = 0;
  for (const tag of targetTags) {
    if (normalizedSource.has(normalizeWord(tag))) {
      overlap += 1;
    }
  }

  return overlap > 0 ? Math.min(3, overlap + 1) : 1;
}

function pickWeighted<T>(items: readonly T[], random: RandomSource, getWeight: (item: T) => number): T {
  if (items.length === 0) {
    throw new Error("가중치 선택 후보가 없습니다.");
  }

  const weightedItems = items.map((item) => ({
    item,
    weight: Math.max(1, Math.floor(getWeight(item))),
  }));
  const totalWeight = weightedItems.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * totalWeight;

  for (const entry of weightedItems) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.item;
    }
  }

  return weightedItems[weightedItems.length - 1].item;
}

function assertNonEmpty(value: string, message: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(message);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`입력은 ${maxLength}자 이하만 가능합니다.`);
  }

  return trimmed;
}

function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function assertLiarMode(mode: string): asserts mode is LiarMode {
  if (mode !== "modeA" && mode !== "modeB") {
    throw new Error("지원하지 않는 라이어 규칙 모드입니다.");
  }
}

export class LiarGame {
  readonly id = randomUUID();
  readonly guildId: string;
  readonly guildName: string;
  readonly channelId: string;
  hostId: string;
  phase: LiarPhase = "lobby";
  readonly players = new Map<string, LiarPlayer>();
  readonly clues: LiarClue[] = [];
  readonly votes = new Map<string, LiarVote>();
  readonly createdAt = Date.now();
  categoryId: string;
  mode: LiarMode;
  statusMessageId: string | null = null;
  liarId: string | null = null;
  secretWord: string | null = null;
  liarAssignedCategoryId: string | null = null;
  liarAssignedCategoryLabel: string | null = null;
  liarAssignedWord: string | null = null;
  turnOrder: string[] = [];
  currentTurnIndex = 0;
  accusedUserId: string | null = null;
  result: LiarResult | null = null;
  startedAt: number | null = null;
  endedAt: number | null = null;
  phaseDeadlineAt: number | null = null;

  constructor(params: {
    guildId: string;
    guildName?: string | null;
    channelId: string;
    hostId: string;
    hostDisplayName: string;
    categoryId?: string;
    mode?: LiarMode;
  }) {
    this.guildId = params.guildId;
    this.guildName = params.guildName ?? "";
    this.channelId = params.channelId;
    this.hostId = params.hostId;
    this.categoryId = params.categoryId ?? getDefaultLiarCategory(params.guildId).id;
    const resolvedMode = params.mode ?? "modeA";
    assertLiarMode(resolvedMode);
    this.mode = resolvedMode;
    this.players.set(params.hostId, {
      userId: params.hostId,
      displayName: params.hostDisplayName,
      joinedAt: this.createdAt,
    });
  }

  get playerCount(): number {
    return this.players.size;
  }

  get category(): LiarCategory {
    return getLiarCategory(this.categoryId, this.guildId) ?? getDefaultLiarCategory(this.guildId);
  }

  getCompletedClueTurns(): number {
    return Math.min(this.currentTurnIndex, this.turnOrder.length);
  }

  getRemainingPhaseSeconds(now = Date.now()): number | null {
    if (!this.phaseDeadlineAt) {
      return null;
    }

    return Math.max(0, Math.ceil((this.phaseDeadlineAt - now) / 1_000));
  }

  setPhaseDeadline(deadlineAt: number | null): void {
    this.phaseDeadlineAt = deadlineAt;
  }

  isParticipant(userId: string): boolean {
    return this.players.has(userId);
  }

  getPlayer(userId: string): LiarPlayer | null {
    return this.players.get(userId) ?? null;
  }

  getCurrentSpeaker(): LiarPlayer | null {
    const userId = this.turnOrder[this.currentTurnIndex];
    return userId ? this.getPlayer(userId) : null;
  }

  addPlayer(userId: string, displayName: string): void {
    if (this.phase !== "lobby") {
      throw new Error("게임이 이미 시작되어 참가할 수 없습니다.");
    }

    if (this.players.has(userId)) {
      throw new Error("이미 참가한 플레이어입니다.");
    }

    if (this.players.size >= MAX_PLAYERS) {
      throw new Error(`라이어게임은 최대 ${MAX_PLAYERS}명까지 참가할 수 있습니다.`);
    }

    this.players.set(userId, {
      userId,
      displayName,
      joinedAt: Date.now(),
    });
  }

  removePlayer(userId: string): void {
    if (this.phase !== "lobby") {
      throw new Error("게임이 시작된 뒤에는 나갈 수 없습니다. 방장이 게임을 종료하세요.");
    }

    if (!this.players.delete(userId)) {
      throw new Error("현재 로비 참가자가 아닙니다.");
    }

    if (this.hostId === userId) {
      const nextHost = [...this.players.values()].sort((left, right) => left.joinedAt - right.joinedAt)[0] ?? null;
      this.hostId = nextHost?.userId ?? "";
    }
  }

  setCategory(categoryId: string): void {
    if (this.phase !== "lobby") {
      throw new Error("카테고리는 로비에서만 바꿀 수 있습니다.");
    }

    const category = getLiarCategory(categoryId, this.guildId);
    if (!category) {
      throw new Error("지원하지 않는 카테고리입니다.");
    }

    if (!category.modes.modeA) {
      throw new Error("이 카테고리는 모드A에서 사용할 수 없습니다.");
    }

    this.categoryId = categoryId;
  }

  setMode(mode: LiarMode): void {
    if (this.phase !== "lobby") {
      throw new Error("규칙 모드는 로비에서만 바꿀 수 있습니다.");
    }

    assertLiarMode(mode);
    this.mode = mode;
  }

  getStartConfigurationError(): string | null {
    if (this.mode === "modeA") {
      if (this.getWordPool(this.category, [], "modeA").length === 0) {
        return "현재 카테고리에는 모드A에 사용할 수 있는 제시어가 없습니다.";
      }

      return null;
    }

    if (this.buildModeBCandidates(new Map()).length === 0) {
      return "모드B 는 시민 카테고리와 다른 카테고리의 제시어를 함께 뽑을 수 있을 때만 시작할 수 있습니다.";
    }

    return null;
  }

  start(
    random: RandomSource = Math.random,
    options: { excludedWords?: readonly string[]; excludedWordsByCategoryId?: ReadonlyMap<string, readonly string[]> } = {},
  ): void {
    if (this.phase !== "lobby") {
      throw new Error("이미 시작된 게임입니다.");
    }

    if (this.players.size < MIN_PLAYERS || this.players.size > MAX_PLAYERS) {
      throw new Error(`라이어게임은 ${MIN_PLAYERS}명 이상 ${MAX_PLAYERS}명 이하로만 시작할 수 있습니다.`);
    }

    const startConfigurationError = this.getStartConfigurationError();
    if (startConfigurationError) {
      throw new Error(startConfigurationError);
    }

    const participants = [...this.players.values()].sort((left, right) => left.joinedAt - right.joinedAt);
    const liarIndex = Math.floor(random() * participants.length);
    const excludedWordsByCategoryId = options.excludedWordsByCategoryId ?? new Map<string, readonly string[]>();
    let secretAssignment: KeywordAssignment;
    let liarAssignment: KeywordAssignment | null = null;

    if (this.mode === "modeB") {
      const modeBCandidates = this.buildModeBCandidates(excludedWordsByCategoryId);
      if (modeBCandidates.length === 0) {
        throw new Error("모드B 를 시작할 수 있는 크로스 카테고리 제시어 조합이 없습니다.");
      }

      const selectedCandidate = pickWeighted(modeBCandidates, random, (candidate) => candidate.weight);
      secretAssignment = selectedCandidate.citizen;
      liarAssignment = pickWeighted(selectedCandidate.liarAssignments, random, (assignment) => assignment.weight);
      this.categoryId = secretAssignment.category.id;
      this.liarAssignedCategoryId = liarAssignment.category.id;
      this.liarAssignedCategoryLabel = liarAssignment.category.label;
      this.liarAssignedWord = liarAssignment.word;
    } else {
      secretAssignment = this.pickWordAssignment(
        this.category,
        this.getExcludedWordsForCategory(this.category.id, options.excludedWords, excludedWordsByCategoryId),
        random,
      );
      this.liarAssignedCategoryId = null;
      this.liarAssignedCategoryLabel = null;
      this.liarAssignedWord = null;
    }

    this.liarId = participants[liarIndex].userId;
    this.secretWord = secretAssignment.word;
    this.turnOrder = shuffle(participants.map((player) => player.userId), random);
    this.phase = "clue";
    this.currentTurnIndex = 0;
    this.startedAt = Date.now();
    this.clues.length = 0;
    this.votes.clear();
    this.accusedUserId = null;
    this.result = null;
    this.endedAt = null;
    this.phaseDeadlineAt = null;
  }

  getKeywordView(userId: string): LiarKeywordView {
    if (!this.isParticipant(userId)) {
      throw new Error("현재 라이어게임 참가자만 제시어를 확인할 수 있습니다.");
    }

    if (!this.secretWord || !this.liarId || this.phase === "lobby") {
      throw new Error("아직 게임이 시작되지 않았습니다.");
    }

    if (userId === this.liarId) {
      if (this.mode === "modeB" && this.liarAssignedWord) {
        return {
          mode: this.mode,
          categoryLabel: this.liarAssignedCategoryLabel ?? this.category.label,
          isLiar: true,
          knowsLiarRole: false,
          keyword: this.liarAssignedWord,
          message: `카테고리: ${this.liarAssignedCategoryLabel ?? this.category.label}\n제시어: ${this.liarAssignedWord}`,
        };
      }

      return {
        mode: this.mode,
        categoryLabel: this.category.label,
        isLiar: true,
        knowsLiarRole: true,
        keyword: null,
        message: `당신은 라이어입니다. 현재 규칙은 ${liarModeLabel(this.mode)} 이며 카테고리는 ${this.category.label} 입니다. 제시어는 공개되지 않습니다.`,
      };
    }

    return {
      mode: this.mode,
      categoryLabel: this.category.label,
      isLiar: false,
      knowsLiarRole: false,
      keyword: this.secretWord,
      message: `카테고리: ${this.category.label}\n제시어: ${this.secretWord}`,
    };
  }

  submitClue(userId: string, content: string): LiarClueSubmissionResult {
    if (this.phase !== "clue") {
      throw new Error("지금은 제시어 설명 단계가 아닙니다.");
    }

    const speaker = this.getCurrentSpeaker();
    if (!speaker || speaker.userId !== userId) {
      throw new Error("지금 설명할 차례가 아닙니다.");
    }

    const sanitized = assertNonEmpty(content, "설명 문장은 비워 둘 수 없습니다.", MAX_CLUE_LENGTH);
    this.clues.push({
      userId,
      displayName: speaker.displayName,
      content: sanitized,
      submittedAt: Date.now(),
      order: this.clues.length + 1,
    });
    this.currentTurnIndex += 1;

    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.phase = "discussion";
      return { phaseChanged: true, nextSpeakerId: null };
    }

    return {
      phaseChanged: false,
      nextSpeakerId: this.turnOrder[this.currentTurnIndex] ?? null,
    };
  }

  skipCurrentSpeaker(): { skippedSpeakerId: string | null; phaseChanged: boolean; nextSpeakerId: string | null } {
    if (this.phase !== "clue") {
      throw new Error("지금은 설명 차례를 넘길 수 없습니다.");
    }

    const skippedSpeakerId = this.turnOrder[this.currentTurnIndex] ?? null;
    this.currentTurnIndex += 1;

    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.phase = "discussion";
      return {
        skippedSpeakerId,
        phaseChanged: true,
        nextSpeakerId: null,
      };
    }

    return {
      skippedSpeakerId,
      phaseChanged: false,
      nextSpeakerId: this.turnOrder[this.currentTurnIndex] ?? null,
    };
  }

  beginVote(): void {
    if (this.phase !== "discussion") {
      throw new Error("투표는 설명이 모두 끝난 뒤 토론 단계에서만 열 수 있습니다.");
    }

    this.phase = "voting";
    this.votes.clear();
  }

  submitVote(userId: string, targetId: string): { completed: boolean; progress: number; resolution: LiarVoteResolution | null } {
    if (this.phase !== "voting") {
      throw new Error("지금은 투표 단계가 아닙니다.");
    }

    if (!this.isParticipant(userId)) {
      throw new Error("현재 라이어게임 참가자만 투표할 수 있습니다.");
    }

    if (!this.isParticipant(targetId)) {
      throw new Error("현재 참가자만 지목할 수 있습니다.");
    }

    if (this.votes.has(userId)) {
      throw new Error("이미 투표했습니다.");
    }

    this.votes.set(userId, {
      voterId: userId,
      targetId,
      submittedAt: Date.now(),
    });

    if (this.votes.size < this.players.size) {
      return {
        completed: false,
        progress: this.votes.size,
        resolution: null,
      };
    }

    return {
      completed: true,
      progress: this.votes.size,
      resolution: this.resolveVotes(),
    };
  }

  tallyVotes(): LiarVoteResolution {
    if (this.phase !== "voting") {
      throw new Error("지금은 투표를 집계할 수 없습니다.");
    }

    if (this.votes.size === 0) {
      throw new Error("아직 제출된 투표가 없습니다.");
    }

    return this.resolveVotes();
  }

  resolveVotingTimeout(): LiarVoteResolution {
    if (this.phase !== "voting") {
      throw new Error("지금은 투표 시간초과 처리를 할 수 없습니다.");
    }

    if (this.votes.size === 0) {
      const result: LiarResult = {
        winner: "liar",
        reason: "투표 시간이 끝날 때까지 제출된 표가 없어 라이어를 특정하지 못했습니다.",
        accusedUserId: null,
        guessedWord: null,
      };
      this.phase = "ended";
      this.result = result;
      this.endedAt = Date.now();
      this.phaseDeadlineAt = null;
      return {
        accusedUserId: null,
        tiedUserIds: [],
        phase: this.phase,
        result,
      };
    }

    return this.resolveVotes();
  }

  guessWord(userId: string, guess: string): LiarResult {
    if (this.phase !== "guess") {
      throw new Error("지금은 라이어 추리 단계가 아닙니다.");
    }

    if (userId !== this.liarId) {
      throw new Error("라이어만 제시어를 추리할 수 있습니다.");
    }

    const sanitized = assertNonEmpty(guess, "추리 단어를 입력하세요.", MAX_GUESS_LENGTH);
    const normalizedGuess = normalizeWord(sanitized);
    const acceptedAnswers = new Set<string>();
    if (this.secretWord) {
      acceptedAnswers.add(normalizeWord(this.secretWord));
    }

    const secretWordEntry = this.secretWord ? this.findWordEntry(this.category, this.secretWord) : null;
    for (const alias of secretWordEntry?.aliases ?? []) {
      acceptedAnswers.add(normalizeWord(alias));
    }

    const isCorrect = acceptedAnswers.has(normalizedGuess);
    const result: LiarResult = isCorrect
      ? {
          winner: "liar",
          reason: `라이어가 제시어 ${this.secretWord} 를 맞혀 승리했습니다.`,
          accusedUserId: this.accusedUserId,
          guessedWord: sanitized,
        }
      : {
          winner: "citizens",
          reason: `라이어가 ${sanitized} 라고 추리했지만 제시어는 ${this.secretWord} 였습니다.`,
          accusedUserId: this.accusedUserId,
          guessedWord: sanitized,
        };
    this.phase = "ended";
    this.result = result;
    this.endedAt = Date.now();
    this.phaseDeadlineAt = null;
    return result;
  }

  resolveGuessTimeout(): LiarResult {
    if (this.phase !== "guess") {
      throw new Error("지금은 추리 시간초과 처리를 할 수 없습니다.");
    }

    const liar = this.liarId ? this.getPlayer(this.liarId) : null;
    const result: LiarResult = {
      winner: "citizens",
      reason: `${liar?.displayName ?? "라이어"} 님이 제한 시간 안에 정답을 제출하지 못해 시민팀이 승리했습니다.`,
      accusedUserId: this.accusedUserId,
      guessedWord: null,
    };
    this.phase = "ended";
    this.result = result;
    this.endedAt = Date.now();
    this.phaseDeadlineAt = null;
    return result;
  }

  forceEnd(reason: string): LiarResult {
    const result: LiarResult = {
      winner: "cancelled",
      reason,
      accusedUserId: this.accusedUserId,
      guessedWord: null,
    };
    this.phase = "ended";
    this.result = result;
    this.endedAt = Date.now();
    this.phaseDeadlineAt = null;
    return result;
  }

  describeParticipants(): string {
    return [...this.players.values()]
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map((player) => `${player.userId === this.hostId ? "[방장] " : ""}${player.displayName}`)
      .join(", ");
  }

  describeTurnOrder(): string {
    if (this.turnOrder.length === 0) {
      return "아직 없음";
    }

    return this.turnOrder
      .map((userId, index) => {
        const player = this.getPlayer(userId);
        return `${index + 1}. ${player?.displayName ?? userId}`;
      })
      .join("\n");
  }

  describeStatus(): string {
    const header = [
      `라이어게임 상태: ${phaseLabel(this.phase)}`,
      `규칙 모드: ${liarModeLabel(this.mode)}`,
      `카테고리: ${this.describePublicCategory()}`,
      `참가자(${this.players.size}명): ${this.describeParticipants() || "없음"}`,
    ];

    if (this.phase === "lobby") {
      header.push(liarModeSummary(this.mode));
      const startConfigurationError = this.getStartConfigurationError();
      if (startConfigurationError) {
        header.push(`시작 불가: ${startConfigurationError}`);
      }
    }

    if (this.phase === "clue") {
      const speaker = this.getCurrentSpeaker();
      header.push(`현재 차례: ${speaker?.displayName ?? "없음"}`);
      header.push(`설명 진행: ${this.getCompletedClueTurns()}/${this.turnOrder.length} (제출 ${this.clues.length})`);
    }

    if (this.phase === "discussion") {
      header.push("토론 중입니다. 방장이 상태 메시지의 `투표 시작` 버튼으로 투표를 여세요.");
    }

    if (this.phase === "voting") {
      header.push(`투표 진행: ${this.votes.size}/${this.players.size}`);
    }

    if (this.phase === "guess") {
      const liar = this.liarId ? this.getPlayer(this.liarId) : null;
      header.push(`라이어 추리 단계: ${liar?.displayName ?? "알 수 없음"} 님의 답변 대기 중`);
    }

    if (this.phase === "ended" && this.result) {
      header.push(`결과: ${this.result.reason}`);
    }

    const remainingSeconds = this.getRemainingPhaseSeconds();
    if (remainingSeconds !== null && this.phase !== "ended") {
      header.push(`남은 시간: 약 ${remainingSeconds}초`);
    }

    return header.join("\n");
  }

  private resolveVotes(): LiarVoteResolution {
    const counts = new Map<string, number>();
    for (const vote of this.votes.values()) {
      counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1);
    }

    const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    const highest = ranked[0]?.[1] ?? 0;
    const tiedUserIds = ranked.filter((entry) => entry[1] === highest).map((entry) => entry[0]);

    if (tiedUserIds.length !== 1) {
      const result: LiarResult = {
        winner: "liar",
        reason: "최다 득표자가 동률이라 라이어를 특정하지 못했습니다.",
        accusedUserId: null,
        guessedWord: null,
      };
      this.phase = "ended";
      this.accusedUserId = null;
      this.result = result;
      this.endedAt = Date.now();
      this.phaseDeadlineAt = null;
      return {
        accusedUserId: null,
        tiedUserIds,
        phase: this.phase,
        result,
      };
    }

    const accusedUserId = tiedUserIds[0];
    this.accusedUserId = accusedUserId;

    if (accusedUserId === this.liarId) {
      this.phase = "guess";
      return {
        accusedUserId,
        tiedUserIds,
        phase: this.phase,
        result: null,
      };
    }

    const accused = this.getPlayer(accusedUserId);
    const result: LiarResult = {
      winner: "liar",
      reason: `${accused?.displayName ?? "지목된 플레이어"} 님이 지목되었지만 라이어가 아니었습니다.`,
      accusedUserId,
      guessedWord: null,
    };
    this.phase = "ended";
    this.result = result;
    this.endedAt = Date.now();
    this.phaseDeadlineAt = null;
    return {
      accusedUserId,
      tiedUserIds,
      phase: this.phase,
      result,
    };
  }

  describePublicCategory(): string {
    if (this.mode === "modeB") {
      if (this.phase === "lobby") {
        return "크로스 카테고리 (시작 시 자동 배정)";
      }

      if (this.phase === "ended") {
        const liarCategory = this.liarAssignedCategoryLabel ? ` · 라이어 ${this.liarAssignedCategoryLabel}` : "";
        return `시민 ${this.category.label}${liarCategory}`;
      }

      return "비공개 (각자 /제시어 확인)";
    }

    return this.category.label;
  }

  private buildModeBCandidates(excludedWordsByCategoryId: ReadonlyMap<string, readonly string[]>): ModeBCandidate[] {
    const categories = this.getCategoriesForMode("modeB");
    const categoriesById = new Map(categories.map((category) => [category.id, category] as const));
    const configuredPairs = getLiarModeBPairs(this.guildId);
    const candidates: ModeBCandidate[] = [];

    for (const citizenCategory of categories) {
      const citizenWordPool = this.getWordEntryPool(
        citizenCategory,
        this.getExcludedWordsForCategory(citizenCategory.id, [], excludedWordsByCategoryId),
        "modeB",
      );
      for (const citizenWordEntry of citizenWordPool) {
        const citizenWord = citizenWordEntry.value;
        if (configuredPairs.length > 0) {
          for (const pair of configuredPairs.filter((entry) => entry.citizenCategoryId === citizenCategory.id)) {
            const liarCategory = categoriesById.get(pair.liarCategoryId);
            if (!liarCategory) {
              continue;
            }

            const liarAssignments = this.getWordEntryPool(
              liarCategory,
              this.getExcludedWordsForCategory(liarCategory.id, [], excludedWordsByCategoryId),
              "modeB",
            )
              .filter((wordEntry) => normalizeWord(wordEntry.value) !== normalizeWord(citizenWord))
              .map((wordEntry) => ({
                category: liarCategory,
                word: wordEntry.value,
                wordEntry,
                weight: this.getModeBLiarAssignmentWeight(citizenWordEntry, liarCategory, wordEntry),
              }));

            if (liarAssignments.length === 0) {
              continue;
            }

            candidates.push({
              citizen: {
                category: citizenCategory,
                word: citizenWord,
                wordEntry: citizenWordEntry,
                weight: this.getWordSelectionWeight(citizenCategory, citizenWordEntry),
              },
              liarAssignments,
              weight: this.getModeBCandidateWeight(pair, citizenCategory, citizenWordEntry),
            });
          }

          continue;
        }

        const liarAssignments = categories
          .filter((category) => category.id !== citizenCategory.id)
          .flatMap((category) =>
            this.getWordEntryPool(category, this.getExcludedWordsForCategory(category.id, [], excludedWordsByCategoryId), "modeB")
              .filter((wordEntry) => normalizeWord(wordEntry.value) !== normalizeWord(citizenWord))
              .map((wordEntry) => ({
                category,
                word: wordEntry.value,
                wordEntry,
                weight: this.getModeBLiarAssignmentWeight(citizenWordEntry, category, wordEntry),
              })),
          );

        if (liarAssignments.length === 0) {
          continue;
        }

        candidates.push({
          citizen: {
            category: citizenCategory,
            word: citizenWord,
            wordEntry: citizenWordEntry,
            weight: this.getWordSelectionWeight(citizenCategory, citizenWordEntry),
          },
          liarAssignments,
          weight: this.getWordSelectionWeight(citizenCategory, citizenWordEntry),
        });
      }
    }

    return candidates;
  }

  private getExcludedWordsForCategory(
    categoryId: string,
    fallbackWords: readonly string[] = [],
    excludedWordsByCategoryId: ReadonlyMap<string, readonly string[]>,
  ): readonly string[] {
    return excludedWordsByCategoryId.get(categoryId) ?? fallbackWords;
  }

  private pickWordAssignment(category: LiarCategory, excludedWords: readonly string[], random: RandomSource): KeywordAssignment {
    const wordPool = this.getWordEntryPool(category, excludedWords, "modeA");
    if (wordPool.length === 0) {
      throw new Error(`${category.label} 카테고리에는 현재 규칙에서 사용할 수 있는 제시어가 없습니다.`);
    }

    const selectedWord = pickWeighted(wordPool, random, (wordEntry) => this.getWordSelectionWeight(category, wordEntry));
    return {
      category,
      word: selectedWord.value,
    };
  }

  private getWordEntryPool(category: LiarCategory, excludedWords: readonly string[], mode: LiarMode): readonly LiarCategoryWord[] {
    const allowedWords = this.getAllowedWordEntries(category, mode);
    if (allowedWords.length === 0) {
      return [];
    }

    const excludedWordSet = new Set(excludedWords.map((word) => normalizeWord(word)));
    const candidateWords = allowedWords.filter((word) => !excludedWordSet.has(normalizeWord(word.value)));
    return candidateWords.length > 0 ? candidateWords : allowedWords;
  }

  private getWordPool(category: LiarCategory, excludedWords: readonly string[], mode: LiarMode): readonly string[] {
    const allowedWords = this.getWordEntryPool(category, excludedWords, mode).map((word) => word.value);
    if (allowedWords.length === 0) {
      return [];
    }

    return allowedWords;
  }

  private getAllowedWordEntries(category: LiarCategory, mode: LiarMode): readonly LiarCategoryWord[] {
    return category.wordsMeta.filter((word) => (mode === "modeA" ? word.modeAAllowed : word.modeBAllowed));
  }

  private getWordSelectionWeight(category: LiarCategory, wordEntry: LiarCategoryWord): number {
    return getDifficultyWeight(wordEntry.difficulty ?? category.defaultDifficulty) * getToneWeight(category.tone) * getTagRichnessWeight(wordEntry.tags);
  }

  private getModeBCandidateWeight(pair: ReturnType<typeof getLiarModeBPairs>[number], category: LiarCategory, wordEntry: LiarCategoryWord): number {
    return Math.max(1, pair.weight) * getDifficultyWeight(pair.difficulty) * getToneWeight(pair.tone) * this.getWordSelectionWeight(category, wordEntry);
  }

  private getModeBLiarAssignmentWeight(
    citizenWordEntry: LiarCategoryWord,
    liarCategory: LiarCategory,
    liarWordEntry: LiarCategoryWord,
  ): number {
    return this.getWordSelectionWeight(liarCategory, liarWordEntry) * getTagAffinityWeight(citizenWordEntry.tags, liarWordEntry.tags);
  }

  private getCategoriesForMode(mode: LiarMode): readonly LiarCategory[] {
    return getLiarCategories(this.guildId).filter((category) => category.modes[mode]);
  }

  private findWordEntry(category: LiarCategory, value: string): LiarCategoryWord | null {
    const normalizedValue = normalizeWord(value);
    return category.wordsMeta.find((word) => normalizeWord(word.value) === normalizedValue) ?? null;
  }
}

export function phaseLabel(phase: LiarPhase): string {
  switch (phase) {
    case "lobby":
      return "로비";
    case "clue":
      return "설명";
    case "discussion":
      return "토론";
    case "voting":
      return "투표";
    case "guess":
      return "라이어 추리";
    case "ended":
      return "종료";
    default:
      return phase;
  }
}
