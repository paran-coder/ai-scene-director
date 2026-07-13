# GitHub·Vercel 업로드 안내 — RC16

이 패키지는 GitHub 웹 업로드 100개 제한 안에 맞춘 소스 배포본입니다.

## 업로드

1. ZIP을 압축 해제합니다.
2. 압축 내부의 모든 파일과 폴더를 GitHub 저장소 루트에 업로드합니다.
3. `.github`, `.gitignore`, `.npmrc`, `.nvmrc`, `vercel.json`을 빠뜨리지 않습니다.
4. ZIP 자체나 `node_modules`, `dist`는 저장소에 올리지 않습니다.

## Vercel 설정

```text
Framework Preset: Vite
Root Directory: 비워 두기
Install Command: npm ci
Build Command: npm run build
Output Directory: dist
Node.js: 22.x
```

배포가 실패했던 저장소에서는 Build Cache를 사용하지 않고 다시 배포합니다.

## 정상 반영 확인

- 상단에 `schema 1.0.0-rc.16`
- `1 장면 만들기`
- `2 장면 수정하기`
- 노란색 `3 AI용 내보내기`
- 타임라인에 `동작 미리보기`
- `고급 도구` 안에 ComfyUI·JSON·점검·세션 기록

## 로컬 검증

```bash
npm ci
npm test
npm run build
```

## UI overlap patch

This package includes the first-edit guide layout patch. After deployment, create a scene and verify that the guide appears in a separate row above the viewport rather than covering the Move/Rotate/Scale toolbar.


## 이번 수정

- 편집 전용 `작업 밝기` 토글 추가
- 작업 밝기 보정이 AI용 내보내기 캡처에 섞이지 않도록 분리
- 선택한 포인트광 범위와 스포트라이트 각도·방향 시각화
- 조명 종류별 유효 설정만 활성화하고 설명 표시
- 자유 시점 조작 도움말 접기·상태 보존

## 메인 화면 타이포그래피 수정

- 패널 제목 16px
- 객체·샷 이름 14px
- 버튼·입력 13px
- 보조 정보 최소 11~12px
- 브라우저 계산 글자 크기 자동 검사 포함

자세한 내용은 `UI_MAIN_TYPOGRAPHY.md`를 참고하세요.

## AI용 내보내기 사용법 페이지

이번 패키지는 헤더의 노란색 `AI용 내보내기` 버튼 바로 오른쪽에 `내보내기 사용법` 버튼을 제공합니다. 내보내기 팝업을 먼저 열지 않아도 별도 전체 가이드 페이지에 바로 접근할 수 있습니다.

배포 후 확인 항목:

- 넓은 화면: `AI용 내보내기` 오른쪽에 `? 내보내기 사용법` 표시
- 좁은 화면: 같은 위치에서 `? 사용법`으로 축약되며 글자는 사라지지 않음
- 사용법 페이지에 가장 쉬운 시작, 이미지 생성용, 영상 생성용, 간단 내보내기 표시
- Pose·Depth·Mask와 ComfyUI 연결 예시 표시
- 파일별 설명 표 표시
- 페이지의 이미지·영상 버튼을 누르면 해당 내보내기 모드가 선택된 팝업으로 복귀

최종 업로드 파일 수는 99개입니다.


## RC13 사용법 버튼 표시 수정

- 버튼은 `AI용 내보내기`의 바로 오른쪽에 표시됩니다.
- 넓은 화면에서는 `? 내보내기 사용법`, 좁은 화면에서는 `? 사용법`으로 보입니다.
- `?` 아이콘만 보이는 이전 CSS는 제거했습니다.
- 배포 후 헤더의 `schema 1.0.0-rc.16`와 사용법 버튼을 함께 확인하세요.
- 자세한 원인과 회귀 검사는 `UI_EXPORT_GUIDE_ENTRY_FIX.md`에 정리되어 있습니다.

## RC13 내보내기 전환 문구 수정

- 사용법 페이지의 `이미지 생성용 열기`, `영상 생성용 열기` 문구를 제거했습니다.
- 새 문구는 `이미지용 자료 만들기`, `영상용 자료 만들기`입니다.
- 버튼 아래에 외부 생성 서비스가 아니라 업로드용 ZIP 설정을 연다는 설명을 표시합니다.
- 영상 설정 팝업 제목은 `영상 생성용 자료 만들기`로 표시됩니다.
- 팝업 상단에 `영상 생성 사이트로 이동하지 않습니다` 안내가 표시됩니다.
- 사용법 페이지에서 연 설정을 닫으면 편집기가 아니라 사용법 페이지로 돌아갑니다.

## RC14 내보내기 무결성 수정

- 이미지 ZIP의 `shot_manifest.json`은 `frames/reference.png`, `controls/pose.png`, `controls/depth.png`, `controls/entity_mask.png`를 참조합니다.
- 영상 ZIP의 매니페스트는 시작·종료 프레임과 시작·종료 제어 이미지를 참조합니다.
- 두 모드 모두 `prompts/final_prompt.txt`를 매니페스트에 포함합니다.
- ZIP을 생성한 뒤 앱이 다시 열어 파일 수, CRC, PNG 헤더와 텍스트를 검증한 후 다운로드합니다.


## RC16 뷰포트·조명 점검

- 뷰포트 상단의 `작업 밝기`를 끄고 켰을 때 편집 화면만 달라지는지 확인합니다.
- AI용 내보내기 캡처에는 작업 밝기 보조광이 포함되지 않습니다.
- 포인트광 선택 시 X·Y·Z 범위 링, 스포트라이트 선택 시 조사 콘이 나타나는지 확인합니다.
- 선택한 조명 구체를 드래그할 때 카메라가 아니라 조명 위치가 이동하는지 확인합니다.
- 필 라이트처럼 포인트광인 경우 각도 입력이 비활성화되고 범위만 조절되는지 확인합니다.
- 왼쪽 아래 조작 도움말을 접은 뒤 새로고침해도 접힌 상태가 유지되는지 확인합니다.
