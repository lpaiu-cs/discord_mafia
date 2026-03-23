# discord_mafia v2.0

Discord 서버에서 로비를 만들고, 실제 게임 진행은 웹 대시보드에서 처리하는 `마피아42 시즌4 일반·클래식` 복제 봇입니다.

## 현재 스코프

- 4~8인
- 일반/클래식
- `시즌4 초기` / `시즌4 밸런스`
- `간호사 제외`
- `예언자`, `판사`, `교주팀` 제외
- 듀얼 고유능력 제외
- 룰방 로컬 규칙 제외

`2017-03-10` 간호사 추가 이후 요소는 미구현 누락이 아니라 의도적 범위 제외입니다.

## Source Of Truth

- 규칙의 단일 기준 문서는 `RULE.md` 입니다.
- 엔진 구현, 웹 UI, 테스트, 운영 문서는 `RULE.md`와 같은 semantics를 유지해야 합니다.

## 아키텍처 요약

- Discord 책임
  - 로비 생성
  - 참가 버튼
  - 게임 시작 안내
  - 개인 입장 URL ephemeral 발급
  - `/mafia dashboard`
  - `/mafia rejoin`
  - 게임 종료 요약 안내
- Web 책임
  - 공개 게임 상태
  - 공개 채팅
  - 마피아/연인/망자 채팅
  - 개인 행동 UI
  - 세션/재입장 처리

기존 DM 기반 진행은 기본 경로에서 제거되었습니다. Discord는 로비와 링크 발급만 담당합니다.

## 웹 입장 흐름

1. Discord 로비에서 `참가` 버튼 또는 `/mafia join` 사용
2. 봇이 ephemeral 메시지로 개인 입장 링크를 발급
3. 링크는 `1회용 join ticket` 을 포함한 `/auth/exchange?ticket=...` 형태
4. 서버가 ticket 검증 후 세션 쿠키를 발급하고 `/game/:gameId` 로 이동
5. 이후 웹 대시보드는 short polling 으로 상태를 갱신

ephemeral 메시지가 사라져도 `/mafia dashboard` 또는 `/mafia rejoin` 으로 새 링크를 재발급할 수 있습니다.

## URL Provider

- 기본: `fixed_base_url`
  - `PUBLIC_BASE_URL` 사용
- 실험용: `quick_tunnel`
  - `WEB_MODE=quick_tunnel`
  - `QUICK_TUNNEL_ENABLED=true`
  - Cloudflare Quick Tunnel 제약 때문에 기본 운영 경로로 두지 않습니다.

실시간 전송은 SSE/WebSocket 전제를 두지 않고 1차 구현에서는 polling 기반입니다.

## 환경 변수

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_RULESET=initial|balance`
- `PUBLIC_BASE_URL`
- `WEB_SESSION_SECRET`
- `JOIN_TICKET_SECRET`
- `WEB_MODE=fixed|quick_tunnel`
- `QUICK_TUNNEL_ENABLED=true|false`
- `WEB_PORT`
- `JOIN_TICKET_TTL_SECONDS`
- `TRIAL_VOTE_SECONDS`
- `AUTO_DELETE_SECRET_CHANNELS`

## 시작 방법

1. `.env.example` 를 기준으로 `.env` 를 채웁니다.
2. 의존성을 설치합니다.
3. 봇과 웹 서버를 함께 실행합니다.

```bash
npm install
npm run dev
```

## 검증

```bash
npm test
npm run build
```

## 주요 문서

- `RULE.md`
- `docs/WEB_DASHBOARD_ARCHITECTURE.md`
- `docs/SMOKE_TEST_WEB.md`
- `docs/INGAME_UI_EXAMPLES.md`
- `docs/DISCORD_SMOKE_TEST_2026-03-23.md`

## 운영 메모

- Polling 기본값
  - foreground: 2초
  - background/inactive: 7초
- 상태 변경 API는 `version` 기반 최소 payload 응답을 지원합니다.
- 세션 정책은 `최근 세션 1개만 유지` 입니다.
