import assert from "node:assert/strict";
import { test } from "node:test";
import { getDefaultLiarCategory, getLiarCategories, getLiarCategory, getLiarModeBPairs, hasGuildCategoryOverride } from "../src/content/categories";

test("길드 전용 확장 팩은 기본 카테고리에 새 항목을 추가한다", () => {
  const categories = getLiarCategories("example-extend-pack");

  assert.equal(hasGuildCategoryOverride("example-extend-pack"), true);
  assert.ok(categories.some((category) => category.id === "food"));
  assert.ok(categories.some((category) => category.id === "sports"));
  assert.equal(getLiarCategory("sports", "example-extend-pack")?.label, "스포츠");
});

test("길드 전용 교체 팩은 기본 카테고리 대신 자체 목록을 사용한다", () => {
  const categories = getLiarCategories("example-replace-pack");

  assert.equal(categories.length, 1);
  assert.equal(categories[0].id, "k-snack");
  assert.equal(getDefaultLiarCategory("example-replace-pack").id, "k-snack");
  assert.equal(getLiarCategory("food", "example-replace-pack"), null);
});

test("v2 기본 팩은 modeB 조합 정보를 함께 제공한다", () => {
  const pairs = getLiarModeBPairs();

  assert.ok(pairs.length > 0);
  assert.ok(pairs.some((pair) => pair.citizenCategoryId === "food" && pair.liarCategoryId === "animal"));
  assert.ok(pairs.every((pair) => pair.weight >= 1));
});

test("v2 기본 팩은 단어 메타데이터를 함께 보존한다", () => {
  const food = getLiarCategory("food");

  assert.ok(food);
  assert.equal(food?.defaultDifficulty, "easy");
  assert.equal(food?.modes.modeA, true);
  assert.equal(food?.wordsMeta.length, food?.words.length);

  const kimchi = food?.wordsMeta.find((word) => word.value === "김치찌개");
  assert.ok(kimchi);
  assert.deepEqual(kimchi?.aliases, ["김치 찌개"]);
  assert.equal(kimchi?.modeAAllowed, true);
  assert.equal(kimchi?.modeBAllowed, true);
});

test("길드 교체 팩에서는 사용할 수 없는 기본 modeB 조합을 제거한다", () => {
  const pairs = getLiarModeBPairs("example-replace-pack");

  assert.equal(pairs.length, 0);
});

test("길드 v2 확장 팩은 단어 메타데이터와 modeB 조합을 함께 추가한다", () => {
  const categories = getLiarCategories("example-v2-extend-pack");
  const sports = getLiarCategory("sports", "example-v2-extend-pack");
  const pairs = getLiarModeBPairs("example-v2-extend-pack");

  assert.equal(hasGuildCategoryOverride("example-v2-extend-pack"), true);
  assert.ok(categories.some((category) => category.id === "food"));
  assert.ok(sports);
  assert.deepEqual(sports?.wordsMeta.find((word) => word.value === "축구")?.aliases, ["사커"]);
  assert.ok(pairs.some((pair) => pair.id === "guild-food-sports"));
  assert.ok(pairs.some((pair) => pair.id === "food-animal"));
});

test("길드 v2 교체 팩은 자체 카테고리와 자체 modeB 조합만 사용한다", () => {
  const categories = getLiarCategories("example-v2-replace-pack");
  const pairs = getLiarModeBPairs("example-v2-replace-pack");

  assert.equal(categories.length, 2);
  assert.equal(getDefaultLiarCategory("example-v2-replace-pack").id, "weather");
  assert.equal(getLiarCategory("food", "example-v2-replace-pack"), null);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.id, "weather-music");
});
