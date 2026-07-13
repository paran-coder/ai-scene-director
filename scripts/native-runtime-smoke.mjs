import { createHash } from 'node:crypto';
import { access, chmod, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { releaseIdentity } from './release-identity.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const platform = String(args.platform || process.platform);
const root = resolve(String(args.root || 'src-tauri/target/release'));
const reportPath = resolve(String(args.report || `NATIVE_RUNTIME_${platform}.json`));
const strict = Boolean(args.strict);
const timeoutMs = Number(args.timeout || 35_000);

function normalizePlatform(value) {
  if (value.startsWith('win')) return 'windows';
  if (value === 'darwin' || value.startsWith('mac')) return 'macos';
  return 'linux';
}
const normalizedPlatform = normalizePlatform(platform);
const identity = await releaseIdentity(normalizedPlatform);

async function walk(directory) {
  const out = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) out.push(...await walk(path));
      else out.push(path);
    }
  } catch { /* missing tree */ }
  return out;
}

async function executableCandidates() {
  const files = await walk(root);
  const preferred = [];
  if (normalizedPlatform === 'windows') {
    preferred.push(...files.filter((file) => /(?:^|[\\/])ai-scene-director\.exe$/i.test(file)));
  } else if (normalizedPlatform === 'macos') {
    preferred.push(...files.filter((file) => /\.app[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/.test(file)));
    preferred.push(...files.filter((file) => /(?:^|[\\/])ai-scene-director$/.test(file)));
  } else {
    preferred.push(...files.filter((file) => /(?:^|[\\/])ai-scene-director$/.test(file)));
  }
  return [...new Set(preferred)];
}

async function commandExists(command) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
    child.on('error', () => resolvePromise(false));
    child.on('close', (code) => resolvePromise(code === 0));
  });
}

async function writeFailure(reason, extra = {}) {
  const report = {
    ...identity,
    generatedAt: new Date().toISOString(),
    platform: identity.platform,
    status: 'fail',
    reason,
    root,
    ...extra,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`Native runtime ${normalizedPlatform}: fail · ${reason}`);
  if (strict) process.exitCode = 1;
}

await rm(reportPath, { force: true });
const candidates = await executableCandidates();
if (!candidates.length) {
  await writeFailure('실행 가능한 Tauri 앱 바이너리를 찾지 못했습니다.');
} else {
  const executable = candidates[0];
  try { await chmod(executable, 0o755); } catch { /* Windows or already executable */ }
  const useXvfb = normalizedPlatform === 'linux' && await commandExists('xvfb-run');
  const command = useXvfb ? 'xvfb-run' : executable;
  const commandArgs = useXvfb ? ['-a', executable] : [];
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const child = spawn(command, commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      AISD_NATIVE_SMOKE_REPORT: reportPath,
      AISD_NATIVE_SMOKE_PLATFORM: normalizedPlatform,
      RUST_BACKTRACE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  const exitCode = await new Promise((resolvePromise) => {
    child.on('error', () => resolvePromise(-1));
    child.on('close', (code) => resolvePromise(code ?? -1));
  });
  clearTimeout(timer);

  let appReport = null;
  try { appReport = JSON.parse(await readFile(reportPath, 'utf8')); } catch { /* handled below */ }
  if (!appReport || appReport.status !== 'pass') {
    await writeFailure(
      timedOut ? '네이티브 앱이 제한 시간 안에 WebView 로딩을 보고하지 못했습니다.' : '네이티브 앱의 WebView 로딩 성공 보고서가 없습니다.',
      { executable, exitCode, timedOut, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) },
    );
  } else {
    const info = await stat(executable);
    const executableSha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
    const report = {
      ...appReport,
      ...identity,
      appVersion: appReport.version ?? null,
      generatedAt: new Date().toISOString(),
      platform: identity.platform,
      executable: basename(executable),
      executablePath: executable,
      executableBytes: info.size,
      executableSha256,
      usedXvfb: useXvfb,
      exitCode,
      durationMs: Date.now() - startedAt,
      stdout: stdout.slice(-2000),
      stderr: stderr.slice(-2000),
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Native runtime ${normalizedPlatform}: pass · ${basename(executable)} · ${report.durationMs}ms`);
    if (strict && exitCode !== 0) process.exitCode = 1;
  }
}
