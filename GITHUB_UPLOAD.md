# GitHub·Vercel 업데이트 안내

이 폴더는 GitHub 웹 업로드 100개 제한 안에 맞춘 UI 수정본입니다.

- 실제 파일 수: 최종 ZIP 기준 91개 이하
- 제외: `node_modules`, `dist`, 빌드 캐시, 임시 릴리스 보고서

## 반영 순서

1. 이 ZIP을 압축 해제합니다.
2. GitHub 저장소의 기존 소스 파일을 이 폴더 내용으로 교체합니다.
3. `.github`, `.gitignore`, `vercel.json` 같은 숨김·설정 파일도 함께 업로드합니다.
4. Vercel에서 해당 저장소와 브랜치가 연결됐는지 확인합니다.
5. Vercel Deployments에서 **Redeploy**를 선택하고 **Use existing Build Cache를 끈 상태**로 다시 배포합니다.
6. 배포 후 상단에 `schema 1.0.0-rc.10`, 뷰포트에 `정면 맞춤`, 헤더에 `사용법`이 표시되는지 확인합니다.

## 수정 내용

- 초기 자유 시점을 장면 정면(-Z)으로 변경
- 거대한 뒷벽이 피사체를 가리지 않도록 자동 프레이밍 개선
- `정면 맞춤` 복구 버튼 추가
- 마우스 시점 조작 힌트 추가
- 처음 접속 시 6단계 사용법 자동 표시
- 상단에서 언제든 다시 여는 `사용법` 버튼 추가
- 헤더 기능을 핵심 작업·도구·프로젝트 메뉴로 재구성
- 근접 검정·노랑 중심 디자인 토큰과 패널·샷·타임라인 위계 통일
- Shot Package 출력 사전점검과 생성 파일 미리보기
- 1366×768 노트북 화면 잘림 방지 및 자동 검증

## 로컬 검증

```bash
npm ci
npm test
npm run build
npm run browser:smoke:notebook
```


## Vercel 설치 오류 수정

이 패키지는 `package-lock.json`의 패키지 주소를 공개 npm 레지스트리로 정리했습니다.
Vercel 재배포 전에 `package.json`, `package-lock.json`, `vercel.json`을 반드시 최신 파일로 교체하세요.
