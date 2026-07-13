export type ReleasePlatform = 'linux' | 'windows' | 'macos';
export type EvidenceStatus = 'pass' | 'fail' | 'blocked' | 'not-found' | 'not-run' | string;

export interface ReleaseEvidenceIdentity {
  version?: string;
  releaseId?: string;
  platform?: string;
  generatedAt?: string;
  status?: EvidenceStatus;
}

export interface BrowserSmokeEvidence extends ReleaseEvidenceIdentity {
  interaction?: {
    commandPaletteOpen?: boolean;
    commandInputFocused?: boolean;
    commandCount?: number;
    buttonCount?: number;
  };
}

export interface NativeArtifactEvidence extends ReleaseEvidenceIdentity {
  artifacts?: Array<{
    path?: string;
    bytes?: number;
    sha256?: string;
  }>;
}

export interface NativeRuntimeEvidence extends ReleaseEvidenceIdentity {
  appVersion?: string;
  webviewLoaded?: boolean;
  reactReady?: boolean;
  exitCode?: number;
  executableBytes?: number;
  executableSha256?: string;
}

export interface PlatformReleaseEvidence {
  browser: BrowserSmokeEvidence | null;
  artifacts: NativeArtifactEvidence | null;
  runtime: NativeRuntimeEvidence | null;
}

export interface PlatformEvidenceValidation {
  platform: ReleasePlatform;
  status: 'pass' | 'fail' | 'not-run';
  version: string | null;
  releaseId: string | null;
  issues: string[];
}

export interface ReleaseEvidenceMatrixValidation {
  status: 'pass' | 'fail' | 'not-run';
  version: string | null;
  releaseId: string | null;
  platforms: PlatformEvidenceValidation[];
  issues: string[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function normalizeReleasePlatform(value: string | undefined): ReleasePlatform | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'windows' || normalized.startsWith('win')) return 'windows';
  if (normalized === 'macos' || normalized === 'darwin' || normalized.startsWith('mac')) return 'macos';
  if (normalized === 'linux' || normalized.startsWith('linux')) return 'linux';
  return null;
}

function validTimestamp(value: string | undefined): boolean {
  if (!value) return false;
  return Number.isFinite(Date.parse(value));
}

function validateIdentity(
  label: string,
  evidence: ReleaseEvidenceIdentity,
  platform: ReleasePlatform,
  expectedVersion: string,
  expectedReleaseId?: string,
): string[] {
  const issues: string[] = [];
  if (evidence.status !== 'pass') issues.push(`${label} 상태가 pass가 아닙니다.`);
  if (normalizeReleasePlatform(evidence.platform) !== platform) issues.push(`${label} 플랫폼이 ${platform}과 일치하지 않습니다.`);
  if (evidence.version !== expectedVersion) issues.push(`${label} 버전이 ${expectedVersion}과 일치하지 않습니다.`);
  if (!evidence.releaseId || evidence.releaseId.trim().length < 6) issues.push(`${label} 릴리스 실행 ID가 없습니다.`);
  if (expectedReleaseId && evidence.releaseId !== expectedReleaseId) issues.push(`${label} 릴리스 실행 ID가 예상값과 다릅니다.`);
  if (!validTimestamp(evidence.generatedAt)) issues.push(`${label} 생성 시간이 유효하지 않습니다.`);
  return issues;
}

export function validatePlatformReleaseEvidence(
  platform: ReleasePlatform,
  evidence: PlatformReleaseEvidence,
  expectedVersion: string,
  expectedReleaseId?: string,
): PlatformEvidenceValidation {
  if (!evidence.browser || !evidence.artifacts || !evidence.runtime) {
    const missing = [
      !evidence.browser ? 'browser' : null,
      !evidence.artifacts ? 'artifacts' : null,
      !evidence.runtime ? 'runtime' : null,
    ].filter(Boolean);
    return {
      platform,
      status: 'not-run',
      version: null,
      releaseId: null,
      issues: [`${platform} 증거가 부족합니다: ${missing.join(', ')}`],
    };
  }

  const issues = [
    ...validateIdentity('브라우저 보고서', evidence.browser, platform, expectedVersion, expectedReleaseId),
    ...validateIdentity('설치 산출물 보고서', evidence.artifacts, platform, expectedVersion, expectedReleaseId),
    ...validateIdentity('네이티브 런타임 보고서', evidence.runtime, platform, expectedVersion, expectedReleaseId),
  ];

  const releaseIds = new Set([evidence.browser.releaseId, evidence.artifacts.releaseId, evidence.runtime.releaseId]);
  if (releaseIds.size !== 1) issues.push(`${platform} 보고서의 릴리스 실행 ID가 서로 다릅니다.`);

  const artifactList = evidence.artifacts.artifacts ?? [];
  if (artifactList.length < 1) issues.push('설치 산출물 파일이 없습니다.');
  for (const [index, artifact] of artifactList.entries()) {
    if (!artifact.path) issues.push(`설치 산출물 ${index + 1}의 경로가 없습니다.`);
    if (!Number.isFinite(artifact.bytes) || (artifact.bytes ?? 0) <= 0) issues.push(`설치 산출물 ${index + 1}의 크기가 유효하지 않습니다.`);
    if (!SHA256_PATTERN.test(artifact.sha256 ?? '')) issues.push(`설치 산출물 ${index + 1}의 SHA-256이 유효하지 않습니다.`);
  }

  const interaction = evidence.browser.interaction;
  if (!interaction?.commandPaletteOpen) issues.push('브라우저에서 명령 검색이 열리지 않았습니다.');
  if (!interaction?.commandInputFocused) issues.push('브라우저 명령 검색 입력창에 포커스되지 않았습니다.');
  if (!Number.isFinite(interaction?.commandCount) || (interaction?.commandCount ?? 0) < 1) issues.push('브라우저 명령 목록이 비어 있습니다.');
  if (!Number.isFinite(interaction?.buttonCount) || (interaction?.buttonCount ?? 0) < 1) issues.push('브라우저 핵심 UI 버튼을 확인하지 못했습니다.');

  if (evidence.runtime.appVersion !== expectedVersion) issues.push('Tauri 앱이 보고한 버전이 릴리스 버전과 일치하지 않습니다.');
  if (evidence.runtime.webviewLoaded !== true) issues.push('Tauri WebView 로딩 완료가 확인되지 않았습니다.');
  if (evidence.runtime.reactReady !== true) issues.push('Tauri React 준비 완료가 확인되지 않았습니다.');
  if (evidence.runtime.exitCode !== 0) issues.push('Tauri 런타임 종료 코드가 0이 아닙니다.');
  if (!Number.isFinite(evidence.runtime.executableBytes) || (evidence.runtime.executableBytes ?? 0) <= 0) issues.push('실행 바이너리 크기가 유효하지 않습니다.');
  if (!SHA256_PATTERN.test(evidence.runtime.executableSha256 ?? '')) issues.push('실행 바이너리 SHA-256이 유효하지 않습니다.');

  return {
    platform,
    status: issues.length ? 'fail' : 'pass',
    version: evidence.browser.version ?? null,
    releaseId: evidence.browser.releaseId ?? null,
    issues,
  };
}

export function validateReleaseEvidenceMatrix(
  matrix: Record<ReleasePlatform, PlatformReleaseEvidence>,
  expectedVersion: string,
  expectedReleaseId?: string,
): ReleaseEvidenceMatrixValidation {
  const platforms: ReleasePlatform[] = ['linux', 'windows', 'macos'];
  const results = platforms.map((platform) => validatePlatformReleaseEvidence(
    platform,
    matrix[platform],
    expectedVersion,
    expectedReleaseId,
  ));
  const issues = results.flatMap((result) => result.issues.map((issue) => `${result.platform}: ${issue}`));
  const completed = results.filter((result) => result.status !== 'not-run');
  const releaseIds = new Set(completed.map((result) => result.releaseId).filter((value): value is string => Boolean(value)));
  if (completed.length === platforms.length && releaseIds.size !== 1) issues.push('운영체제별 릴리스 실행 ID가 서로 다릅니다.');

  return {
    status: results.some((result) => result.status === 'fail')
      ? 'fail'
      : results.some((result) => result.status === 'not-run')
        ? 'not-run'
        : issues.length
          ? 'fail'
          : 'pass',
    version: expectedVersion,
    releaseId: releaseIds.size === 1 ? [...releaseIds][0] : null,
    platforms: results,
    issues,
  };
}
