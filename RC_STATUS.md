# AI Scene Director 1.0 RC9 상태

## 자동 검증

- 자동 테스트: 132/132 통과
- TypeScript·Vite 프로덕션 빌드: 통과
- Tauri 정적 구성 검사: 통과
- Chromium React 앱 셸·명령 검색: 통과
- 릴리스 사전검사: 통과
- GLB 리그 Fixture: Mixamo·VRM·Generic 통과
- 반복 편집·복구 스트레스: 통과

## RC9 핵심 보강

- 플랫폼 보고서에 앱 버전과 공통 `releaseId` 추가
- 다른 CI 실행의 보고서 혼합 차단
- 설치 산출물 SHA-256과 실행 바이너리 SHA-256 검증
- Tauri 앱 내부 버전과 릴리스 버전 교차 검사
- WebView·React 준비 완료·정상 종료 코드 필수화
- 9개 증거 파일의 `RELEASE_EVIDENCE_MANIFEST.json` 생성
- `ready` 게이트에서만 동작하는 `release:promote` 도구 추가

## 현재 릴리스 게이트

현재 상태: `conditional`

통과:

- 자동 테스트·빌드·번들 예산
- 현재 Linux Chromium 앱 셸 검사
- GLB 리그 Fixture
- 반복 편집·복구 스트레스

외부 증거 대기:

- Windows·macOS·Linux 브라우저 보고서 3/3
- Windows·macOS·Linux 설치 산출물 보고서 3/3
- Windows·macOS·Linux 네이티브 런타임 보고서 3/3
- 모든 보고서의 동일 버전·릴리스 실행 ID·유효 체크섬

실제 3개 OS 증거가 없으므로 정식 1.0 승격 도구는 현재 차단됩니다.
