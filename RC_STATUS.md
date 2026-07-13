# AI Scene Director 1.0 RC10 상태

## 자동 검증

- 자동 테스트: 140/140 통과
- TypeScript·Vite 프로덕션 빌드: 통과
- Tauri 정적 구성 검사: 통과
- Chromium React 앱 셸·명령 검색: 통과
- 릴리스 사전검사: 통과
- GLB 리그 Fixture: Mixamo·VRM·Generic 통과
- 반복 편집·복구 스트레스: 통과

## RC10 핵심 보강

- Shot Package 출력 전 준비 상태·생성 파일·주의 사항 확인
- 카메라 누락과 3D 렌더 불가 시 출력 차단
- 행동 충돌은 타임라인 수정으로 바로 안내
- 1366×768 Chromium 레이아웃 스모크 추가
- 헤더·문서 수평 넘침과 핵심 영역 가시성 검사
- 낮은 화면에서 명령창이 화면 밖으로 밀리는 그리드 오류 수정
- 기본·노트북 브라우저 검증을 RC 통합 검사에 포함


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
