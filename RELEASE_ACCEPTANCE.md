# AI Scene Director 1.0 Release Acceptance

정식 `1.0.0` 승격은 기능 개수나 테스트 수가 아니라 아래 필수 게이트가 모두 통과할 때만 허용합니다.

## 로컬 자동 게이트

```bash
npm ci
npm run verify:rc
```

검사 범위:

- 자동 회귀 테스트
- TypeScript와 Vite 프로덕션 빌드
- 앱·프로젝트 스키마·Tauri·Cargo 버전 일치
- 메인·Three.js 번들 예산
- Mixamo·VRM·Blender Generic GLB Fixture
- 복구 저널과 반복 편집 스트레스
- Chromium 앱 셸과 WebGL 미지원 안전 모드
- Ctrl/Cmd+K 명령 검색 상호작용
- 이미지·영상 AI ZIP의 모드별 파일 목록과 Manifest 참조 일치
- Stored ZIP 중앙 디렉터리·CRC·안전 경로 검증
- 내보낸 PNG 헤더와 UTF-8 텍스트 유효성 검증

## 플랫폼별 필수 증거

Windows, macOS, Linux 각각 다음 세 보고서가 필요합니다.

```text
BROWSER_SMOKE_<platform>.json
NATIVE_ARTIFACTS_<platform>.json
NATIVE_RUNTIME_<platform>.json
```

각 보고서는 다음 공통 식별 정보를 포함해야 합니다.

- `version`: 현재 RC 버전
- `releaseId`: 동일 Git 커밋과 동일 CI 실행을 나타내는 ID
- `platform`: 보고서 대상 운영체제
- `generatedAt`: 유효한 생성 시각
- `status: pass`

추가 필수 조건:

- 브라우저에서 React 앱과 명령 검색이 실제 동작함
- 설치 산출물이 한 개 이상이며 크기와 SHA-256이 유효함
- Tauri WebView와 React가 준비 완료를 보고함
- 네이티브 앱 종료 코드가 0임
- 실행 바이너리 크기와 SHA-256이 유효함
- Tauri 앱 내부 버전이 릴리스 버전과 일치함

## 통합 릴리스 게이트

GitHub Actions의 `release-gate` 작업은 세 플랫폼의 총 9개 증거를 다운로드해 다음을 실행합니다.

```bash
npm run release:gate:strict
```

판정:

- `ready`: 모든 필수 검사와 증거 무결성 통과
- `conditional`: 코드 차단 문제는 없지만 외부 증거가 부족함
- `blocked`: 자동 검사 실패 또는 수집된 증거의 불일치·위조 가능성 감지

게이트는 `RELEASE_EVIDENCE_MANIFEST.json`에 수집한 보고서의 SHA-256을 기록합니다.

## 정식 승격

```bash
npm run release:promotion:check
npm run release:promote
```

승격 도구는 다음 조건이 아니면 즉시 중단합니다.

- `RELEASE_GATE.json.status === "ready"`
- 게이트 버전과 패키지 버전 일치
- 플랫폼 증거 무결성 상태 `pass`
- 검증된 `releaseId` 존재
- 현재 버전이 `1.0.0-rc.N` 형식

## 수동 승인 시나리오

각 OS에서 최소 한 번 다음 흐름을 수행합니다.

1. 앱 설치와 첫 실행
2. 자연어로 다중 인물 Scene 생성
3. GLB 캐릭터 가져오기와 리그 확인
4. 포즈·관계·Action 편집
5. 프로젝트 폴더 저장 후 앱 재실행
6. 프로젝트 번들 내보내기와 다시 불러오기
7. Shot Package 생성
8. 오류 없이 종료 후 다시 열기

## 정식 출시 금지 조건

- 총 9개 플랫폼 보고서 중 하나라도 누락 또는 실패
- 보고서 버전·플랫폼·릴리스 ID 불일치
- 설치 파일 또는 실행 바이너리 체크섬 오류
- Tauri React 준비 완료 실패
- 프로젝트 저장·복원 데이터 손실
- 외부 GLB가 앱 전체를 중단시킴
- 최종 릴리스 게이트가 `ready`가 아님
