# Repo Map

## 루트

- `README.md`
  - 설치, 실행, 빌드, 환경 변수, 운영 진입점
- `AGENTS.md`
  - 저장소용 장기 에이전트 지침
- `.clinerules`
  - 짧은 실행 규칙
- `business_plan.md`
  - `liar` 중심 멀티게임 사업 계획
- `package.json`
  - 루트 스크립트
- `scripts/run-build.mjs`
  - 통합 빌드 스크립트
- `ecosystem.config.cjs`
  - PM2 운영 설정
- `@memory/`
  - 장기 메모리

## `liar/`

- `ABOUT.md`
  - 운영 구조와 입력 체계 설명
- `PLAN.md`
  - 라이어 확장 계획
- `docs/LIAR_UPGRADE_PROPOSAL.md`
  - UI/UX, 종료 경험, 리매치, 리소스 업그레이드 제안
- `docs/LIAR_RESOURCE_V2_SCHEMA.md`
  - 단어 리소스 v2 스키마 설계
- `RULE.md`
  - 라이어 규칙 기준 문서
- `src/index.ts`
  - 라이어 모듈 진입점
- `src/engine/model.ts`
  - 라이어 타입 정의
- `src/engine/game.ts`
  - 라이어 핵심 상태 전이
- `src/engine/registry.ts`
  - 서버 단위 게임 레지스트리
- `src/discord/service.ts`
  - Discord 상호작용/상태 메시지/단계 진행 연결
- `src/discord/commands.ts`
  - slash command 연결
- `src/content/categories.ts`
  - 기본/길드별 카테고리 팩 로딩
- `tests/`
  - 엔진, 카테고리, Discord 서비스 테스트
- `resource/`
  - 카테고리 JSON, 오디오 자원
- `resource/categories.v2.json`
  - 현재 기본 카테고리/단어/`modeB` 조합 리소스
- `resource/categories.v2.sample.json`
  - 차세대 카테고리/단어 메타데이터 샘플

## `mafia/`

- `ABOUT.md`
  - 모듈 설명
- `docs/RULE.md`
  - 시즌4 기준 규칙 문서
- `docs/business_plan.md`
  - 마피아 중심 사업 계획 초안
- `docs/game-platform-refactor-plan.md`
  - 플랫폼 리팩터 계획
- `src/index.ts`
  - 루트 런타임 진입점
- `src/game/model.ts`
  - 역할/팀/상태 타입
- `src/game/game.ts`
  - 마피아 게임 엔진과 상태 전이
- `src/game/rules.ts`
  - 역할 배정과 규칙성 데이터
- `src/game/resolution.ts`
  - 밤 결과/판정 로직
- `src/discord/commands.ts`
  - Discord 명령
- `src/web/**`
  - 대시보드 서버, 라우트, 클라이언트
- `src/db/**`
  - shared business DB, 전적 저장, migration
- `tests/`
  - 게임 엔진, 대시보드, 저장소, 권한, 세션 테스트
- `resource/`
  - 역할 아이콘, 오디오, 액션 이미지

## 기타

- `dist/`
  - 빌드 결과
- `node_modules/`
  - 의존성
- `long_term_ui_ux_plan.md`
  - 별도 장기 UI/UX 메모
- 루트 `src/`
  - 현재 사실상 비어 있음

## 자주 쓰는 명령

- `npm run build`
- `npm run test`
- `npm run dev:mafia`
- `npm run db:migrate`
