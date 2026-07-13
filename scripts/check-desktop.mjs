import { access, readFile } from 'node:fs/promises';
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (config.version !== packageJson.version || cargoVersion !== packageJson.version) {
  throw new Error(`데스크톱 버전 불일치: package=${packageJson.version}, tauri=${config.version}, cargo=${cargoVersion}`);
}
if (config.build?.frontendDist !== '../dist') throw new Error('Tauri frontendDist가 Vite dist를 가리키지 않습니다.');
if (config.app?.withGlobalTauri !== true) throw new Error('Tauri global bridge가 비활성화되어 있습니다.');
if (!config.identifier || !config.productName) throw new Error('Tauri 앱 식별 정보가 없습니다.');
await access(new URL('../src-tauri/src/lib.rs', import.meta.url));
await access(new URL('../src-tauri/capabilities/default.json', import.meta.url));
await access(new URL('./native-runtime-smoke.mjs', import.meta.url));
const workflow = await readFile(new URL('../.github/workflows/desktop-build.yml', import.meta.url), 'utf8');
for (const platform of ['ubuntu-22.04', 'windows-latest', 'macos-latest']) {
  if (!workflow.includes(platform)) throw new Error(`${platform} 데스크톱 빌드 검증이 없습니다.`);
}
if (!workflow.includes('tauri-apps/tauri-action')) throw new Error('Tauri 패키징 액션이 없습니다.');
if (!workflow.includes('native:smoke')) throw new Error('빌드된 네이티브 앱 실행 검증이 없습니다.');
console.log(`Desktop config OK: ${config.productName} ${config.version} · cross-platform runtime smoke ready`);
