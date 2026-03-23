# WEB_DASHBOARD_ARCHITECTURE

## 목적

Discord는 로비/모집/참가/재입장 링크 발급만 담당하고, 실제 게임 진행은 웹 대시보드에서 처리한다.

`RULE.md` 는 계속 single source of truth 로 유지한다.

## 책임 분리

### Discord responsibility

- 로비 생성
- 참가 버튼
- 게임 시작 안내
- 개인 입장 URL ephemeral 발급
- `/mafia dashboard`
- `/mafia rejoin`
- 게임 종료 상태 재안내

### Web responsibility

- 공개 게임 상태 렌더링
- 공개 채팅
- 마피아/연인/망자 채팅
- 역할 카드 및 개인 결과 렌더링
- 개인 행동 제출
- polling 기반 실시간 갱신
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
- 쿠키에는 signed session id 만 들어간다.
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
- SSE 미지원
- 따라서 1차 구현은 polling 기반이며 SSE/WebSocket 전제를 두지 않는다

## 실시간 통신

- 1차 구현: short polling
- 기본 권장값
  - foreground: 2초
  - background/inactive: 5~10초
- API 예시
  - `GET /api/game/:id/state?sinceVersion=...`
- 응답
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
