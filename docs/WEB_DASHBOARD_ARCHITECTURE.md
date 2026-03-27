# WEB_DASHBOARD_ARCHITECTURE

## 목적

Discord는 로비/모집/참가/재입장 링크 발급과 공개 상태 미러링만 담당하고, 실제 게임 진행은 웹 대시보드에서 처리한다.

`RULE.md` 는 계속 single source of truth 로 유지한다.

## 책임 분리

### Discord responsibility

- 로비 생성
- 참가 버튼
- 게임 시작 안내
- 개인 입장 URL ephemeral 발급
- `/mafia dashboard`
- `/mafia rejoin`
- 공개 상태/결과 미러링
- 게임 종료 상태 재안내

### Web responsibility

- 공개 게임 상태 렌더링
- 공개 채팅
- 마피아/연인/망자 채팅
- 역할 카드 및 개인 결과 렌더링
- 개인 행동 제출
- WebSocket / polling 기반 실시간 갱신
- 세션 유지 및 재입장

## Auth flow

1. Discord 사용자가 참가 버튼 또는 `/mafia join` 을 누른다.
2. 서버는 raw 영구 토큰 대신 `1회용 join ticket` 을 발급한다.
3. join ticket payload
   - `gameId`
   - `discordUserId`
   - `issuedAt`
   - `expiresAt`
   - `jti`
   - `purpose=join`
4. ticket 은 `JOIN_TICKET_SECRET` 으로 HMAC 서명한다.
5. 사용자는 `/auth/exchange?ticket=...` 로 진입한다.
6. 서버는 아래를 순서대로 검증한다.
   - 서명
   - 만료
   - purpose
   - `jti` 1회 사용 여부
7. 성공 시 세션을 생성하고 `HttpOnly + Secure + SameSite=Lax` 쿠키를 발급한다.
8. ticket 은 즉시 사용 완료 처리되고 `/game/:gameId` 로 redirect 된다.

## Session model

- 세션은 서버 메모리 저장소 기준으로 관리한다.
- 현재 게임 진행 데이터와 세션은 `single-process runtime state` 로 취급한다.
- 프로세스 재시작 시 진행 중 게임과 세션은 복구하지 않는다.
- 쿠키에는 signed session id 만 들어간다.
- 쿠키 이름은 `gameId` 별로 분리한다.
  - 예: `mafia_session_<gameId>`
  - 따라서 같은 브라우저에서 서로 다른 게임 탭을 동시에 유지할 수 있다.
- 세션 식별 기준
  - `gameId`
  - `discordUserId`
  - `sessionId`
  - `csrfToken`
  - `createdAt`
  - `lastSeenAt`
- 정책
  - 같은 게임 같은 유저의 세션은 `최근 세션 1개만 유지`
  - 이전 세션 쿠키가 남아 있어도 서버에서 무효 처리

## Room model

- 현재 room 단위는 `guild 당 game 1개`
- room state 는 Game 엔진이 authoritative
- 웹은 엔진에서 아래 DTO 만 읽는다.
  - 공개 상태
  - 생존/사망 목록
  - 공개 결과
  - 개인 역할 카드
  - 개인 행동 가능 목록
  - 역할별 비밀 채팅 접근 권한
- Discord 공개 채널은 room state 의 요약/미러링만 담당한다.

## Reconnect / rejoin flow

- 기존 ephemeral 메시지는 source of truth 가 아니다.
- 사용자는 언제든 `/mafia dashboard` 또는 `/mafia rejoin` 으로 새 join ticket 을 발급받을 수 있다.
- 재발급 링크는 이전 링크와 별도 `jti` 를 가진다.
- exchange 성공 시 이전 세션은 무효화되고 새 세션만 유지된다.

## Fixed base URL vs Quick Tunnel

### fixed_base_url

- 기본값
- `PUBLIC_BASE_URL` 사용
- 운영 기본 경로
- HTTPS 종단과 쿠키 정책을 예측하기 쉽다

### quick_tunnel

- 실험용 provider
- `WEB_MODE=quick_tunnel` 이고 `QUICK_TUNNEL_ENABLED=true` 인 경우에만 사용
- `cloudflared tunnel --url http://127.0.0.1:<port>` 실행 후 `trycloudflare` URL 을 파싱
- 게임 단위로 provider handle 을 유지할 수 있도록 인터페이스를 분리

### Quick Tunnel limitation

- dev/test 성격
- 200 in-flight requests 제한
- SSE/WebSocket 등 연속 연결이 제한되거나 불안정할 수 있음
- 따라서 Quick Tunnel 등 불안정한 환경 대비용으로 fallback polling이 반드시 동작하도록 구성함

## 실시간 통신

- 현재 구현(최신 반영): WebSocket 중심 (+ Version 기반 short polling fallback)
- WebSocket 통로를 기본으로 상태 업데이트 브로드캐스트
- Fallback Polling 권장값 (웹소켓 연결 실패 시)
  - foreground: 2초
  - background/inactive: 5~10초
- API / Event 예시
  - Polling API: `GET /api/game/:id/state?sinceVersion=...`
  - WS Upgrade: `GET /api/game/:id/ws`
- 공통 응답 구조
  - 변경 없음: `changed=false`, `version`
  - 변경 있음: 전체 state DTO

## 채팅 / 권한 모델

### 공개 메인 채팅

- read: 전원
- write: 살아 있는 플레이어만, 현재 phase 에 맞는 경우만 허용

### 마피아 채팅

- read: 마피아팀 생존자
- write: 밤에만 허용

### 연인 채팅

- read: 연인 생존자
- write: 밤에만 허용

### 망자 채팅

- read: 밤의 망자, 밤의 영매
- write: 밤의 비성불 망자, 밤의 영매
- 성불된 망자는 읽기만 가능

모든 write API 는 `gameId + session.discordUserId + phase + rolePermission` 을 서버에서 다시 검증한다.

## 엔진 연동

- 엔진은 계속 서버 authoritative
- 웹 레이어는 아래 네 가지를 엔진 위에 얹는다.
  - game state -> web DTO serializer
  - role-specific private view builder
  - allowed actions builder
  - server-side action handlers
- 기존 Discord DM / secret channel 흐름은 기본 모드에서 비활성화한다

## Threat model

### URL 유출

- 입장 URL 자체가 유출될 수 있다
- 대응
  - ticket 짧은 TTL
  - 1회 사용
  - 세션 교환 후 즉시 폐기

### 로그 유출

- 웹 서버나 reverse proxy 로그에 full URL 이 남을 수 있다
- 대응
  - raw ticket / full URL 미기록
  - ticket hash 만 기록

### 재사용 공격

- 동일 URL 재클릭 또는 탈취 후 재사용 시도
- 대응
  - `jti` 사용 완료 테이블
  - exchange 성공 즉시 used 처리

### 세션 탈취

- 브라우저 저장소나 JS 접근으로 세션 탈취 시도
- 대응
  - `HttpOnly` 쿠키
  - `Secure`
  - `SameSite=Lax`
  - role/secret payload 를 `localStorage` 에 저장하지 않음

### 쿠키 처리와 세션 격리 취약 (말폼 쿠키)

- 비정상적이거나 오래된 포맷의 쿠키 파싱 시도시 서버 크래시(500 에러)를 유발할 수 있다
- 동일 브라우저 내에서 여러 게임 세션이 덮어씌워져 탈취/혼동이 생길 수 있다
- 대응
  - 파싱 시 안전한 try-catch 및 silent 만료 처리
  - `gameId` 별 쿠키 분리 (`mafia_session_<gameId>`)로 세션 격리
  - 조건부 `Secure` 발급 강화

### WebSocket 세션 우회 및 권한 미검증

- HTTP Upgrade 시 쿠키를 무시하거나, 연결 후 권한이 달라진 상태로 브로드캐스트/채팅이 인가될 수 있다
- 여러 탭에서 세션이 중복 연결되어 단일 액션/채팅이 중복 발송(race condition 등)될 수 있다
- 대응
  - HTTP Upgrade 핸들러 레벨에서 SameSite 세션 쿠키 검증
  - 모든 상태 변경 및 비밀 채팅(read/write) 액션 처리 시 `gameId + session.discordUserId + phase + 알맞은 role/alive 권한`을 매번 엄격하게 서버 사이드에서 재검증
  - 채팅 중복 적재 방지를 위한 클라이언트-서버 간 액션 밸리데이션 강화

### CSRF

- 상태 변경 API 에 cross-site 요청이 들어올 수 있다
- 대응
  - same-site cookie 정책
  - 상태 변경 요청에 `csrfToken` 검증

### 식별자 위조

- 클라이언트가 `gameId`, `userId`, `targetId` 를 임의 조작 가능
- 대응
  - 서버가 session 기준 사용자 식별
  - 타깃/phase/권한 전부 재검증

## 운영 주의

- Quick Tunnel 을 기본 운영 경로로 고정하지 않는다.
- ephemeral 메시지를 source of truth 로 쓰지 않는다.
- Discord DM 기반으로 되돌아가지 않는다.
- 비즈니스 데이터는 별도 DB에 저장하고, 진행 중 판 상태는 메모리에만 둔다.
