# GitHub·Vercel 업로드 안내 — RC11

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

- 상단에 `schema 1.0.0-rc.11`
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

- `UI_EXPORT_DIALOG_FIX.md`: 내보내기 팝업의 중복 닫기 제거와 글자 크기 개선 내용

## 메인 화면 타이포그래피 수정

- 패널 제목 16px
- 객체·샷 이름 14px
- 버튼·입력 13px
- 보조 정보 최소 11~12px
- 브라우저 계산 글자 크기 자동 검사 포함

자세한 내용은 `UI_MAIN_TYPOGRAPHY.md`를 참고하세요.

## AI용 내보내기 사용법 페이지

이번 패키지는 내보내기 팝업의 `내보낸 자료 사용법`에서 열리는 별도 전체 페이지를 포함합니다.

배포 후 확인 항목:

- AI용 내보내기 팝업에 `내보낸 자료 사용법` 버튼 표시
- 사용법 페이지에 가장 쉬운 시작, 이미지 생성용, 영상 생성용, 간단 내보내기 표시
- Pose·Depth·Mask와 ComfyUI 연결 예시 표시
- 파일별 설명 표 표시
- 페이지의 이미지·영상 버튼을 누르면 해당 내보내기 모드가 선택된 팝업으로 복귀

최종 업로드 파일 수는 97개입니다.
