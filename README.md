# discord_mafia

Discord 서버에서 구동되는 `마피아42 시즌4 일반·클래식` 복제 봇입니다.

현재 범위는 아래로 고정합니다.

- 4~8인
- 일반/클래식
- `예언자`, `판사`, `교주팀` 제외
- 듀얼 고유능력 제외
- 룰방 로컬 규칙 제외

## Source Of Truth

- 규칙의 단일 기준 문서는 [RULE.md](/Users/lpaiu/vs/discord_mafia/RULE.md) 입니다.
- 엔진 구현, 역할 카드 설명, UI 예시 문서, 테스트는 `RULE.md`와 같은 semantics를 유지해야 합니다.

## 시작 방법

1. `.env`를 채웁니다.
2. 의존성을 설치합니다.
3. 봇을 실행합니다.

```bash
npm install
npm run dev
```

## 검증 명령

```bash
npm test
npm run build
```

## 주요 문서

- 규칙 기준: [RULE.md](/Users/lpaiu/vs/discord_mafia/RULE.md)
- 인게임 UI 예시: [INGAME_UI_EXAMPLES.md](/Users/lpaiu/vs/discord_mafia/docs/INGAME_UI_EXAMPLES.md)
- Discord 스모크 테스트 기록: [DISCORD_SMOKE_TEST_2026-03-23.md](/Users/lpaiu/vs/discord_mafia/docs/DISCORD_SMOKE_TEST_2026-03-23.md)

## 구현 메모

- 밤 시간: 25초
- 낮 토론 시간: 생존자 수 x 15초
- 투표 시간: 15초
- 최후의 반론: 15초
- 찬반 투표 시간은 환경변수로 조정합니다.
