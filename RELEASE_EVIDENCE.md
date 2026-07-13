# RC16 Release Evidence

## 공통 릴리스 실행 ID

GitHub Actions는 모든 운영체제 작업에 다음 값을 제공합니다.

```text
AISD_RELEASE_ID=<commit sha>-<run id>-<run attempt>
```

브라우저, 설치 산출물, 네이티브 런타임 보고서가 이 값과 현재 앱 버전을 모두 포함합니다.

## 무결성 검사

`release:gate`는 다음을 차단합니다.

- 다른 커밋 또는 다른 CI 실행의 보고서 혼합
- RC 버전 불일치
- 플랫폼 이름 불일치
- 유효하지 않은 생성 시각
- 설치 파일이 없거나 크기가 0인 보고서
- 잘못된 설치 파일 SHA-256
- React가 준비되지 않은 Tauri 런타임
- 비정상 종료 코드
- 잘못된 실행 바이너리 SHA-256
- 앱 내부 버전과 패키지 버전 불일치

## 결과 파일

```text
RELEASE_GATE.json
RELEASE_EVIDENCE_MANIFEST.json
PROMOTION_PLAN.json
PROMOTION_RECORD.json  # 실제 승격 시에만 생성
```

`RELEASE_EVIDENCE_MANIFEST.json`은 최종 게이트가 읽은 9개 보고서의 SHA-256을 기록합니다.
