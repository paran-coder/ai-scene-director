# AI Scene Director 1.0 RC9

AI 이미지·영상 제작자가 생성 전에 인물, 소품, 공간, 카메라, 조명과 움직임을 3D로 연출하고, 결과를 생성 AI용 Shot Package로 출력하는 로컬 우선 프리비주얼라이제이션 도구입니다.

## RC9: 릴리스 증거 무결성과 1.0 승격 보호

RC9은 새로운 제작 기능을 추가하는 버전이 아니라 정식 1.0 승인 과정의 신뢰성을 강화합니다.

- Windows·macOS·Linux 보고서에 공통 `releaseId`와 앱 버전 기록
- 서로 다른 커밋·CI 실행에서 나온 보고서 혼합 차단
- 설치 파일과 실행 바이너리 SHA-256 검증
- Tauri WebView·React 준비 완료·종료 코드 교차 검증
- 9개 플랫폼 증거의 체크섬 매니페스트 생성
- 릴리스 게이트가 `ready`일 때만 작동하는 1.0 승격 도구
- 프로젝트 스키마 `1.0.0-rc.9`

## 핵심 제작 흐름

```text
아이디어 입력
→ 자연어 Scene 생성
→ 3D에서 인물·소품·카메라 수정
→ Shot과 Action 구성
→ 프로젝트 점검
→ Shot Package 출력
```

ComfyUI는 선택 가능한 로컬 출력 연결이며 핵심 제품의 필수 조건이 아닙니다.

## 실행

```bash
npm install
npm run dev
```

프로덕션 빌드:

```bash
npm run build
npm run preview
```

## RC 검증

```bash
npm run verify:rc
```

검증 범위:

- 132개 자동 회귀 테스트
- TypeScript와 Vite 프로덕션 빌드
- Tauri 정적 구성
- Chromium 앱 셸과 명령 검색 상호작용
- GLB 리그 Fixture 3종
- 반복 편집·복구 스트레스
- 번들 크기 예산
- 릴리스 증거 무결성 게이트

## 플랫폼 CI 증거

각 운영체제는 동일한 `AISD_RELEASE_ID` 아래 다음 보고서를 생성합니다.

```text
BROWSER_SMOKE_<platform>.json
NATIVE_ARTIFACTS_<platform>.json
NATIVE_RUNTIME_<platform>.json
```

세 운영체제의 총 9개 보고서가 모두 통과하고 버전·릴리스 ID·체크섬이 일치해야 `RELEASE_GATE.json`이 `ready`가 됩니다.

## 1.0 승격

현재 게이트 확인:

```bash
npm run release:promotion:check
```

게이트가 `ready`인 경우에만:

```bash
npm run release:promote
```

명령이 RC 버전과 프로젝트 스키마·Tauri·Cargo 버전을 `1.0.0`으로 동기화하고 `PROMOTION_RECORD.json`을 생성합니다. 외부 증거가 없거나 서로 다른 CI 실행의 보고서가 섞이면 승격은 차단됩니다.

## 주요 기능

- 자연어 다중 인물·소품·환경·멀티샷 생성
- Scene Base와 Shot Override
- 바라보기, 들기, 앉기, 표면 배치 관계
- 걷기, 회전, 집기, 내려놓기, 카메라 돌리·오빗 Action
- 타임라인 드래그·리사이즈·다중 선택·충돌 검사
- GLB 가져오기, 에셋 라이브러리, 본 매핑과 리타기팅
- 손·다리 IK, 발 고정, 절차형 걷기
- 카메라 렌즈, 조명, 참조 이미지
- 시작·종료 프레임, Pose, Depth, Mask, Prompt, Manifest 출력
- 프로젝트 번들, 자동 저장, 복구 저널, 프로젝트 점검
- 전역 명령 검색, 단축키, 로컬 제작 세션 기록
- WebGL 미지원 3D 안전 모드
- 선택형 로컬 ComfyUI 연결

## 현재 제한

- 이 실행 환경에는 Rust·WebKitGTK 설치가 불가능해 실제 네이티브 설치 파일을 직접 만들지 못했습니다.
- 정식 1.0은 GitHub Actions에서 Windows·macOS·Linux의 9개 실제 증거가 모두 통과해야 합니다.
- 실제 GPU WebGL 화면과 제작자 GLB 시각 호환성은 플랫폼·현장 테스트가 필요합니다.
- 절차형 걷기는 모션 캡처 수준이 아니며 얼굴·손가락·립싱크는 1.0 이후 범위입니다.
