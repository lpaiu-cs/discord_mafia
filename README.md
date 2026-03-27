# Discord Game Bot

이 저장소는 하나의 Discord 봇 런타임에서 `mafia/` 와 `liar/` 모듈을 함께 실행하는 상위 루트다.

- `mafia/`: 웹 대시보드 기반 마피아 모듈
- `liar/`: Discord 채널 기반 라이어게임 모듈
- 실제 실행 진입점: `dist/mafia/src/index.js`
- 루트 빌드/테스트는 두 모듈을 함께 다룬다

## 문서 역할

- `README.md`: 저장소 루트 기준 설치, 환경 변수, 빌드, 실행, 배포 문서
- `mafia/ABOUT.md`: 마피아 모듈의 범위, 구조, 게임 흐름, 개발 전용 진입점 문서
- `liar/ABOUT.md`: 라이어 모듈의 범위, 입력 체계, 운영 정책 문서

혼선이 나지 않게, 루트 사용법은 이 문서를 기준으로 보고 각 게임 설명은 각 모듈 `ABOUT.md` 를 기준으로 본다.

## 디렉토리 구조

- [mafia/ABOUT.md](./mafia/ABOUT.md)
- [liar/ABOUT.md](./liar/ABOUT.md)
- [liar/PLAN.md](./liar/PLAN.md)
- [mafia/docs/game-platform-refactor-plan.md](./mafia/docs/game-platform-refactor-plan.md)

## 빠른 시작

저장소 루트 `C:\vs\macro\discord_mafia` 에서 실행한다.

```bash
npm install
cp .env.example .env
```

그 다음 루트 `.env` 를 채운다. 예시 템플릿은 [`.env.example`](./.env.example) 이다.

DB 를 실제로 연결해서 쓸 계획일 때만 먼저 마이그레이션을 적용한다.

전제:

- 루트 `.env` 에 `DATABASE_URL` 이 채워져 있어야 한다.
- `DATABASE_URL` 이 비어 있으면 `npm run db:migrate` 는 실패하는 것이 정상이다.
- 현재 구조에서는 `DATABASE_URL` 이 없어도 봇 자체는 실행 가능하다.
- 이 경우 Postgres 대신 로컬 파일 전적 저장소가 사용되고, 런타임 데이터는 `mafia/runtime-data/game-stats.json` 에 기록된다.

```bash
npm run db:migrate
```

개발 실행:

```bash
npm run dev:mafia
```

프로덕션 빌드와 실행:

```bash
npm run build
npm run start
```

주의:

- `npm run build` 는 컴파일만 수행한다.
- Discord slash command 반영은 봇 프로세스가 실제로 시작될 때 다시 등록되므로, 명령 변경 후에는 `build` 뒤에 `start` 또는 PM2 재시작이 필요하다.

## 루트 npm 명령

### 공통 명령

- `npm run build`: 루트 TypeScript 빌드 + 마피아 웹 클라이언트 빌드
- `npm run build:debug`: 단계별 로그와 소요 시간을 더 자세히 출력
- `npm run build:clean`: `dist` 정리
- `npm run build:types`: 루트 TypeScript 컴파일만 실행
- `npm run test`: `mafia/`, `liar/` 테스트 전체 실행
- `npm run start`: 빌드된 봇 실행
- `npm run db:migrate`: `DATABASE_URL` 이 설정된 경우에만 Postgres shared business DB 스키마 적용
- `npm run build:web-client`: 마피아 웹 클라이언트만 다시 빌드

빌드가 멈춘 것처럼 보일 때는 아래 순서로 병목을 바로 볼 수 있다.

```bash
npm run build:debug
npm run build:types
npm run build:web-client
```

### 개발 실행

- `npm run dev`: `npm run dev:mafia` alias
- `npm run dev:mafia`: 루트 봇 런타임 실행

### 마피아 전용 개발 보조

- `npm run dev:mafia:preview`
- `npm run dev:mafia:practice`
- `npm run dev:mafia:practice1`
- `npm run dev:mafia:practice2`
- `npm run dev:mafia:practice3`
- `npm run dev:mafia:practice4`
- `npm run dev:mafia:practice:all`

마피아 전용 preview/practice 스크립트의 상세 용도는 [mafia/ABOUT.md](./mafia/ABOUT.md) 를 본다.

## PM2 운영

루트 `.env` 를 채운 뒤 사용한다.

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
npm run pm2:stop
npm run pm2:delete
```

PM2 설정 파일은 [ecosystem.config.cjs](./ecosystem.config.cjs) 이다.

## 환경 변수

전체 예시는 [`.env.example`](./.env.example) 를 기준으로 한다.

주요 변수:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `PUBLIC_BASE_URL`
- `WEB_SESSION_SECRET`
- `JOIN_TICKET_SECRET`
- `WEB_MODE`
- `QUICK_TUNNEL_ENABLED`
- `WEB_PORT`
- `DATABASE_URL`
- `DATABASE_SSL`

로컬 파일 fallback:

- `DATABASE_URL` 이 비어 있으면 전적/유저 프로필은 `mafia/runtime-data/game-stats.json` 에 저장된다.
- 이 파일은 Git 에 기록되지 않는다.

예시:

- 로컬 PostgreSQL: `DATABASE_URL=postgresql://postgres:password@localhost:5432/discord_game_bot`
- Supabase/외부 Postgres 류: 제공된 connection string 그대로 사용

## 모듈 개요

### Mafia

- Discord 로비 + 웹 대시보드 기반
- 유지 명령어: `/mafia create`, `/mafia dashboard`
- 상세 문서: [mafia/ABOUT.md](./mafia/ABOUT.md)

### Liar

- Discord 채널 기반
- 유지 명령어: `/liar create`, `/liar stats`, `/제시어`
- 상세 문서: [liar/ABOUT.md](./liar/ABOUT.md)
