import { readFile } from 'node:fs/promises';

export function normalizePlatform(value) {
  const normalized = String(value || process.platform).toLowerCase();
  if (normalized === 'windows' || normalized.startsWith('win')) return 'windows';
  if (normalized === 'macos' || normalized === 'darwin' || normalized.startsWith('mac')) return 'macos';
  return 'linux';
}

export async function releaseIdentity(platformValue = process.platform) {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const commitSha = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || null;
  const runId = process.env.GITHUB_RUN_ID || process.env.CI_PIPELINE_ID || null;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT || process.env.CI_JOB_ID || null;
  const releaseId = process.env.AISD_RELEASE_ID
    || process.env.RELEASE_ID
    || [commitSha, runId, runAttempt].filter(Boolean).join('-')
    || `local-${packageJson.version}`;
  return {
    version: packageJson.version,
    releaseId,
    commitSha,
    runId,
    runAttempt,
    platform: normalizePlatform(platformValue),
  };
}
