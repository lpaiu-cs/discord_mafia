# LIAR_RESOURCE_V2_SCHEMA.md

## 목적

- 이 문서는 `liar` 의 단어 리소스를 `v1` 단순 배열 구조에서 `v2` 메타데이터 기반 구조로 확장하기 위한 스키마 설계 문서다.
- 현재는 `v2` 로더와 기본 팩이 이미 런타임에 연결되어 있다.
- 이 문서는 현재 구현 상태와 앞으로 붙일 품질 제어 항목을 함께 정리한다.

## 현재 런타임 반영 상태

- `liar/resource/categories.v2.json` 이 기본 로딩 우선순위다.
- `modeBPairs` 는 `modeB` 후보 생성에 실제 사용된다.
- `blocked` 단어는 런타임 후보에서 제외된다.
- 단어 `aliases` 는 라이어 최종 추리 정답 판정에 사용된다.
- 카테고리 `modes` 와 단어 `modeAAllowed` / `modeBAllowed` 는 시작 가능 여부와 후보 생성에 반영된다.
- `difficulty`, `tags`, `tone` 는 기본 출제 가중치에 반영된다.
- 현재 기본 가중치 방향은 `easy`, `familiar`, 태그가 정리된 단어/조합 우선이다.
- `notes` 는 아직 운영 품질 관리 메모 중심이다.

## 현재 `v1` 구조

현재 `liar/resource/categories.json` 구조:

```json
[
  {
    "id": "food",
    "label": "음식",
    "words": ["김치찌개", "비빔밥"]
  }
]
```

한계:

- 단어 난이도 구분 불가
- 별칭/동의어 관리 불가
- 민감도 관리 불가
- `modeB` 조합 품질 제어 불가
- 카테고리별 분위기/추천 용도 관리 불가

## `v2` 설계 목표

1. 카테고리 품질을 메타데이터로 관리한다.
2. 단어 난이도와 민감도를 데이터로 관리한다.
3. `modeA`, `modeB` 허용 여부를 리소스에서 통제한다.
4. `modeB` 카테고리 조합을 명시적으로 설계한다.
5. 이후 길드 전용 팩, 주간 팩, 이벤트 팩으로 확장 가능해야 한다.

## 파일 형태 제안

권장 기본 파일:

- `liar/resource/categories.v2.json`

초기 설계용 샘플:

- `liar/resource/categories.v2.sample.json`

## 최상위 구조

```json
{
  "schemaVersion": 2,
  "catalogId": "default-ko",
  "label": "기본 한국어 라이어 팩",
  "locale": "ko-KR",
  "updatedAt": "2026-04-13",
  "categories": [],
  "modeBPairs": []
}
```

### 최상위 필드

- `schemaVersion`
  - 현재는 `2`
- `catalogId`
  - 팩 식별자
- `label`
  - 사람이 읽는 팩 이름
- `locale`
  - 언어/문화권
- `updatedAt`
  - 팩 갱신 시각
- `categories`
  - 카테고리 목록
- `modeBPairs`
  - `modeB` 에서 허용할 시민/라이어 카테고리 조합

## 카테고리 구조

```json
{
  "id": "food",
  "label": "음식",
  "description": "일상 음식 중심 카테고리",
  "theme": "daily-life",
  "tone": "familiar",
  "defaultDifficulty": "easy",
  "tags": ["일상", "명사", "설명쉬움"],
  "modes": {
    "modeA": true,
    "modeB": true
  },
  "words": []
}
```

### 카테고리 필드

- `id`
  - 고유 카테고리 ID
- `label`
  - 사용자 노출 이름
- `description`
  - 운영자/에디터용 설명
- `theme`
  - 큰 분류
  - 예: `daily-life`, `culture`, `nature`, `school`, `work`
- `tone`
  - 플레이 감각
  - 예: `familiar`, `quirky`, `specialized`
- `defaultDifficulty`
  - 카테고리 기본 난이도
  - `easy | medium | hard`
- `tags`
  - 검색/필터/품질 관리용 태그
- `modes`
  - 각 모드 허용 여부
- `words`
  - 단어 목록

## 단어 구조

```json
{
  "value": "김치찌개",
  "aliases": ["김치 찌개"],
  "difficulty": "easy",
  "tags": ["한식", "국물", "뜨거움"],
  "sensitivity": "safe",
  "modeAAllowed": true,
  "modeBAllowed": true,
  "notes": "한국 사용자 기준 인지도가 높다"
}
```

### 단어 필드

- `value`
  - 실제 제시어
- `aliases`
  - 같은 단어로 볼 표기 변형
- `difficulty`
  - `easy | medium | hard`
- `tags`
  - 단서 품질과 조합성을 위한 태그
- `sensitivity`
  - `safe | caution | blocked`
- `modeAAllowed`
  - `modeA` 에 사용 가능한지
- `modeBAllowed`
  - `modeB` 에 사용 가능한지
- `notes`
  - 에디터 메모

## `modeB` 조합 구조

`modeB` 는 카테고리끼리 아무렇게나 섞지 않는다.

```json
{
  "id": "food-place-daily",
  "citizenCategoryId": "food",
  "liarCategoryId": "place",
  "weight": 4,
  "difficulty": "easy",
  "tone": "familiar",
  "notes": "일상 대화 소재라 자연스럽고 즉시 들키지 않는다"
}
```

### 조합 필드

- `id`
  - 조합 ID
- `citizenCategoryId`
  - 시민 카테고리
- `liarCategoryId`
  - 라이어 카테고리
- `weight`
  - 랜덤 선택 가중치
- `difficulty`
  - 조합 난이도
- `tone`
  - 조합 톤
- `notes`
  - 설계 이유

## 검증 규칙 제안

### 필수 검증

- 카테고리 `id` 중복 금지
- 단어 `value` 공백 금지
- 한 카테고리 안 단어 중복 금지
- `modeBPairs` 의 카테고리 ID 는 반드시 존재해야 함
- `blocked` 단어는 런타임 후보에서 제외

### 품질 검증

- `modeB` 전용 카테고리는 최소 20단어 이상 권장
- `hard` 비율이 한 카테고리에서 과도하게 높지 않아야 함
- `caution` 단어는 기본 팩에서는 별도 검토 후만 사용
- 너무 일반적인 단어와 너무 희귀한 단어가 섞이지 않게 관리

## 운영 규칙 제안

### 기본 팩

- `safe` 위주
- `familiar`, `easy`, `medium` 중심
- 서버 첫 인상용

### 실험 팩

- `quirky`
- `hard`
- `caution`
- 이벤트/길드 전용으로 분리

### 길드 override

- 현재 `guild-categories.json` 은 기존 `v1` 카테고리 배열과 `schemaVersion: 2` 기반 `v2` 길드 팩을 모두 지원한다.
- `v2` 길드 팩은 `categories` 와 `modeBPairs` 를 함께 가질 수 있다.
- `extend` 는 기본 팩 위에 카테고리와 조합을 병합하고, 같은 `id` 는 길드 팩이 덮어쓴다.
- `replace` 는 길드 팩의 카테고리/조합만 사용한다.

## 마이그레이션 전략

### Step 1

- `v2` 샘플 파일만 추가
- 문서와 샘플로 구조를 고정

### Step 2

- 로더에 `v1`/`v2` 어댑터 추가
- 테스트로 파싱과 검증부터 붙임

### Step 3

- 기본 팩을 `v2` 로 옮김
- `modeB` 조합 테이블을 실제 후보 생성에 연결
- 단어 `aliases` 와 모드 허용값을 엔진에 연결

### Step 4

- `difficulty`, `tags`, `tone` 를 출제 가중치와 추천 로직에 반영
- 길드 override 도 `v2` 구조로 확장
- 필요 시 기존 `v1` 파일은 제거

## 샘플 파일

실제 예시는 아래 파일을 본다.

- `liar/resource/categories.v2.sample.json`
