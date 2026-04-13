# Current Context

기준 시점: `2026-04-13`

## 현재 프롬프트 진행 상황

- 완료:
  - 루트 `business_plan.md` 작성
  - `README.md` 에 사업 계획 문서 링크 추가
  - `AGENTS.md` 장기 프로젝트용 지침 정비
  - `.clinerules` 작성
  - `@memory/` 초기 메모리 파일 생성
  - `liar` 업그레이드 제안 문서 작성
  - `liar` 단어 리소스 v2 스키마 문서 작성
  - `liar/resource/categories.v2.sample.json` 샘플 구조 작성
  - `liar/resource/categories.v2.json` 기본 팩 추가
  - `liar` v1/v2 겸용 카테고리 로더 구현
  - `liar` `modeB` 조합 테이블 로딩 및 우선 사용 구현
  - `liar` 종료 결과 카드 구현
  - `liar` 리매치 버튼 구현
  - `liar` 종료 상태 카드/리매치 테스트 추가
  - `liar` `/제시어` 개인 상태 카드 구현
  - `liar` 투표 선택 메뉴 UX 구현
  - `liar` 단어 메타데이터(`aliases`, 모드 허용값) 런타임 반영
  - `liar` 길드 override 의 `v2` 카테고리/`modeBPairs` 지원
  - `liar` `difficulty`/`tags`/`tone` 기반 출제 가중치 반영
- 아직 안 한 것:
  - 상태 메시지 단계별 UX 재구성은 진행 중
  - `difficulty`, `tags`, `tone` 를 운영자 설정/추천 UI 와 연결하는 단계는 아직 아님

## 현재 제품 상태

### 루트

- 하나의 Discord 봇 런타임에서 `liar/` 와 `mafia/` 를 함께 실행한다.
- 실제 실행 진입점은 현재 `dist/mafia/src/index.js` 기준이다.
- 빌드/테스트는 루트에서 함께 관리한다.

### `liar`

- Discord 채널 중심 게임
- 현재 범위:
  - `4~8인`
  - 서버당 동시 게임 `1개`
  - `modeA`, `modeB`
  - `/liar create`, `/liar stats`, `/제시어`
  - 버튼, 일반 메시지, `!투표`, `!스킵`
- 현재 특징:
  - 로비/설명/토론/투표/추리/종료 흐름 구현
  - 오디오 브로드캐스트 존재
  - shared business DB 또는 로컬 파일 전적 기록 존재
  - `/제시어` 는 개인 카드형 ephemeral 응답으로 단계별 행동 안내를 제공
  - 투표 단계는 상태 카드 선택 메뉴와 `!투표` prefix 를 병행 지원
  - `aliases` 기반 정답 추리 판정과 모드 허용값 기반 후보 필터가 동작
  - `guild-categories.json` 은 `v1`/`v2` 길드 팩과 길드 전용 `modeBPairs` 를 지원
  - 기본 출제는 `easy`, `familiar`, 태그가 정리된 단어/조합을 더 우선한다
- PMF 관점 우선순위:
  - 리매치 루프
  - 종료 요약 카드
  - 방장 운영 툴
  - 제시어 난이도 관리
  - `modeB` 조합 품질 제어

### `mafia`

- Discord 로비 + 웹 대시보드 기반 게임
- 시즌4 일반·클래식 일부 복제 범위
- 현재 코드상 `Ruleset` 은 임시로 `"balance"` 만 활성화되어 있다.
- shared business DB, 로컬 fallback, 웹 세션/대시보드, 연습 시나리오까지 포함한다.

## 활성 제약

- 마피아 규칙은 시즌4 공개 자료 우선, 미확정은 코드에 확정하지 않는다.
- `liar` 는 재시작 복구가 아직 없다.
- `liar` 는 `Message Content Intent`, `Guild Voice States Intent` 의존이 일부 있다.
- `DATABASE_URL` 이 없으면 전적은 `mafia/runtime-data/game-stats.json` fallback 을 쓴다.
- 장기 수익화는 가능하지만 `2026-04-13` 기준 Discord Premium Apps는 한국 개발팀에 기본 개방 상태가 아니다. 외부 결제가 현실적이다.

## 바로 다음 추천 작업

1. `liar` 상태 메시지 단계별 UX 재구성 마무리
2. `liar` 단계 전환 구조화 로그 정비
3. `liar` 방장 운영 버튼 강화
4. `liar` 단어 메타데이터를 난이도/추천/제외 로직에 연결
5. `mafia` 와 `liar` 공통 프로필/전적 뷰 설계

## 이번 턴 검증

- `npx tsx --test liar/tests/all.test.ts` 통과
- `npx tsc -p tsconfig.json --noEmit` 통과
- 테스트 중 `audio unavailable` 로그는 의도된 예외 시나리오 검증에서 발생

## 참고 문서

- 루트 전략: `business_plan.md`
- 라이어 계획: `liar/PLAN.md`
- 라이어 업그레이드: `liar/docs/LIAR_UPGRADE_PROPOSAL.md`
- 라이어 리소스 스키마: `liar/docs/LIAR_RESOURCE_V2_SCHEMA.md`
- 마피아 사업 계획: `mafia/docs/business_plan.md`
