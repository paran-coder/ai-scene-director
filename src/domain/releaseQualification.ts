export type ReleaseCheckStatus = 'pass' | 'fail' | 'blocked' | 'not-run';
export type ReleaseGateStatus = 'ready' | 'conditional' | 'blocked';

export interface ReleaseVerificationCheck {
  id: string;
  label: string;
  required: boolean;
  status: ReleaseCheckStatus;
  detail?: string;
}

export interface ReleaseQualification {
  status: ReleaseGateStatus;
  passed: string[];
  blockers: string[];
  pendingExternal: string[];
  optionalFailures: string[];
}

export function evaluateReleaseQualification(checks: ReleaseVerificationCheck[]): ReleaseQualification {
  const passed = checks.filter((check) => check.status === 'pass').map((check) => check.id);
  const blockers = checks
    .filter((check) => check.required && check.status === 'fail')
    .map((check) => check.id);
  const pendingExternal = checks
    .filter((check) => check.required && (check.status === 'blocked' || check.status === 'not-run'))
    .map((check) => check.id);
  const optionalFailures = checks
    .filter((check) => !check.required && check.status !== 'pass')
    .map((check) => check.id);

  return {
    status: blockers.length > 0 ? 'blocked' : pendingExternal.length > 0 ? 'conditional' : 'ready',
    passed,
    blockers,
    pendingExternal,
    optionalFailures,
  };
}
