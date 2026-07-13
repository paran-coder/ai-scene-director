import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { releaseIdentity } from './release-identity.mjs';

const strict = process.argv.includes('--strict');
const profileArgument = process.argv.find((argument) => argument.startsWith('--profile='))?.slice('--profile='.length);
const reportArgument = process.argv.find((argument) => argument.startsWith('--report='))?.slice('--report='.length);
const screenshotArgument = process.argv.find((argument) => argument.startsWith('--screenshot='))?.slice('--screenshot='.length);
const platformArgument = process.argv.find((argument) => argument.startsWith('--platform='))?.slice('--platform='.length);
const widthArgument = Number(process.argv.find((argument) => argument.startsWith('--width='))?.slice('--width='.length));
const heightArgument = Number(process.argv.find((argument) => argument.startsWith('--height='))?.slice('--height='.length));
const notebookProfile = profileArgument === 'notebook';
const viewportWidth = Number.isFinite(widthArgument) && widthArgument > 0 ? widthArgument : notebookProfile ? 1366 : 1440;
const viewportHeight = Number.isFinite(heightArgument) && heightArgument > 0 ? heightArgument : notebookProfile ? 768 : 920;
const platform = platformArgument || process.platform;
const identity = await releaseIdentity(platform);
const root = new URL('../', import.meta.url);
const distPath = new URL('../dist/', import.meta.url);
const defaultReportName = notebookProfile ? 'BROWSER_SMOKE_NOTEBOOK.json' : 'BROWSER_SMOKE.json';
const defaultScreenshotName = notebookProfile ? 'browser-smoke-notebook.png' : 'browser-smoke.png';
const reportPath = reportArgument ? resolve(process.cwd(), reportArgument) : new URL(`../${defaultReportName}`, import.meta.url);
const screenshotPath = screenshotArgument ? resolve(process.cwd(), screenshotArgument) : new URL(`../dist/${defaultScreenshotName}`, import.meta.url);
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
    const local = createStorage();
    local.setItem('ai-scene-director-onboarding-ai-export-v2', 'done');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
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
    '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, `--window-size=${viewportWidth},${viewportHeight}`, smokeUrl,
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
      expression: `(() => { const app = document.querySelector('[data-aisd-ready="true"]'); const bodyText = document.body.innerText; const runtimeNode = document.querySelector('[data-runtime-status]'); return { ready: Boolean(app), runtime: runtimeNode ? runtimeNode.getAttribute('data-runtime-status') : null, safeMode: Boolean(document.querySelector('[data-testid="viewport-safe-mode"]')), hasSceneGenerator: bodyText.includes('장면 만들기'), hasSceneHierarchy: bodyText.includes('씬 계층'), hasTimeline: Boolean(document.querySelector('.timeline-panel')), title: document.title, readyState: document.readyState, text: bodyText.slice(0, 1600), rootHtml: document.getElementById('root')?.innerHTML.slice(0, 1200) ?? '' }; })()`,
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
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.onboarding-actions button')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 180));
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
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.command-palette-search button')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const headerGuideEntryResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const exportButton = document.querySelector('.primary-export');
      const guideButton = document.querySelector('.export-guide-header-button');
      const guideLabel = guideButton?.querySelector('.export-guide-label');
      const exportRect = exportButton?.getBoundingClientRect();
      const guideRect = guideButton?.getBoundingClientRect();
      const buttonStyle = guideButton ? getComputedStyle(guideButton) : null;
      const labelStyle = guideLabel ? getComputedStyle(guideLabel) : null;
      return {
        exists: Boolean(guideButton),
        text: guideButton?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        visible: Boolean(guideRect && guideRect.width >= 70 && guideRect.height >= 30 && buttonStyle?.display !== 'none' && buttonStyle?.visibility !== 'hidden' && Number(buttonStyle?.opacity ?? 1) > 0),
        labelVisible: Boolean(guideLabel && labelStyle?.display !== 'none' && labelStyle?.visibility !== 'hidden'),
        adjacent: Boolean(exportRect && guideRect && guideRect.left >= exportRect.right - 1 && guideRect.left - exportRect.right <= 12),
        width: guideRect?.width ?? 0,
      };
    })()`,
    returnByValue: true,
  });
  const headerGuideEntry = headerGuideEntryResult?.result?.value;
  if (!headerGuideEntry?.exists || !headerGuideEntry.visible || !headerGuideEntry.labelVisible || !headerGuideEntry.adjacent || !String(headerGuideEntry.text).includes('사용법')) {
    throw Object.assign(new Error('헤더의 내보내기 사용법 버튼이 보이지 않거나 AI용 내보내기 바로 오른쪽에 배치되지 않았습니다.'), { appFailure: true, pageState: state, headerGuideEntry });
  }
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.primary-export')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const exportReviewResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const dialog = document.querySelector('[role="dialog"][aria-label="AI용 내보내기"]'); const text = dialog?.innerText ?? ''; return { open: Boolean(dialog), hasFilePlan: text.includes('이미지 생성용') && text.includes('영상 생성용'), blocked: text.includes('출력 전 수정 필요'), confirmVisible: text.includes('이미지 AI 자료 ZIP') }; })()`,
    returnByValue: true,
  });
  const exportReview = exportReviewResult?.result?.value;
  if (!exportReview?.open || !exportReview.hasFilePlan) throw Object.assign(new Error('AI용 내보내기 대화상자가 열리지 않았습니다.'), { appFailure: true, pageState: state });
  const exportPreview = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const exportPreviewName = notebookProfile ? 'ai-export-preview-notebook.png' : 'ai-export-preview.png';
  await writeFile(new URL(`../dist/${exportPreviewName}`, import.meta.url), Buffer.from(exportPreview.data, 'base64'));
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.ai-export-close')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.export-guide-header-button')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const exportGuideResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const guide = document.querySelector('[role="dialog"][aria-labelledby="ai-export-guide-title"]'); const text = guide?.innerText ?? ''; return { open: Boolean(guide), hasQuickStart: text.includes('기준 이미지와 최종 프롬프트'), hasImageGuide: text.includes('이미지 생성용'), hasVideoGuide: text.includes('영상 생성용'), hasComfyGuide: text.includes('ComfyUI'), fileRows: guide?.querySelectorAll('.guide-file-row').length ?? 0 }; })()`,
    returnByValue: true,
  });
  const exportGuide = exportGuideResult?.result?.value;
  if (!exportGuide?.open || !exportGuide.hasQuickStart || !exportGuide.hasImageGuide || !exportGuide.hasVideoGuide || exportGuide.fileRows < 10) {
    throw Object.assign(new Error('AI용 내보내기 사용법 페이지가 열리지 않았거나 핵심 설명이 누락됐습니다.'), { appFailure: true, pageState: state, exportGuide });
  }
  const guidePreview = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const guidePreviewName = notebookProfile ? 'ai-export-guide-preview-notebook.png' : 'ai-export-guide-preview.png';
  await writeFile(new URL(`../dist/${guidePreviewName}`, import.meta.url), Buffer.from(guidePreview.data, 'base64'));
  await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('.ai-export-guide-page button')).find((button) => button.textContent?.trim() === '영상용 자료 만들기')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const guideHandoffResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const dialog = document.querySelector('[role="dialog"][aria-label="AI용 내보내기"]'); const active = dialog?.querySelector('.ai-export-mode-grid > button.active'); const text = dialog?.innerText ?? ''; return { dialogOpen: Boolean(dialog), activeMode: active?.textContent ?? '', clearTitle: text.includes('영상 생성용 자료 만들기'), explainsDownload: text.includes('영상 생성 사이트로 이동하지 않습니다') && text.includes('ZIP') }; })()`,
    returnByValue: true,
  });
  const guideHandoff = guideHandoffResult?.result?.value;
  if (!guideHandoff?.dialogOpen || !String(guideHandoff.activeMode).includes('영상 생성용') || !guideHandoff.clearTitle || !guideHandoff.explainsDownload) {
    throw Object.assign(new Error('사용법 페이지에서 영상 내보내기 화면으로 이동하지 못했습니다.'), { appFailure: true, pageState: state, guideHandoff });
  }
  const videoHandoffPreview = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const videoHandoffPreviewName = notebookProfile ? 'video-export-handoff-preview-notebook.png' : 'video-export-handoff-preview.png';
  await writeFile(new URL(`../dist/${videoHandoffPreviewName}`, import.meta.url), Buffer.from(videoHandoffPreview.data, 'base64'));
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.ai-export-close')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const guideReturnResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const guide = document.querySelector('[role="dialog"][aria-labelledby="ai-export-guide-title"]'); return { reopened: Boolean(guide), text: guide?.innerText ?? '' }; })()`,
    returnByValue: true,
  });
  const guideReturn = guideReturnResult?.result?.value;
  if (!guideReturn?.reopened || !String(guideReturn.text).includes('내보낸 자료를 생성 AI에 적용하는 방법')) {
    throw Object.assign(new Error('사용법에서 연 내보내기 설정을 닫았을 때 사용법 페이지로 돌아오지 못했습니다.'), { appFailure: true, pageState: state, guideReturn });
  }
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.ai-export-guide-close')?.click()` });
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Mount the same first-edit guide markup as a workspace child and verify its real browser geometry.
  const firstEditLayoutResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const workspace = document.querySelector('.workspace');
      let guide = document.querySelector('.first-edit-guide');
      let synthetic = false;
      if (!guide && workspace) {
        synthetic = true;
        guide = document.createElement('section');
        guide.className = 'first-edit-guide';
        guide.setAttribute('data-smoke-guide', 'true');
        guide.innerHTML = '<div><span>장면 생성 완료 · 첫 수정 준비</span><strong>피사체 위치·포즈 수정</strong><small>주인공을 선택하고 이동 도구로 배치를 조정하세요.</small></div><div class="first-edit-actions"><button>주인공 수정</button><button>카메라 구도</button><button>첫 동작</button><button class="guide-close">닫기</button></div>';
        workspace.insertBefore(guide, workspace.children[1] ?? null);
      }
      let toolbar = document.querySelector('.viewport-toolbar');
      if (!toolbar) {
        const viewport = document.querySelector('.viewport');
        if (viewport) {
          toolbar = document.createElement('div');
          toolbar.className = 'viewport-toolbar';
          toolbar.setAttribute('data-smoke-toolbar', 'true');
          toolbar.innerHTML = '<button class="active">이동</button><button>회전</button><button>크기</button>';
          viewport.appendChild(toolbar);
        }
      }
      const rect = (node) => { if (!node) return null; const value = node.getBoundingClientRect(); return { top: value.top, left: value.left, right: value.right, bottom: value.bottom, width: value.width, height: value.height }; };
      const guideRect = rect(guide);
      const toolbarRect = rect(toolbar);
      const overlap = Boolean(guideRect && toolbarRect && guideRect.left < toolbarRect.right && guideRect.right > toolbarRect.left && guideRect.top < toolbarRect.bottom && guideRect.bottom > toolbarRect.top);
      const style = guide ? getComputedStyle(guide) : null;
      return { guideVisible: Boolean(guide), synthetic, guideRect, toolbarRect, overlap, position: style?.position ?? null, gridRow: style?.gridRowStart ?? null };
    })()`,
    returnByValue: true,
  });
  const firstEditLayout = firstEditLayoutResult?.result?.value;
  if (!firstEditLayout?.guideVisible || firstEditLayout.overlap) {
    throw Object.assign(new Error('첫 수정 안내가 표시되지 않았거나 뷰포트 툴바와 겹칩니다.'), { appFailure: true, pageState: state, firstEditLayout });
  }
  const firstEditPreview = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const firstEditPreviewName = notebookProfile ? 'first-edit-guide-notebook.png' : 'first-edit-guide.png';
  await writeFile(new URL(`../dist/${firstEditPreviewName}`, import.meta.url), Buffer.from(firstEditPreview.data, 'base64'));

  const layoutResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const rect = (selector) => { const node = document.querySelector(selector); if (!node) return null; const value = node.getBoundingClientRect(); return { top: value.top, left: value.left, right: value.right, bottom: value.bottom, width: value.width, height: value.height }; };
      const header = document.querySelector('.app-header');
      const visible = (value) => Boolean(value && value.bottom > 0 && value.top < window.innerHeight && value.right > 0 && value.left < window.innerWidth);
      const fontSize = (selector) => { const node = document.querySelector(selector); return node ? Number.parseFloat(getComputedStyle(node).fontSize) : null; };
      const areas = { header: rect('.app-header'), workspace: rect('.workspace'), shots: rect('.shot-strip'), timeline: rect('.timeline-panel'), command: rect('.command-bar') };
      const typography = {
        headerButton: fontSize('.app-header button'),
        panelTitle: fontSize('.panel h2'),
        entityName: fontSize('.entity strong'),
        entityMeta: fontSize('.entity small'),
        shotMeta: fontSize('.shot span'),
        timelineText: fontSize('.timeline-empty'),
        commandInput: fontSize('.command-bar input'),
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        verticalOverflow: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        headerOverflow: header ? Math.max(0, header.scrollWidth - header.clientWidth) : null,
        areas,
        typography,
        visible: { workspace: visible(areas.workspace), shots: visible(areas.shots), timeline: visible(areas.timeline), command: visible(areas.command) },
      };
    })()`,
    returnByValue: true,
  });
  const layout = layoutResult?.result?.value;
  if (!layout?.visible?.workspace || !layout?.visible?.shots || !layout?.visible?.timeline || !layout?.visible?.command) {
    throw Object.assign(new Error('핵심 편집 영역이 현재 화면 높이 안에 모두 표시되지 않았습니다.'), { appFailure: true, pageState: state, layout });
  }
  if ((layout.horizontalOverflow ?? 0) > 4 || (layout.headerOverflow ?? 0) > 4) {
    throw Object.assign(new Error(`편집 화면에 수평 잘림이 있습니다. 문서 ${layout.horizontalOverflow}px · 헤더 ${layout.headerOverflow}px`), { appFailure: true, pageState: state, layout });
  }
  if (notebookProfile && (layout.areas?.workspace?.height ?? 0) < 220) {
    throw Object.assign(new Error('노트북 화면에서 3D 작업 영역 높이가 220px보다 작습니다.'), { appFailure: true, pageState: state, layout });
  }
  const type = layout.typography ?? {};
  const tooSmall = [
    ['헤더 버튼', type.headerButton, 13],
    ['패널 제목', type.panelTitle, 15],
    ['객체 이름', type.entityName, 14],
    ['객체 보조 정보', type.entityMeta, 11],
    ['샷 보조 정보', type.shotMeta, notebookProfile ? 11 : 12],
    ['타임라인 안내', type.timelineText, 13],
    ['명령 입력', type.commandInput, 13],
  ].filter(([, value, minimum]) => typeof value === 'number' && value + 0.01 < minimum);
  if (tooSmall.length > 0) {
    throw Object.assign(new Error(`메인 화면 글자가 최소 가독성 기준보다 작습니다: ${tooSmall.map(([label, value, minimum]) => `${label} ${value}px < ${minimum}px`).join(', ')}`), { appFailure: true, pageState: state, layout });
  }
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (image?.data) await writeFile(screenshotPath, Buffer.from(image.data, 'base64'));
  cdp.close();
  report = {
    ...identity, generatedAt: new Date().toISOString(), status: 'pass', strict, platform: identity.platform, browserPath, url: smokeUrl, executionMode,
    injectedBundle, runtimeStatus: state.runtime ?? (state.safeMode ? 'unsupported' : null), safeMode: state.safeMode, title: state.title, interaction,
    profile: notebookProfile ? 'notebook' : 'default', viewport: { width: viewportWidth, height: viewportHeight }, layout, exportReview, exportGuide, guideHandoff, guideReturn, firstEditLayout,
    screenshot: `dist/${defaultScreenshotName}`, durationMs: Date.now() - startedAt.getTime(),
  };
} catch (error) {
  const blocked = Boolean(error?.blocked) || (!error?.appFailure && classifyBlocked(stderr));
  report = {
    ...identity, generatedAt: new Date().toISOString(), status: blocked ? 'blocked' : 'fail', strict, platform: identity.platform,
    reason: error instanceof Error ? error.message : String(error), pageState: error?.pageState ?? null, layout: error?.layout ?? null, durationMs: Date.now() - startedAt.getTime(),
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
