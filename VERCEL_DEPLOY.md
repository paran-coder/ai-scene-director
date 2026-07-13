# Vercel 배포 점검

## 이번 오류의 원인

이전 `package-lock.json`에는 개발 컨테이너 전용 npm 프록시 주소가 들어 있었습니다.
Vercel은 해당 내부 주소에 접근할 수 없어 `npm ci` 단계에서 실패할 수 있습니다.

수정본은 모든 `resolved` 주소를 `https://registry.npmjs.org/`로 변경했고,
Node 22 사용 조건을 `package.json`과 `.nvmrc`에 명시했습니다.

## Vercel 설정

- Framework Preset: Vite
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`
- Root Directory: 저장소 루트

## 재배포

1. 수정본의 파일을 GitHub 저장소 루트에 덮어씁니다.
2. 특히 `package.json`, `package-lock.json`, `vercel.json`이 최신인지 확인합니다.
3. Vercel Deployments에서 Redeploy를 선택합니다.
4. 가능하면 Use existing Build Cache를 끕니다.

## 로컬 재현 명령

```bash
rm -rf node_modules dist
npm ci
npm run build
```
