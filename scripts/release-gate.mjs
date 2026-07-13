import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { evaluateReleaseQualification } from '../src/domain/releaseQualification.ts';
import { validateReleaseEvidenceMatrix } from '../src/domain/releaseEvidence.ts';

const strict = process.argv.includes('--strict');
const platforms = ['linux', 'windows', 'macos'];
async function json(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
async function fileSha256(path) { try { return createHash('sha256').update(await readFile(path)).digest('hex'); } catch { return null; } }
const preflight = await json('dist/release-readiness.json') ?? await json('RELEASE_READINESS.json');
const localBrowser = await json('BROWSER_SMOKE.json');
const evidenceByPlatform = {};
for (const platform of platforms) {
  evidenceByPlatform[platform] = {
    browser: await json(`BROWSER_SMOKE_${platform}.json`),
    artifacts: await json(`NATIVE_ARTIFACTS_${platform}.json`),
    runtime: await json(`NATIVE_RUNTIME_${platform}.json`),
  };
}

function aggregateStatus(reports, requiredCount) {
  if (reports.length !== requiredCount) return 'not-run';
  if (reports.some((item) => item.status === 'fail' || item.status === 'not-found')) return 'fail';
  if (reports.some((item) => item.status === 'blocked')) return 'blocked';
  return reports.every((item) => item.status === 'pass') ? 'pass' : 'not-run';
}

const platformBrowsers = platforms.map((platform) => evidenceByPlatform[platform].browser).filter(Boolean);
const nativeReports = platforms.map((platform) => evidenceByPlatform[platform].artifacts).filter(Boolean);
const nativeRuntimeReports = platforms.map((platform) => evidenceByPlatform[platform].runtime).filter(Boolean);
const expectedReleaseId = process.env.AISD_RELEASE_ID || process.env.RELEASE_ID || undefined;
const evidenceValidation = validateReleaseEvidenceMatrix(
  evidenceByPlatform,
  preflight?.version ?? '',
  expectedReleaseId,
);

const preflightIdentityPass = preflight?.result === 'pass' && (!expectedReleaseId || preflight?.releaseId === expectedReleaseId);
const checks = [
  { id: 'automated-preflight', label: '자동 테스트·빌드·번들 예산', required: true, status: preflightIdentityPass ? 'pass' : 'fail', detail: expectedReleaseId && preflight?.releaseId !== expectedReleaseId ? `release id mismatch: ${preflight?.releaseId ?? 'missing'}` : preflight?.version },
  { id: 'browser-smoke-local', label: '현재 환경 실브라우저 앱 셸·안전 모드', required: false, status: localBrowser?.status ?? 'not-run', detail: localBrowser?.executionMode ?? localBrowser?.reason ?? localBrowser?.runtimeStatus },
  { id: 'browser-smoke-platforms', label: 'Windows·macOS·Linux 실브라우저 검증', required: true, status: aggregateStatus(platformBrowsers, platforms.length), detail: `${platformBrowsers.length}/${platforms.length} platform reports` },
  { id: 'native-installers', label: 'Windows·macOS·Linux 설치 산출물', required: true, status: aggregateStatus(nativeReports, platforms.length), detail: `${nativeReports.length}/${platforms.length} platform reports` },
  { id: 'native-runtime', label: 'Windows·macOS·Linux Tauri WebView 실제 실행', required: true, status: aggregateStatus(nativeRuntimeReports, platforms.length), detail: `${nativeRuntimeReports.length}/${platforms.length} platform reports` },
  { id: 'release-evidence-integrity', label: '플랫폼 증거 버전·실행 ID·체크섬 일치', required: true, status: evidenceValidation.status === 'pass' ? 'pass' : evidenceValidation.status === 'fail' ? 'fail' : 'not-run', detail: evidenceValidation.issues.slice(0, 3).join(' | ') || evidenceValidation.releaseId || 'evidence pending' },
  { id: 'rig-fixtures', label: 'Mixamo·VRM·Generic GLB 리그', required: true, status: (preflight?.fixtures?.length ?? 0) >= 3 ? 'pass' : 'fail' },
  { id: 'long-session-stress', label: '반복 편집·복구 스트레스', required: true, status: preflight?.result === 'pass' ? 'pass' : 'fail' },
];
const qualification = evaluateReleaseQualification(checks);
const report = {
  generatedAt: new Date().toISOString(),
  version: preflight?.version ?? null,
  expectedReleaseId: expectedReleaseId ?? null,
  evidence: {
    localBrowser: localBrowser ? 1 : 0,
    platformBrowsers: platformBrowsers.map((item) => item.platform),
    nativePlatforms: nativeReports.map((item) => item.platform),
    nativeRuntimePlatforms: nativeRuntimeReports.map((item) => item.platform),
    validation: evidenceValidation,
  },
  ...qualification,
  checks,
};
await writeFile('RELEASE_GATE.json', `${JSON.stringify(report, null, 2)}\n`);
const evidenceFiles = platforms.flatMap((platform) => [
  `BROWSER_SMOKE_${platform}.json`,
  `NATIVE_ARTIFACTS_${platform}.json`,
  `NATIVE_RUNTIME_${platform}.json`,
]);
const evidenceManifest = {
  generatedAt: new Date().toISOString(),
  version: report.version,
  releaseId: evidenceValidation.releaseId,
  gateStatus: qualification.status,
  files: Object.fromEntries((await Promise.all(evidenceFiles.map(async (path) => [path, await fileSha256(path)]))).filter(([, hash]) => hash)),
};
await writeFile('RELEASE_EVIDENCE_MANIFEST.json', `${JSON.stringify(evidenceManifest, null, 2)}\n`);
console.log(`Release gate: ${qualification.status} · pending=${qualification.pendingExternal.join(',') || 'none'} · blockers=${qualification.blockers.join(',') || 'none'}`);
if (qualification.status === 'blocked' || (strict && qualification.status !== 'ready')) process.exitCode = 1;
