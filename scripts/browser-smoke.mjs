import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { releaseIdentity } from './release-identity.mjs';

const strict = process.argv.includes('--strict');
const reportArgument = process.argv.find((argument) => argument.startsWith('--report='))?.slice('--report='.length);
const platformArgument = process.argv.find((argument) => argument.startsWith('--platform='))?.slice('--platform='.length);
const platform = platformArgument || process.platform;
const identity = await releaseIdentity(platform);
const root = new URL('../', import.meta.url);
const distPath = new URL('../dist/', import.meta.url);
const reportPath = reportArgument ? resolve(process.cwd(), reportArgument) : new URL('../BROWSER_SMOKE.json', import.meta.url);
const screenshotPath = new URL('../dist/browser-smoke.png', import.meta.url);
const timeoutMs = 18_000;
const startedAt = new Date();

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'], ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.glb', 'model/gltf-binary'],
]);

async function findBrowser() {
  const candidates = [process.env.CHROME_PATH, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable',
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      try { await access(candidate); return candidate; } catch { continue; }
    }
    const result = await new Promise((resolve) => {
      const child = spawn(process.platform === 'win32' ? 'where' : 'which', [candidate]);
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('close', (code) => resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : null));
      child.on('error', () => resolve(null));
    });
    if (result) return result;
  }
  return null;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
      const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
      let fileUrl = new URL(safe, distPath);
      try { await access(fileUrl); } catch { fileUrl = new URL('index.html', distPath); }
      const body = await readFile(fileUrl);
      response.writeHead(200, { 'content-type': mime.get(extname(fileUrl.pathname)) ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('스모크 테스트 서버 포트를 확인하지 못했습니다.');
  return { server, url: `http://127.0.0.1:${address.port}/?smoke=1` };
}


async function buildInjectedAppBundle() {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [new URL('../src/main.tsx', import.meta.url).pathname],
    bundle: true,
    write: false,
    outdir: join(tmpdir(), 'aisd-browser-smoke-bundle'),
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
    logLevel: 'silent',
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const style = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('브라우저 주입용 단일 JavaScript 번들을 만들지 못했습니다.');
  return { script, style };
}

async function installInjectedApp(cdp) {
  const bundle = await buildInjectedAppBundle();
  const frameTree = await cdp.send('Page.getFrameTree');
  const frameId = frameTree?.frameTree?.frame?.id;
  if (!frameId) throw new Error('브라우저 주입 대상 프레임을 찾지 못했습니다.');
  await cdp.send('Page.setDocumentContent', {
    frameId,
    html: `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Scene Director Smoke</title><style>${bundle.style.replaceAll('</style>', '<\\/style>')}</style></head><body><div id="root"></div></body></html>`,
  });
  const storageShim = `(() => {
    const createStorage = () => {
      const values = new Map();
      return {
        get length() { return values.size; },
        clear() { values.clear(); },
        getItem(key) { key = String(key); return values.has(key) ? values.get(key) : null; },
        key(index) { return [...values.keys()][index] ?? null; },
        removeItem(key) { values.delete(String(key)); },
        setItem(key, value) { values.set(String(key), String(value)); },
      };
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: createStorage() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: createStorage() });
    globalThis.__AISD_SMOKE_INJECTED__ = true;
  })()`;
  const shimResult = await cdp.send('Runtime.evaluate', { expression: storageShim, returnByValue: true });
  if (shimResult?.exceptionDetails) throw new Error(`브라우저 저장소 대체 실패: ${shimResult.exceptionDetails.text}`);
  const scriptResult = await cdp.send('Runtime.evaluate', { expression: bundle.script, awaitPromise: true });
  if (scriptResult?.exceptionDetails) {
    const detail = scriptResult.exceptionDetails.exception?.description ?? scriptResult.exceptionDetails.text;
    throw Object.assign(new Error(`앱 단일 번들 실행 실패: ${detail}`), { appFailure: true });
  }
  return { scriptBytes: Buffer.byteLength(bundle.script), styleBytes: Buffer.byteLength(bundle.style) };
}

async function waitForJson(url, deadline) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error(`시간 안에 ${url}에 연결하지 못했습니다.`);
}

function cdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Chrome DevTools WebSocket 연결 실패')), { once: true });
  });
  return {
    opened,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

function classifyBlocked(log) {
  return /EGL_NOT_INITIALIZED|Could not bind NETLINK|xcb_connect\(\) failed|Permission denied|Failed to connect to the bus/i.test(log);
}

let server;
let browser;
let userDataDir;
let stderr = '';
let report;
try {
  await access(new URL('../dist/index.html', import.meta.url));
  const browserPath = await findBrowser();
  if (!browserPath) throw Object.assign(new Error('Chromium 또는 Chrome 실행 파일을 찾지 못했습니다.'), { blocked: true });
  const hosted = await startStaticServer();
  server = hosted.server;
  const smokeUrl = hosted.url;
  userDataDir = await mkdtemp(join(tmpdir(), 'aisd-browser-smoke-'));
  const debugPort = 9222 + Math.floor(Math.random() * 500);
  const args = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--allow-file-access-from-files', '--disable-web-security',
    '--disable-background-networking', '--disable-default-apps', '--disable-extensions', '--disable-sync', '--metrics-recording-only',
    '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, '--window-size=1440,920', smokeUrl,
  ];
  browser = spawn(browserPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const deadline = Date.now() + timeoutMs;
  let pages;
  try { pages = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, deadline); }
  catch (error) {
    const blocked = classifyBlocked(stderr);
    throw Object.assign(new Error(blocked ? '현재 실행 환경이 Chromium의 EGL·DBus·네트워크 초기화를 차단했습니다.' : `브라우저 디버깅 연결 실패: ${error}`), { blocked });
  }
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('브라우저 페이지 DevTools 주소를 찾지 못했습니다.');
  const cdp = cdpClient(page.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  let state;
  let executionMode = 'http';
  let injectedBundle = null;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const app = document.querySelector('[data-aisd-ready="true"]'); const bodyText = document.body.innerText; const runtimeNode = document.querySelector('[data-runtime-status]'); return { ready: Boolean(app), runtime: runtimeNode ? runtimeNode.getAttribute('data-runtime-status') : null, safeMode: Boolean(document.querySelector('[data-testid="viewport-safe-mode"]')), hasSceneGenerator: bodyText.includes('AI 씬 생성'), hasSceneHierarchy: bodyText.includes('씬 계층'), hasTimeline: Boolean(document.querySelector('.timeline-panel')), title: document.title, readyState: document.readyState, text: bodyText.slice(0, 1600), rootHtml: document.getElementById('root')?.innerHTML.slice(0, 1200) ?? '' }; })()`,
      returnByValue: true,
    });
    state = result?.result?.value;
    if (/organization.*allow|links are blocked|site is blocked/i.test(state?.text ?? '') && executionMode === 'http') {
      injectedBundle = await installInjectedApp(cdp);
      executionMode = 'cdp-injected';
      state = null;
      await new Promise((resolve) => setTimeout(resolve, 350));
      continue;
    }
    if (state?.ready && (state?.safeMode || (state?.runtime && state.runtime !== 'checking'))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!state?.ready) throw Object.assign(new Error('앱 준비 표시를 확인하지 못했습니다.'), { pageState: state });
  if (!state.hasSceneGenerator || !state.hasSceneHierarchy || !state.hasTimeline) {
    throw Object.assign(new Error('핵심 편집 UI가 브라우저 DOM에 표시되지 않았습니다.'), { appFailure: true, pageState: state });
  }
  if (state.runtime === 'unsupported' && !state.safeMode) throw Object.assign(new Error('WebGL 미지원 환경에서 3D 안전 모드가 활성화되지 않았습니다.'), { appFailure: true, pageState: state });
  await new Promise((resolve) => setTimeout(resolve, 350));
  await cdp.send('Runtime.evaluate', {
    expression: `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }))`,
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const interactionResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const dialog = document.querySelector('[role="dialog"][aria-label="명령 검색"]'); const input = dialog?.querySelector('input'); return { commandPaletteOpen: Boolean(dialog), commandInputFocused: document.activeElement === input, commandCount: dialog?.querySelectorAll('.command-palette-results > button').length ?? 0, buttonCount: document.querySelectorAll('button').length }; })()`,
    returnByValue: true,
  });
  const interaction = interactionResult?.result?.value;
  if (!interaction?.commandPaletteOpen || interaction.commandCount < 1) throw Object.assign(new Error('Ctrl/Cmd+K 명령 검색 상호작용이 브라우저에서 동작하지 않았습니다.'), { appFailure: true, pageState: state });
  await cdp.send('Runtime.evaluate', { expression: `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))` });
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (image?.data) await writeFile(screenshotPath, Buffer.from(image.data, 'base64'));
  cdp.close();
  report = {
    ...identity, generatedAt: new Date().toISOString(), status: 'pass', strict, platform: identity.platform, browserPath, url: smokeUrl, executionMode,
    injectedBundle, runtimeStatus: state.runtime ?? (state.safeMode ? 'unsupported' : null), safeMode: state.safeMode, title: state.title, interaction,
    screenshot: 'dist/browser-smoke.png', durationMs: Date.now() - startedAt.getTime(),
  };
} catch (error) {
  const blocked = Boolean(error?.blocked) || (!error?.appFailure && classifyBlocked(stderr));
  report = {
    ...identity, generatedAt: new Date().toISOString(), status: blocked ? 'blocked' : 'fail', strict, platform: identity.platform,
    reason: error instanceof Error ? error.message : String(error), pageState: error?.pageState ?? null, durationMs: Date.now() - startedAt.getTime(),
    logTail: stderr.split(/\r?\n/).slice(-30).join('\n'),
  };
} finally {
  if (browser && !browser.killed) {
    const closed = new Promise((resolve) => browser.once('close', resolve));
    browser.kill('SIGKILL');
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1200))]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  if (userDataDir) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { await rm(userDataDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
  }
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Browser smoke: ${report.status}${report.reason ? ` · ${report.reason}` : ''}`);
if (report.status === 'fail' || (strict && report.status !== 'pass')) process.exitCode = 1;
