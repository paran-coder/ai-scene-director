import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { releaseIdentity } from './release-identity.mjs';

const root = new URL('../', import.meta.url);
const identity = await releaseIdentity(process.platform);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tauri = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!packageJson.version || packageJson.version !== tauri.version || packageJson.version !== cargoVersion) {
  throw new Error(`버전 불일치: package=${packageJson.version}, tauri=${tauri.version}, cargo=${cargoVersion}`);
}
if (tauri.bundle?.active !== true) throw new Error('Tauri bundle.active가 활성화되어 있지 않습니다.');
if (tauri.build?.frontendDist !== '../dist') throw new Error('Tauri frontendDist가 ../dist가 아닙니다.');

const distUrl = new URL('../dist/', import.meta.url);
await access(new URL('../dist/index.html', import.meta.url));
const assetsDir = new URL('../dist/assets/', import.meta.url);
const assetNames = await readdir(assetsDir);
const assets = [];
for (const name of assetNames) {
  const info = await stat(new URL(`../dist/assets/${name}`, import.meta.url));
  assets.push({ name, bytes: info.size });
}
const mainChunk = assets.find((asset) => /^index-.*\.js$/.test(asset.name));
const threeChunk = assets.find((asset) => /^three-core-.*\.js$/.test(asset.name));
if (!mainChunk) throw new Error('메인 JavaScript 청크를 찾지 못했습니다.');
if (mainChunk.bytes > 260 * 1024) throw new Error(`메인 청크가 RC 예산을 초과했습니다: ${mainChunk.bytes} bytes`);
if (!threeChunk || threeChunk.bytes > 800 * 1024) throw new Error(`Three.js 코어 청크가 RC 예산을 초과했습니다: ${threeChunk?.bytes ?? 0} bytes`);
for (const lazyPrefix of ['ProjectDoctorPanel-', 'ComfyPanel-', 'AssetLibraryPanel-', 'SceneGeneratorPanel-']) {
  if (!assets.some((asset) => asset.name.startsWith(lazyPrefix))) throw new Error(`${lazyPrefix} 지연 로딩 청크가 없습니다.`);
}

const fixtureNames = ['humanoid-smoke.glb', 'humanoid-vrm-smoke.glb', 'humanoid-generic-smoke.glb'];
const fixtures = [];
for (const name of fixtureNames) {
  const bytes = new Uint8Array(await readFile(new URL(`../public/fixtures/${name}`, import.meta.url)));
  if (bytes.length < 20 || String.fromCharCode(...bytes.slice(0, 4)) !== 'glTF') throw new Error(`${name} fixture가 유효하지 않습니다.`);
  fixtures.push({ name, bytes: bytes.length });
}

const workflow = await readFile(new URL('../.github/workflows/desktop-build.yml', import.meta.url), 'utf8');
for (const platform of ['ubuntu-22.04', 'windows-latest', 'macos-latest']) {
  if (!workflow.includes(platform)) throw new Error(`${platform} 패키징 작업이 없습니다.`);
}
if (!workflow.includes('verify:rc')) throw new Error('데스크톱 CI가 verify:rc를 실행하지 않습니다.');
if (!workflow.includes('node scripts/browser-smoke.mjs --strict')) throw new Error('데스크톱 CI가 실브라우저 스모크를 엄격 모드로 실행하지 않습니다.');
if (!workflow.includes('native:artifacts')) throw new Error('데스크톱 CI가 네이티브 설치 산출물을 검증하지 않습니다.');
if (!workflow.includes('native:smoke')) throw new Error('데스크톱 CI가 빌드된 Tauri 앱을 실제 실행하지 않습니다.');
if (!workflow.includes('NATIVE_RUNTIME_${{ matrix.artifact_platform }}.json')) throw new Error('데스크톱 CI가 네이티브 런타임 보고서를 보존하지 않습니다.');
if (!workflow.includes('release:gate:strict')) throw new Error('데스크톱 CI가 플랫폼 증거 통합 릴리스 게이트를 실행하지 않습니다.');
if (!workflow.includes('AISD_RELEASE_ID')) throw new Error('데스크톱 CI가 공통 릴리스 실행 ID를 설정하지 않습니다.');
if (!workflow.includes('RELEASE_EVIDENCE_MANIFEST.json')) throw new Error('데스크톱 CI가 릴리스 증거 체크섬 매니페스트를 보존하지 않습니다.');

const report = {
  ...identity,
  generatedAt: new Date().toISOString(),
  version: packageJson.version,
  result: 'pass',
  budgets: {
    mainChunkBytes: mainChunk.bytes,
    mainChunkLimitBytes: 260 * 1024,
    threeCoreBytes: threeChunk.bytes,
    threeCoreLimitBytes: 800 * 1024,
  },
  lazyChunks: assets.filter((asset) => /Panel-.*\.js$/.test(asset.name)).map((asset) => ({ name: basename(asset.name), bytes: asset.bytes })),
  desktopTargets: ['linux', 'windows', 'macos'],
  fixtures,
};
await writeFile(new URL('../dist/release-readiness.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Release preflight OK: ${report.version} · main ${(mainChunk.bytes / 1024).toFixed(1)}KB · three ${(threeChunk.bytes / 1024).toFixed(1)}KB`);
