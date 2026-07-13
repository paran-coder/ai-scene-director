import { analyzeShotReadiness } from './directorWorkflow.ts';
import type { Scene, Shot } from './types.ts';

export type ShotExportPreflightStatus = 'ready' | 'warning' | 'blocked';
export type ShotExportQuickAction = 'selectCamera' | 'focusTimeline' | 'openDoctor' | 'none';

export interface ShotExportFileGroup {
  label: string;
  files: string[];
}

export interface ShotExportPreflight {
  status: ShotExportPreflightStatus;
  canExport: boolean;
  title: string;
  summary: string;
  issues: string[];
  advisories: string[];
  quickAction: ShotExportQuickAction;
  cameraName: string;
  duration: number;
  entityCount: number;
  relationshipCount: number;
  actionCount: number;
  renderCount: number;
  groups: ShotExportFileGroup[];
}

export const SHOT_PACKAGE_FILE_GROUPS: ShotExportFileGroup[] = [
  { label: '프레임', files: ['시작 프레임 PNG', '종료 프레임 PNG'] },
  { label: '제어 이미지', files: ['Pose 시작·종료', 'Depth 시작·종료', '객체 마스크 시작·종료'] },
  { label: '프롬프트', files: ['장면', '동작', '카메라', '네거티브'] },
  { label: '구조 데이터', files: ['Shot Manifest JSON'] },
];

function chooseQuickAction(issues: string[]): ShotExportQuickAction {
  if (issues.some((issue) => issue.includes('카메라'))) return 'selectCamera';
  if (issues.some((issue) => issue.includes('충돌'))) return 'focusTimeline';
  if (issues.length) return 'openDoctor';
  return 'none';
}

export function buildShotExportPreflight(
  scene: Scene,
  shot: Shot,
  options: { renderAvailable?: boolean } = {},
): ShotExportPreflight {
  const readiness = analyzeShotReadiness(scene, shot);
  const issues = [...readiness.issues];
  if (options.renderAvailable === false) issues.unshift('3D 뷰포트가 준비되지 않아 프레임을 렌더링할 수 없습니다.');

  const camera = scene.entities.find((entity) => entity.id === shot.cameraEntityId && entity.type === 'camera');
  const advisories: string[] = [];
  if ((shot.actions ?? []).length === 0) advisories.push('Action이 없어 동작 프롬프트는 정적인 장면으로 생성됩니다.');
  if ((shot.relationships ?? []).length === 0 && scene.entities.filter((entity) => entity.type === 'character' || entity.type === 'prop').length > 1) {
    advisories.push('여러 피사체가 있지만 관계가 없습니다. 시선·들기·배치 의도를 확인해 주세요.');
  }

  const blocked = readiness.status === 'blocked' || options.renderAvailable === false;
  const status: ShotExportPreflightStatus = blocked ? 'blocked' : readiness.status === 'needs-work' || advisories.length ? 'warning' : 'ready';
  const cameraName = camera?.name ?? '카메라 없음';
  const summary = `${shot.duration.toFixed(1)}초 · ${cameraName} · 행동 ${(shot.actions ?? []).length}개 · 관계 ${(shot.relationships ?? []).length}개`;

  return {
    status,
    canExport: !blocked,
    title: status === 'ready' ? '출력 준비 완료' : status === 'warning' ? '확인 후 출력 가능' : '출력 전 수정 필요',
    summary,
    issues,
    advisories,
    quickAction: chooseQuickAction(issues),
    cameraName,
    duration: shot.duration,
    entityCount: scene.entities.length,
    relationshipCount: (shot.relationships ?? []).length,
    actionCount: (shot.actions ?? []).length,
    renderCount: 8,
    groups: SHOT_PACKAGE_FILE_GROUPS.map((group) => ({ ...group, files: [...group.files] })),
  };
}
