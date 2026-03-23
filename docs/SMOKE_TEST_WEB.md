# SMOKE_TEST_WEB

## 전제

- `RULE.md` 기준 스코프 유지
- 현재 스코프는 `간호사 제외`, `예언자/판사/교주팀 제외`, `8인 이하`
- 기본 운영 모드는 `WEB_MODE=fixed`

## 2인 로컬 테스트

2인으로 실제 게임을 끝까지 진행할 수는 없지만, 링크/세션/재입장/채팅/권한은 빠르게 확인할 수 있다.

## 1인 개발자 프리뷰

실제 Discord 없이 웹 UI 를 바로 보려면:

```bash
npm run dev:preview
```

기본 프리뷰:

- role: `mafia`
- phase: `night`
- ruleset: `balance`
- port: `3010`

PowerShell 예시:

```powershell
$env:PREVIEW_PHASE='discussion'
$env:PREVIEW_ROLE='reporter'
$env:PREVIEW_RULESET='balance'
npm run dev:preview
```

이 경로로 확인할 수 있는 것:

- `/auth/exchange` -> 세션 쿠키 -> `/game/:id`
- 공개/비밀 채팅 패널 렌더링
- 단계별 행동 패널 렌더링
- polling 동작

이 경로로 확인하기 어려운 것:

- 실제 Discord interaction 발급
- 실제 다인원 상호작용 결과
- 실제 quick tunnel 네트워크 경로

### 준비

1. `.env` 설정
   - `PUBLIC_BASE_URL`
   - `WEB_SESSION_SECRET`
   - `JOIN_TICKET_SECRET`
   - `WEB_MODE=fixed`
2. `npm run dev`
3. Discord 테스트 서버에서 봇이 slash command 를 등록했는지 확인

### 체크리스트

- `/mafia create` 로 로비 생성
- A, B 계정이 각각 `/mafia join` 또는 `참가` 버튼 사용
- 각 계정이 ephemeral 메시지에서 서로 다른 입장 URL 을 받는지 확인
- 링크가 `/auth/exchange?ticket=` 형태인지 확인
- 같은 링크를 두 번 열면 두 번째는 실패하는지 확인
- `/mafia dashboard` 또는 `/mafia rejoin` 으로 새 링크가 재발급되는지 확인
- 첫 링크로 만든 세션이 새 링크 교환 뒤 무효화되는지 확인
- `/game/:gameId` 에 role/raw state 가 query string 으로 노출되지 않는지 확인
- 브라우저 쿠키가 `HttpOnly`, `Secure`, `SameSite=Lax` 로 내려가는지 확인
- 상태 polling 이 2초 간격으로 동작하는지 확인
- inactive 탭에서 polling 간격이 늘어나는지 확인
- discussion phase 에서 공개 채팅 write 가능 여부 확인
- dead 상태로 시드 후 공개 채팅 write 금지 확인
- dead 상태로 시드 후 graveyard write 허용 확인

## 8인 실제 테스트 체크리스트

### 로비 / 입장

- 8명 모두 Discord 로비에서 참가
- 8명 모두 개인 URL 을 수신
- 1명 이상이 링크를 잃어버린 뒤 `/mafia rejoin` 으로 복구
- 참가자 외 유저가 `/mafia dashboard` 를 실행했을 때 거부

### 게임 진행

- 시작 후 Discord 에는 로비/안내만 남고 실제 진행은 웹에서 이뤄지는지 확인
- 공개 상태 패널이 phase 전환마다 업데이트되는지 확인
- 역할 카드와 개인 결과가 세션별로 다르게 보이는지 확인
- 공개 채팅 / 마피아 채팅 / 연인 채팅 / 망자 채팅 권한이 phase/생사/역할에 맞는지 확인
- 마담 유혹, 기자 공개, 테러 산화, 영매 성불, 성직자 부활 후속 선택이 웹에서 처리되는지 확인
- polling `sinceVersion` 응답이 변경 없을 때 최소 payload 로 내려오는지 확인

### 종료 / 운영

- 종료 시 Discord 에 종료 상태가 다시 표시되는지 확인
- ended 상태 대시보드에서 최종 결과를 읽을 수 있는지 확인
- 새 `/mafia create` 시 이전 ended game 이 새 로비로 교체되는지 확인

## reconnect / rejoin 검증

- 브라우저 새로고침 후 기존 세션 유지 확인
- 다른 브라우저에서 같은 링크 재사용 실패 확인
- `/mafia rejoin` 으로 새 링크 발급 후 이전 브라우저 세션이 401 로 막히는지 확인
- 탭 복제 후 오래된 세션으로 action/chat 제출 시 거부되는지 확인

## quick_tunnel 실험 체크

- `WEB_MODE=quick_tunnel`
- `QUICK_TUNNEL_ENABLED=true`
- `cloudflared` 설치

확인 항목:

- trycloudflare URL 파싱 성공
- `/auth/exchange` 와 polling 이 정상 동작
- SSE 없이 polling 만으로 플레이 가능
- 동시 요청이 몰릴 때 Quick Tunnel 제한을 넘지 않는지 관찰
