import { collectActionConflicts } from './actions.ts';
import type { Entity, Project, Scene, Shot } from './types.ts';

export type DirectorStageId = 'idea' | 'scene' | 'shots' | 'direction' | 'review' | 'export';
export type DirectorStageStatus = 'complete' | 'current' | 'pending' | 'blocked';
export type DirectorActionId =
  | 'openSceneGenerator'
  | 'selectLeadCharacter'
  | 'selectPrimarySubject'
  | 'focusSceneHierarchy'
  | 'selectShotCamera'
  | 'focusShotStrip'
  | 'addShot'
  | 'focusTimeline'
  | 'openProjectDoctor'
  | 'exportShotPackage'
  | 'none';

export interface DirectorStage {
  id: DirectorStageId;
  title: string;
  description: string;
  score: number;
  status: DirectorStageStatus;
  actionId: DirectorActionId;
  actionLabel: string;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
}

export interface ShotReadiness {
  shotId: string;
  score: number;
  status: 'ready' | 'needs-work' | 'blocked';
  issues: string[];
}

export interface FirstEditPlan {
  ready: boolean;
  targetEntityId?: string;
  targetKind: 'character' | 'prop' | 'camera' | 'none';
  label: string;
  instruction: string;
  primaryAction: DirectorActionId;
  quickActions: Array<{ id: DirectorActionId; label: string }>;
}

export interface CreatorJourneyReport {
  firstEdit: FirstEditPlan;
  completedStages: number;
  remainingStages: number;
  estimatedStepsToExport: number;
  blockers: string[];
  status: 'ready-to-edit' | 'needs-setup' | 'blocked';
}

export interface DirectorWorkflowReport {
  score: number;
  intent: 'still' | 'sequence' | 'motion';
  stages: DirectorStage[];
  nextAction: {
    id: DirectorActionId;
    label: string;
    reason: string;
  };
  shotReadiness: ShotReadiness[];
  journey: CreatorJourneyReport;
  summary: string;
}

const MOTION_WORDS = ['걷', '달리', '떠나', '움직', '집어', '내려놓', '다가', '오빗', '트래킹', '회전'];

function resolveScene(project: Project, sceneId?: string): Scene {
  return project.scenes.find((scene) => scene.id === sceneId)
    ?? project.scenes.find((scene) => scene.id === project.activeSceneId)
    ?? project.scenes[0];
}

function shotCameraValid(scene: Scene, shot: Shot): boolean {
  return scene.entities.some((entity) => entity.id === shot.cameraEntityId && entity.type === 'camera');
}

function relationshipReferencesValid(scene: Scene, shot: Shot): boolean {
  const ids = new Set(scene.entities.map((entity) => entity.id));
  return shot.relationships.every((relationship) => ids.has(relationship.sourceEntityId) && ids.has(relationship.targetEntityId));
}

function actionReferencesValid(scene: Scene, shot: Shot): boolean {
  const ids = new Set(scene.entities.map((entity) => entity.id));
  return shot.actions.every((action) => (
    ids.has(action.actorEntityId)
    && (!action.targetEntityId || ids.has(action.targetEntityId))
    && (!action.parameters.surfaceEntityId || ids.has(action.parameters.surfaceEntityId))
  ));
}

export function analyzeShotReadiness(scene: Scene, shot: Shot): ShotReadiness {
  const issues: string[] = [];
  if (!shot.name.trim()) issues.push('샷 이름이 비어 있습니다.');
  if (!shotCameraValid(scene, shot)) issues.push('유효한 샷 카메라가 없습니다.');
  if (!(shot.duration > 0)) issues.push('샷 길이가 올바르지 않습니다.');
  if (!relationshipReferencesValid(scene, shot)) issues.push('삭제된 객체를 참조하는 관계가 있습니다.');
  if (!actionReferencesValid(scene, shot)) issues.push('삭제된 객체를 참조하는 행동이 있습니다.');
  const conflicts = collectActionConflicts(shot.actions ?? []);
  if (conflicts.length) issues.push(`행동 충돌 ${conflicts.length}쌍이 있습니다.`);
  const score = Math.max(0, 100 - issues.length * 24);
  return {
    shotId: shot.id,
    score,
    status: issues.some((issue) => issue.includes('카메라') || issue.includes('참조')) ? 'blocked' : issues.length ? 'needs-work' : 'ready',
    issues,
  };
}

function stage(
  id: DirectorStageId,
  title: string,
  description: string,
  actionId: DirectorActionId,
  actionLabel: string,
  checks: DirectorStage['checks'],
): DirectorStage {
  const score = Math.round((checks.filter((check) => check.passed).length / Math.max(1, checks.length)) * 100);
  return { id, title, description, score, status: 'pending', actionId, actionLabel, checks };
}

function setStageStatuses(stages: DirectorStage[]): DirectorStage[] {
  let foundCurrent = false;
  return stages.map((item) => {
    const requiredFailure = item.checks.some((check) => !check.passed && check.detail.startsWith('필수'));
    if (item.score === 100) return { ...item, status: 'complete' };
    if (!foundCurrent) {
      foundCurrent = true;
      return { ...item, status: requiredFailure ? 'blocked' : 'current' };
    }
    return { ...item, status: 'pending' };
  });
}

function primaryPromptProp(scene: Scene): Entity | undefined {
  return scene.entities.find((entity) => entity.type === 'prop' && entity.asset?.source === 'prompt')
    ?? scene.entities.find((entity) => entity.type === 'prop' && !entity.locked)
    ?? scene.entities.find((entity) => entity.type === 'prop');
}

export function buildFirstEditPlan(scene: Scene): FirstEditPlan {
  const lead = scene.entities.find((entity) => entity.type === 'character' && entity.character?.appearance.role === 'lead')
    ?? scene.entities.find((entity) => entity.type === 'character');
  const prop = primaryPromptProp(scene);
  const camera = scene.entities.find((entity) => entity.type === 'camera');

  if (lead) {
    return {
      ready: true,
      targetEntityId: lead.id,
      targetKind: 'character',
      label: `${lead.name} 위치·포즈 수정`,
      instruction: '주인공이 이미 선택되어 있습니다. 뷰포트 이동 핸들로 첫 배치를 바로 조정하세요.',
      primaryAction: 'selectLeadCharacter',
      quickActions: [
        { id: 'selectLeadCharacter', label: '주인공 수정' },
        { id: 'selectShotCamera', label: '카메라 구도' },
        { id: 'focusTimeline', label: '첫 동작' },
      ],
    };
  }
  if (prop) {
    return {
      ready: true,
      targetEntityId: prop.id,
      targetKind: 'prop',
      label: `${prop.name} 배치 수정`,
      instruction: '핵심 제품·소품이 이미 선택되어 있습니다. 위치와 회전을 바로 조정하세요.',
      primaryAction: 'selectPrimarySubject',
      quickActions: [
        { id: 'selectPrimarySubject', label: '제품·소품 수정' },
        { id: 'selectShotCamera', label: '카메라 구도' },
        { id: 'openProjectDoctor', label: '장면 점검' },
      ],
    };
  }
  if (camera) {
    return {
      ready: true,
      targetEntityId: camera.id,
      targetKind: 'camera',
      label: `${camera.name} 구도 수정`,
      instruction: '카메라가 선택되어 있습니다. 위치와 FOV를 조정해 첫 구도를 만드세요.',
      primaryAction: 'selectShotCamera',
      quickActions: [
        { id: 'selectShotCamera', label: '카메라 구도' },
        { id: 'focusSceneHierarchy', label: '객체 추가' },
        { id: 'openProjectDoctor', label: '장면 점검' },
      ],
    };
  }
  return {
    ready: false,
    targetKind: 'none',
    label: '장면 초안이 필요합니다.',
    instruction: '자연어 장면 생성으로 편집 가능한 인물·소품·카메라를 먼저 만드세요.',
    primaryAction: 'openSceneGenerator',
    quickActions: [{ id: 'openSceneGenerator', label: '장면 초안 만들기' }],
  };
}

function buildJourney(scene: Scene, stages: DirectorStage[], shotReadiness: ShotReadiness[]): CreatorJourneyReport {
  const firstEdit = buildFirstEditPlan(scene);
  const completedStages = stages.filter((item) => item.status === 'complete').length;
  const remainingStages = stages.length - completedStages;
  const blockers = shotReadiness.flatMap((item) => item.status === 'blocked' ? item.issues : []);
  const estimatedStepsToExport = stages.filter((item) => item.status !== 'complete').length;
  return {
    firstEdit,
    completedStages,
    remainingStages,
    estimatedStepsToExport,
    blockers,
    status: blockers.length ? 'blocked' : firstEdit.ready ? 'ready-to-edit' : 'needs-setup',
  };
}

export function analyzeDirectorWorkflow(project: Project, sceneId?: string, activeShotId?: string): DirectorWorkflowReport {
  const scene = resolveScene(project, sceneId);
  const activeShot = scene.shots.find((shot) => shot.id === activeShotId) ?? scene.shots[0];
  const characters = scene.entities.filter((entity) => entity.type === 'character');
  const props = scene.entities.filter((entity) => entity.type === 'prop');
  const cameras = scene.entities.filter((entity) => entity.type === 'camera');
  const lights = scene.entities.filter((entity) => entity.type === 'light');
  const allActions = scene.shots.flatMap((shot) => shot.actions ?? []);
  const allRelationships = scene.shots.flatMap((shot) => shot.relationships ?? []);
  const text = `${scene.name} ${scene.description ?? ''}`;
  const motionRequested = allActions.length > 0 || MOTION_WORDS.some((word) => text.includes(word));
  const intent: DirectorWorkflowReport['intent'] = motionRequested ? 'motion' : scene.shots.length > 1 ? 'sequence' : 'still';
  const shotReadiness = scene.shots.map((shot) => analyzeShotReadiness(scene, shot));
  const totalConflicts = scene.shots.reduce((sum, shot) => sum + collectActionConflicts(shot.actions ?? []).length, 0);
  const invalidShots = shotReadiness.filter((item) => item.status === 'blocked').length;
  const minimumShotCount = intent === 'still' ? 1 : 2;
  const relationshipNeeded = characters.length + props.length > 1;

  const rawStages = [
    stage('idea', '1. 아이디어', '장면의 의도와 핵심 순간을 자연어로 정리합니다.', 'openSceneGenerator', '장면 설명 열기', [
      { label: '장면 설명', passed: (scene.description?.trim().length ?? 0) >= 16, detail: '필수 · 인물, 장소, 사건을 포함한 설명이 필요합니다.' },
      { label: '장면 이름', passed: scene.name.trim().length > 0, detail: '장면을 구분할 이름입니다.' },
    ]),
    stage('scene', '2. 장면 구성', '인물·소품·공간·조명을 배치합니다.', 'focusSceneHierarchy', '장면 객체 보기', [
      { label: '등장인물', passed: characters.length > 0 || props.length > 0, detail: '필수 · 최소 한 명의 인물 또는 핵심 제품·소품이 필요합니다.' },
      { label: '카메라', passed: cameras.length > 0, detail: '필수 · 장면을 보는 카메라가 필요합니다.' },
      { label: '조명', passed: lights.length > 0, detail: '조명이 있으면 결과 구도를 더 명확하게 판단할 수 있습니다.' },
      { label: '환경', passed: Boolean(scene.environment?.presetId), detail: '장소 프리셋 또는 환경 정보가 필요합니다.' },
    ]),
    stage('shots', '3. 샷 설계', '카메라 구도와 샷 순서를 구성합니다.', 'focusShotStrip', '샷 목록 보기', [
      { label: '샷 수', passed: scene.shots.length >= minimumShotCount, detail: `${intent === 'still' ? '스틸은 1개' : '연속 장면은 2개 이상'}의 샷을 권장합니다.` },
      { label: '샷 카메라', passed: invalidShots === 0, detail: '필수 · 모든 샷에 유효한 카메라가 필요합니다.' },
      { label: '샷 이름', passed: scene.shots.every((shot) => shot.name.trim().length > 0), detail: '각 샷의 역할을 이름으로 구분합니다.' },
    ]),
    stage('direction', '4. 관계·동작', '인물 관계와 시간에 따른 행동을 연출합니다.', 'focusTimeline', '타임라인 보기', [
      { label: '객체 관계', passed: !relationshipNeeded || allRelationships.length > 0, detail: '여러 인물·소품이 있다면 바라보기, 들기, 앉기 같은 관계를 권장합니다.' },
      { label: '동작', passed: intent !== 'motion' || allActions.length > 0, detail: '움직임이 포함된 장면에는 최소 한 개의 Action이 필요합니다.' },
      { label: '행동 충돌', passed: totalConflicts === 0, detail: '필수 · 같은 객체가 동시에 충돌하는 행동을 수행할 수 없습니다.' },
    ]),
    stage('review', '5. 점검', '샷 연결과 데이터 오류를 확인합니다.', 'openProjectDoctor', '프로젝트 점검 열기', [
      { label: '샷 유효성', passed: shotReadiness.every((item) => item.status !== 'blocked'), detail: '필수 · 참조 오류와 카메라 오류가 없어야 합니다.' },
      { label: '활성 샷', passed: Boolean(activeShot && shotCameraValid(scene, activeShot)), detail: '필수 · 현재 샷을 미리 볼 수 있어야 합니다.' },
      { label: '충돌 없음', passed: totalConflicts === 0, detail: 'Action 충돌을 해결해야 합니다.' },
    ]),
    stage('export', '6. 출력', '생성 AI 또는 스토리보드용 Shot Package를 만듭니다.', 'exportShotPackage', '현재 샷 출력', [
      { label: '출력 준비', passed: shotReadiness.every((item) => item.status === 'ready') && invalidShots === 0, detail: '모든 샷이 출력 가능한 상태여야 합니다.' },
    ]),
  ];

  const stages = setStageStatuses(rawStages);
  const score = Math.round(stages.reduce((sum, item) => sum + item.score, 0) / stages.length);

  let nextAction: DirectorWorkflowReport['nextAction'];
  if ((scene.description?.trim().length ?? 0) < 16 || (characters.length === 0 && props.length === 0)) {
    nextAction = { id: 'openSceneGenerator', label: '장면 초안 만들기', reason: '자연어 설명에서 인물·공간·기본 샷을 먼저 구성하세요.' };
  } else if (cameras.length === 0) {
    nextAction = { id: 'selectShotCamera', label: '카메라 확인하기', reason: '샷을 구성할 카메라가 필요합니다.' };
  } else if (scene.shots.length < minimumShotCount) {
    nextAction = { id: 'addShot', label: '다음 샷 추가', reason: '연속 장면의 시작·변화·마무리를 구분하세요.' };
  } else if (intent === 'motion' && allActions.length === 0) {
    nextAction = { id: 'focusTimeline', label: '첫 동작 만들기', reason: '걷기, 집기 또는 카메라 움직임을 타임라인에 배치하세요.' };
  } else if (totalConflicts > 0 || invalidShots > 0) {
    nextAction = { id: 'openProjectDoctor', label: '문제 점검하기', reason: '출력 전에 충돌하거나 끊어진 참조를 해결해야 합니다.' };
  } else if (activeShot && shotCameraValid(scene, activeShot)) {
    nextAction = { id: 'exportShotPackage', label: '현재 샷 출력', reason: '현재 샷은 생성 AI용 패키지로 내보낼 수 있습니다.' };
  } else {
    nextAction = { id: 'selectPrimarySubject', label: '핵심 피사체 선택', reason: '주인공 또는 제품의 배치와 구도를 먼저 확인하세요.' };
  }

  return {
    score,
    intent,
    stages,
    nextAction,
    shotReadiness,
    journey: buildJourney(scene, stages, shotReadiness),
    summary: `${characters.length}명 · 소품 ${props.length}개 · 샷 ${scene.shots.length}개 · 행동 ${allActions.length}개`,
  };
}
