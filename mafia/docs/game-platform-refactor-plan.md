# 게임 플랫폼 리팩토링 계획안

## 목표

- 현재 `마피아 전용 Discord + Web 봇` 구조를 `다중 게임 플랫폼` 구조로 전환한다.
- 기존 마피아 게임은 기존처럼 `Discord 로비 + Web Dashboard` 방식으로 유지한다.
- 신규 라이어게임은 `Discord 채팅/DM` 중심 모듈로 별도 추가할 수 있게 만든다.

## 리팩토링 원칙

- 게임별 코드는 루트 아래 `/<game-id>` 모듈로 분리한다.
- 각 게임은 자기 전용 `docs/scripts/src/tests/resource`를 가진다.
- 현재 동작을 깨지 않는 범위에서 `마피아 전용 프로젝트 전체`를 `mafia/` 모듈로 이동한다.
- 웹 의존성은 `마피아 모듈 내부`에 격리하고, 차후 라이어게임은 웹 없이 붙일 수 있게 한다.

## 목표 구조

```text
/
  mafia/
    ABOUT.md
    docs/
    logs/
    resource/
    scripts/
    src/
    tests/
  liar/
    ABOUT.md
    PLAN.md
    src/
```

## 실행 단계

1. 루트의 마피아 관련 `docs/scripts/src/tests/resource`를 `mafia/` 아래로 이동한다.
2. 기존 `README.md`는 `mafia/ABOUT.md`로 이름을 바꾼다.
3. 빌드 스크립트, 정적 자산 경로, 테스트 import를 `mafia/` 기준으로 갱신한다.
4. 라이어게임 계획 문서는 `liar/PLAN.md`로 두고, `liar/src` 자리를 확보한다.
5. 루트 `package.json`은 현재 마피아 모듈 실행을 위임하는 상위 엔트리 역할만 맡긴다.

## 주의점

- 마피아 웹 자산 경로가 소스/빌드 환경에서 모두 정상 동작해야 한다.
- DB 마이그레이션, 프리뷰, 연습 시나리오 스크립트 경로가 새 구조를 따라가야 한다.
- 테스트 import 경로를 전부 새 위치로 정리해야 회귀가 없다.

## 실행 결과

- `mafia/src`, `mafia/resource`, `mafia/tests`, `mafia/scripts`, `mafia/docs` 분리 완료
- `README.md`를 `mafia/ABOUT.md`로 이동 완료
- 마피아 관련 보조 `.ts/.js/.py` 스크립트를 `mafia/scripts/legacy-tools`로 이동 완료
- 라이어 계획 문서를 `liar/PLAN.md`로 분리 완료
- 루트는 `mafia/`, `liar/`, 최소 상위 실행 설정만 남는 구조로 정리 완료
