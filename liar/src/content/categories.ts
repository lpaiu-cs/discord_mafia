import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LiarCategory {
  readonly id: string;
  readonly label: string;
  readonly words: readonly string[];
  readonly wordsMeta: readonly LiarCategoryWord[];
  readonly description?: string;
  readonly theme?: string;
  readonly tone?: string;
  readonly defaultDifficulty?: LiarWordDifficulty;
  readonly tags: readonly string[];
  readonly modes: LiarCategoryModes;
}

export type LiarWordDifficulty = "easy" | "medium" | "hard";

export type LiarWordSensitivity = "safe" | "caution" | "blocked";

export interface LiarCategoryModes {
  readonly modeA: boolean;
  readonly modeB: boolean;
}

export interface LiarCategoryWord {
  readonly value: string;
  readonly aliases: readonly string[];
  readonly difficulty?: LiarWordDifficulty;
  readonly tags: readonly string[];
  readonly sensitivity?: Exclude<LiarWordSensitivity, "blocked">;
  readonly modeAAllowed: boolean;
  readonly modeBAllowed: boolean;
  readonly notes?: string;
}

export interface LiarModeBPair {
  readonly id: string;
  readonly citizenCategoryId: string;
  readonly liarCategoryId: string;
  readonly weight: number;
  readonly difficulty?: string;
  readonly tone?: string;
  readonly notes?: string;
}

type LiarGuildCategoryMode = "extend" | "replace";

interface LiarGuildCategoryOverride {
  readonly mode: LiarGuildCategoryMode;
  readonly categories: readonly LiarCategory[];
  readonly modeBPairs: readonly LiarModeBPair[];
}

interface LoadedLiarCategoryResource {
  readonly categories: readonly LiarCategory[];
  readonly modeBPairs: readonly LiarModeBPair[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDifficulty(value: unknown): LiarWordDifficulty | undefined {
  return value === "easy" || value === "medium" || value === "hard" ? value : undefined;
}

function parseSensitivity(value: unknown): LiarWordSensitivity | undefined {
  return value === "safe" || value === "caution" || value === "blocked" ? value : undefined;
}

function parseStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  return Object.freeze([...new Set(value.filter(isNonEmptyString).map((entry) => entry.trim()))]);
}

function parseCategoryModes(value: unknown): LiarCategoryModes {
  if (!isRecord(value)) {
    return Object.freeze({ modeA: true, modeB: true });
  }

  return Object.freeze({
    modeA: value.modeA !== false,
    modeB: value.modeB !== false,
  });
}

function readJsonResource(paths: readonly string[], required: boolean): { path: string; value: unknown } | null {
  const resourcePath = paths.find((candidate) => existsSync(candidate));
  if (!resourcePath) {
    if (required) {
      throw new Error(paths[0] ?? "라이어게임 리소스 파일을 찾을 수 없습니다.");
    }

    return null;
  }

  return {
    path: resourcePath,
    value: JSON.parse(readFileSync(resourcePath, "utf8")) as unknown,
  };
}

function parseCategories(raw: unknown, sourceLabel: string): readonly LiarCategory[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${sourceLabel} 는 비어 있지 않은 배열이어야 합니다.`);
  }

  const seenIds = new Set<string>();
  return Object.freeze(
    raw.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`${sourceLabel} ${index + 1}번 항목 형식이 올바르지 않습니다.`);
      }

      const { id, label, words } = entry as {
        id?: unknown;
        label?: unknown;
        words?: unknown;
      };

      if (!isNonEmptyString(id) || !isNonEmptyString(label)) {
        throw new Error(`${sourceLabel} ${index + 1}번 항목의 id 또는 label 이 비어 있습니다.`);
      }

      const normalizedId = id.trim();
      if (seenIds.has(normalizedId)) {
        throw new Error(`${sourceLabel} 에 중복 카테고리 id ${normalizedId} 이(가) 있습니다.`);
      }
      seenIds.add(normalizedId);

      if (!Array.isArray(words) || words.length === 0 || words.some((word) => !isNonEmptyString(word))) {
        throw new Error(`${sourceLabel} ${normalizedId} 의 words 는 비어 있지 않은 문자열 배열이어야 합니다.`);
      }

      const normalizedWords = [...new Set(words.map((word) => word.trim()))];
      return Object.freeze({
        id: normalizedId,
        label: label.trim(),
        words: Object.freeze(normalizedWords),
        wordsMeta: Object.freeze(
          normalizedWords.map((word) =>
            Object.freeze({
              value: word,
              aliases: Object.freeze([]),
              tags: Object.freeze([]),
              modeAAllowed: true,
              modeBAllowed: true,
            }),
          ),
        ),
        tags: Object.freeze([]),
        modes: Object.freeze({ modeA: true, modeB: true }),
      });
    }),
  );
}

function parseOptionalCategories(raw: unknown, sourceLabel: string): readonly LiarCategory[] {
  if (raw === undefined) {
    return Object.freeze([]);
  }

  return parseCategories(raw, sourceLabel);
}

function parseV2Categories(raw: unknown, sourceLabel: string): readonly LiarCategory[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${sourceLabel} 는 비어 있지 않은 배열이어야 합니다.`);
  }

  const seenIds = new Set<string>();
  return Object.freeze(
    raw.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`${sourceLabel} ${index + 1}번 항목 형식이 올바르지 않습니다.`);
      }

      const id = entry.id;
      const label = entry.label;
      const words = entry.words;

      if (!isNonEmptyString(id) || !isNonEmptyString(label)) {
        throw new Error(`${sourceLabel} ${index + 1}번 항목의 id 또는 label 이 비어 있습니다.`);
      }

      const normalizedId = id.trim();
      if (seenIds.has(normalizedId)) {
        throw new Error(`${sourceLabel} 에 중복 카테고리 id ${normalizedId} 이(가) 있습니다.`);
      }
      seenIds.add(normalizedId);

      if (!Array.isArray(words) || words.length === 0) {
        throw new Error(`${sourceLabel} ${normalizedId} 의 words 는 비어 있지 않은 배열이어야 합니다.`);
      }

      const defaultDifficulty = parseDifficulty(entry.defaultDifficulty);
      const normalizedWordMap = new Map<string, LiarCategoryWord>();
      for (const [wordIndex, word] of words.entries()) {
        if (!isRecord(word) || !isNonEmptyString(word.value)) {
          throw new Error(`${sourceLabel} ${normalizedId} 의 ${wordIndex + 1}번 단어 형식이 올바르지 않습니다.`);
        }

        const sensitivity = word.sensitivity;
        if (parseSensitivity(sensitivity) === "blocked") {
          continue;
        }

        const normalizedValue = word.value.trim();
        if (!normalizedWordMap.has(normalizedValue)) {
          normalizedWordMap.set(
            normalizedValue,
            Object.freeze({
              value: normalizedValue,
              aliases: parseStringArray(word.aliases),
              difficulty: parseDifficulty(word.difficulty) ?? defaultDifficulty,
              tags: parseStringArray(word.tags),
              sensitivity: parseSensitivity(sensitivity) === "caution" ? "caution" : parseSensitivity(sensitivity) === "safe" ? "safe" : undefined,
              modeAAllowed: word.modeAAllowed !== false,
              modeBAllowed: word.modeBAllowed !== false,
              notes: isNonEmptyString(word.notes) ? word.notes.trim() : undefined,
            }),
          );
        }
      }

      const normalizedWordsMeta = [...normalizedWordMap.values()];
      const normalizedWords = normalizedWordsMeta.map((word) => word.value);

      if (normalizedWords.length === 0) {
        throw new Error(`${sourceLabel} ${normalizedId} 에 사용 가능한 단어가 없습니다.`);
      }

      return Object.freeze({
        id: normalizedId,
        label: label.trim(),
        words: Object.freeze(normalizedWords),
        wordsMeta: Object.freeze(normalizedWordsMeta),
        description: isNonEmptyString(entry.description) ? entry.description.trim() : undefined,
        theme: isNonEmptyString(entry.theme) ? entry.theme.trim() : undefined,
        tone: isNonEmptyString(entry.tone) ? entry.tone.trim() : undefined,
        defaultDifficulty,
        tags: parseStringArray(entry.tags),
        modes: parseCategoryModes(entry.modes),
      });
    }),
  );
}

function parseOptionalV2Categories(raw: unknown, sourceLabel: string): readonly LiarCategory[] {
  if (raw === undefined) {
    return Object.freeze([]);
  }

  if (Array.isArray(raw) && raw.length === 0) {
    return Object.freeze([]);
  }

  return parseV2Categories(raw, sourceLabel);
}

function parseModeBPairs(raw: unknown, categories: readonly LiarCategory[], sourceLabel: string): readonly LiarModeBPair[] {
  if (raw === undefined) {
    return Object.freeze([]);
  }

  if (!Array.isArray(raw)) {
    throw new Error(`${sourceLabel} 는 배열이어야 합니다.`);
  }

  const categoryIds = new Set(categories.map((category) => category.id));
  const seenIds = new Set<string>();
  return Object.freeze(
    raw.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`${sourceLabel} ${index + 1}번 항목 형식이 올바르지 않습니다.`);
      }

      const id = entry.id;
      const citizenCategoryId = entry.citizenCategoryId;
      const liarCategoryId = entry.liarCategoryId;
      const weight = entry.weight;

      if (!isNonEmptyString(id) || !isNonEmptyString(citizenCategoryId) || !isNonEmptyString(liarCategoryId)) {
        throw new Error(`${sourceLabel} ${index + 1}번 항목의 id 또는 category id 가 비어 있습니다.`);
      }

      const normalizedId = id.trim();
      if (seenIds.has(normalizedId)) {
        throw new Error(`${sourceLabel} 에 중복 조합 id ${normalizedId} 이(가) 있습니다.`);
      }
      seenIds.add(normalizedId);

      if (!categoryIds.has(citizenCategoryId.trim()) || !categoryIds.has(liarCategoryId.trim())) {
        throw new Error(`${sourceLabel} ${normalizedId} 가 존재하지 않는 카테고리를 참조합니다.`);
      }

      const normalizedWeight = typeof weight === "number" && Number.isInteger(weight) && weight > 0 ? weight : 1;
      return Object.freeze({
        id: normalizedId,
        citizenCategoryId: citizenCategoryId.trim(),
        liarCategoryId: liarCategoryId.trim(),
        weight: normalizedWeight,
        difficulty: isNonEmptyString(entry.difficulty) ? entry.difficulty.trim() : undefined,
        tone: isNonEmptyString(entry.tone) ? entry.tone.trim() : undefined,
        notes: isNonEmptyString(entry.notes) ? entry.notes.trim() : undefined,
      });
    }),
  );
}

function parseV2CategoryResource(raw: unknown, sourceLabel: string): LoadedLiarCategoryResource {
  if (!isRecord(raw)) {
    throw new Error(`${sourceLabel} 형식이 올바르지 않습니다.`);
  }

  if (raw.schemaVersion !== 2) {
    throw new Error(`${sourceLabel} 의 schemaVersion 은 2여야 합니다.`);
  }

  const categories = parseV2Categories(raw.categories, `${sourceLabel} categories`);
  const modeBPairs = parseModeBPairs(raw.modeBPairs, categories, `${sourceLabel} modeBPairs`);
  return Object.freeze({
    categories,
    modeBPairs,
  });
}

function loadCategoryResource(): LoadedLiarCategoryResource {
  const v2Resource = readJsonResource(
    [
      resolve(__dirname, "../../resource/categories.v2.json"),
      resolve(process.cwd(), "liar/resource/categories.v2.json"),
    ],
    false,
  );

  if (v2Resource) {
    return parseV2CategoryResource(v2Resource.value, "라이어게임 카테고리 v2 리소스");
  }

  const resource = readJsonResource(
    [
      resolve(__dirname, "../../resource/categories.json"),
      resolve(process.cwd(), "liar/resource/categories.json"),
    ],
    true,
  );

  return Object.freeze({
    categories: parseCategories(resource?.value, "라이어게임 카테고리 리소스"),
    modeBPairs: Object.freeze([]),
  });
}

function loadGuildCategoryOverrides(): ReadonlyMap<string, LiarGuildCategoryOverride> {
  const resource = readJsonResource(
    [
      resolve(__dirname, "../../resource/guild-categories.json"),
      resolve(process.cwd(), "liar/resource/guild-categories.json"),
    ],
    false,
  );

  if (!resource) {
    return new Map();
  }

  const raw = resource.value as { guilds?: unknown };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("liar/resource/guild-categories.json 형식이 올바르지 않습니다.");
  }

  const guilds = raw.guilds;
  if (!guilds || typeof guilds !== "object" || Array.isArray(guilds)) {
    throw new Error("liar/resource/guild-categories.json 의 guilds 는 객체여야 합니다.");
  }

  const overrides = new Map<string, LiarGuildCategoryOverride>();
  for (const [guildId, entry] of Object.entries(guilds)) {
    if (!isNonEmptyString(guildId)) {
      throw new Error("guild-categories 의 guild id 는 비어 있을 수 없습니다.");
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`길드 ${guildId} 의 카테고리 팩 형식이 올바르지 않습니다.`);
    }

    const { mode, categories, schemaVersion, modeBPairs } = entry as {
      mode?: unknown;
      categories?: unknown;
      schemaVersion?: unknown;
      modeBPairs?: unknown;
    };
    const resolvedMode: LiarGuildCategoryMode = mode === "replace" ? "replace" : "extend";

    if (schemaVersion === 2) {
      const parsedCategories = parseOptionalV2Categories(categories, `길드 ${guildId} 카테고리 v2 팩`);
      if (resolvedMode === "replace" && parsedCategories.length === 0) {
        throw new Error(`길드 ${guildId} 의 replace v2 팩에는 최소 1개 이상의 카테고리가 필요합니다.`);
      }

      const categoriesForPairs =
        resolvedMode === "replace" ? parsedCategories : mergeCategories(liarCategories, parsedCategories);
      const parsedModeBPairs = parseModeBPairs(modeBPairs, categoriesForPairs, `길드 ${guildId} modeBPairs`);
      overrides.set(
        guildId,
        Object.freeze({
          mode: resolvedMode,
          categories: parsedCategories,
          modeBPairs: parsedModeBPairs,
        }),
      );
      continue;
    }

    const parsedCategories = parseOptionalCategories(categories, `길드 ${guildId} 카테고리 팩`);
    if (parsedCategories.length === 0) {
      throw new Error(`길드 ${guildId} 의 카테고리 팩에는 최소 1개 이상의 카테고리가 필요합니다.`);
    }

    overrides.set(
      guildId,
      Object.freeze({
        mode: resolvedMode,
        categories: parsedCategories,
        modeBPairs: Object.freeze([]),
      }),
    );
  }

  return overrides;
}

function mergeCategories(base: readonly LiarCategory[], override: readonly LiarCategory[]): readonly LiarCategory[] {
  const merged = [...base];
  for (const category of override) {
    const index = merged.findIndex((entry) => entry.id === category.id);
    if (index === -1) {
      merged.push(category);
      continue;
    }

    merged[index] = category;
  }

  return Object.freeze(merged);
}

function mergeModeBPairs(base: readonly LiarModeBPair[], override: readonly LiarModeBPair[]): readonly LiarModeBPair[] {
  const merged = [...base];
  for (const pair of override) {
    const index = merged.findIndex((entry) => entry.id === pair.id);
    if (index === -1) {
      merged.push(pair);
      continue;
    }

    merged[index] = pair;
  }

  return Object.freeze(merged);
}

const loadedCategoryResource = loadCategoryResource();

export const liarCategories: readonly LiarCategory[] = loadedCategoryResource.categories;
export const liarModeBPairs: readonly LiarModeBPair[] = loadedCategoryResource.modeBPairs;

const liarGuildCategoryOverrides = loadGuildCategoryOverrides();
const liarGuildCategoryCache = new Map<string, readonly LiarCategory[]>();
const liarGuildModeBPairCache = new Map<string, readonly LiarModeBPair[]>();

export function getLiarCategories(guildId?: string): readonly LiarCategory[] {
  if (!guildId) {
    return liarCategories;
  }

  const cached = liarGuildCategoryCache.get(guildId);
  if (cached) {
    return cached;
  }

  const override = liarGuildCategoryOverrides.get(guildId);
  if (!override) {
    return liarCategories;
  }

  const resolved = override.mode === "replace" ? override.categories : mergeCategories(liarCategories, override.categories);
  liarGuildCategoryCache.set(guildId, resolved);
  return resolved;
}

export function getLiarCategory(categoryId: string, guildId?: string): LiarCategory | null {
  return getLiarCategories(guildId).find((category) => category.id === categoryId) ?? null;
}

export function getLiarModeBPairs(guildId?: string): readonly LiarModeBPair[] {
  if (!guildId) {
    return liarModeBPairs;
  }

  const cached = liarGuildModeBPairCache.get(guildId);
  if (cached) {
    return cached;
  }

  const override = liarGuildCategoryOverrides.get(guildId);
  const resolvedPairs =
    !override
      ? liarModeBPairs
      : override.mode === "replace"
        ? override.modeBPairs
        : mergeModeBPairs(liarModeBPairs, override.modeBPairs);

  if (resolvedPairs.length === 0) {
    liarGuildModeBPairCache.set(guildId, resolvedPairs);
    return resolvedPairs;
  }

  const categoryIds = new Set(getLiarCategories(guildId).map((category) => category.id));
  const filteredPairs = resolvedPairs.filter(
    (pair) => categoryIds.has(pair.citizenCategoryId) && categoryIds.has(pair.liarCategoryId),
  );
  liarGuildModeBPairCache.set(guildId, filteredPairs);
  return filteredPairs;
}

export function getDefaultLiarCategory(guildId?: string): LiarCategory {
  const categories = getLiarCategories(guildId);
  if (categories.length === 0) {
    throw new Error("사용 가능한 라이어게임 카테고리가 없습니다.");
  }

  return categories[0];
}

export function hasGuildCategoryOverride(guildId: string): boolean {
  return liarGuildCategoryOverrides.has(guildId);
}
