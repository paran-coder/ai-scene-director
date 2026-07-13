import { collectActionConflicts } from './actions.ts';
import { getAssetBlob } from './assetStorage.ts';
import type { ActionBlock, Entity, Project, Scene, Shot } from './types.ts';
import { validateAndMigrateProject } from './validation.ts';
import type { RuntimeDiagnostics } from './runtimeDiagnostics.ts';

export type ProjectHealthSeverity = 'error' | 'warning' | 'info';

export interface ProjectHealthIssue {
  id: string;
  code: string;
  severity: ProjectHealthSeverity;
  message: string;
  location?: string;
  repairable: boolean;
}

export interface ProjectHealthStats {
  scenes: number;
  shots: number;
  entities: number;
  characters: number;
  actions: number;
  relationships: number;
  glbAssets: number;
  glbBytes: number;
  referenceImages: number;
  referenceImageBytes: number;
  projectJsonBytes: number;
}

export interface ProjectHealthReport {
  generatedAt: string;
  score: number;
  status: 'blocked' | 'attention' | 'healthy';
  issues: ProjectHealthIssue[];
  stats: ProjectHealthStats;
  missingStorageKeys: string[];
  runtime?: RuntimeDiagnostics;
}

export interface ProjectRepairResult {
  project: Project;
  changes: string[];
  validationErrors: string[];
}

const encoder = new TextEncoder();

function issue(
  code: string,
  severity: ProjectHealthSeverity,
  message: string,
  location: string | undefined,
  repairable: boolean,
): ProjectHealthIssue {
  return { id: `${code}:${location ?? message}`, code, severity, message, location, repairable };
}

function projectStats(project: Project): ProjectHealthStats {
  let shots = 0;
  let entities = 0;
  let characters = 0;
  let actions = 0;
  let relationships = 0;
  let referenceImages = 0;
  let referenceImageBytes = 0;
  for (const scene of project.scenes) {
    shots += scene.shots.length;
    entities += scene.entities.length;
    characters += scene.entities.filter((entity) => entity.type === 'character').length;
    actions += scene.shots.reduce((sum, shot) => sum + shot.actions.length, 0);
    relationships += scene.shots.reduce((sum, shot) => sum + shot.relationships.length, 0);
    referenceImages += scene.referenceImages.length;
    referenceImageBytes += scene.referenceImages.reduce((sum, image) => sum + image.sizeBytes, 0);
  }
  return {
    scenes: project.scenes.length,
    shots,
    entities,
    characters,
    actions,
    relationships,
    glbAssets: project.assetLibrary.length,
    glbBytes: project.assetLibrary.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    referenceImages,
    referenceImageBytes,
    projectJsonBytes: encoder.encode(JSON.stringify(project)).byteLength,
  };
}

function collectReferencedStorageKeys(project: Project): Array<{ key: string; label: string; location: string }> {
  const entries: Array<{ key: string; label: string; location: string }> = [];
  project.assetLibrary.forEach((asset, index) => {
    entries.push({ key: asset.storageKey, label: asset.name, location: `assetLibrary[${index}]` });
  });
  project.scenes.forEach((scene, sceneIndex) => {
    scene.referenceImages.forEach((image, imageIndex) => {
      entries.push({ key: image.storageKey, label: image.name, location: `scenes[${sceneIndex}].referenceImages[${imageIndex}]` });
    });
  });
  return entries;
}

function addSceneIssues(scene: Scene, sceneIndex: number, issues: ProjectHealthIssue[]): void {
  const entityMap = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const cameraIds = new Set(scene.entities.filter((entity) => entity.type === 'camera').map((entity) => entity.id));
  const assetModelIds = new Set(scene.entities.map((entity) => entity.asset?.modelAssetId).filter(Boolean));

  if (cameraIds.size === 0) {
    issues.push(issue('scene-no-camera', 'error', 'Scene에 카메라가 없어 Shot을 렌더링할 수 없습니다.', `Scene: ${scene.name}`, true));
  }
  if (scene.entities.length > 150) {
    issues.push(issue('large-scene', 'warning', `Entity가 ${scene.entities.length}개여서 저사양 GPU에서 편집 성능이 낮을 수 있습니다.`, `Scene: ${scene.name}`, false));
  }
  if (scene.referenceImages.length > 20) {
    issues.push(issue('many-reference-images', 'warning', `참조 이미지가 ${scene.referenceImages.length}장입니다. 필요하지 않은 이미지를 정리해 주세요.`, `Scene: ${scene.name}`, false));
  }

  for (const [entityIndex, entity] of scene.entities.entries()) {
    const location = `Scene ${sceneIndex + 1} / Entity ${entityIndex + 1} (${entity.name})`;
    if (entity.type === 'character' && entity.asset?.modelAssetId && !entity.character) {
      issues.push(issue('character-data-missing', 'error', 'GLB 캐릭터에 포즈 데이터가 없습니다.', location, true));
    }
    if (entity.type === 'light' && entity.light?.kind === 'spot' && entity.light.targetEntityId && !entityMap.has(entity.light.targetEntityId)) {
      issues.push(issue('dangling-light-target', 'warning', '스포트라이트 대상이 존재하지 않습니다.', location, true));
    }
  }

  for (const [shotIndex, shot] of scene.shots.entries()) {
    const location = `Scene ${sceneIndex + 1} / Shot ${shotIndex + 1} (${shot.name})`;
    if (!cameraIds.has(shot.cameraEntityId)) {
      issues.push(issue('invalid-shot-camera', 'error', 'Shot 카메라 연결이 올바르지 않습니다.', location, true));
    }
    const conflicts = collectActionConflicts(shot.actions.filter((action) => action.enabled));
    if (conflicts.length) {
      issues.push(issue('action-conflicts', 'warning', `동시에 같은 객체를 사용하는 Action 충돌이 ${conflicts.length}쌍 있습니다.`, location, true));
    }
    if (shot.actions.some((action) => action.startTime < 0 || action.duration <= 0 || action.startTime + action.duration > shot.duration + 1e-6)) {
      issues.push(issue('action-out-of-range', 'warning', 'Shot 범위를 벗어난 Action이 있습니다.', location, true));
    }
    if (shot.relationships.some((relationship) => !entityMap.has(relationship.sourceEntityId) || !entityMap.has(relationship.targetEntityId))) {
      issues.push(issue('dangling-relationship', 'warning', '삭제된 Entity를 참조하는 관계가 있습니다.', location, true));
    }
  }

  if (assetModelIds.size > 25) {
    issues.push(issue('many-active-models', 'warning', `Scene에서 서로 다른 GLB ${assetModelIds.size}개를 사용합니다.`, `Scene: ${scene.name}`, false));
  }
}

export async function analyzeProjectHealth(project: Project, runtime?: RuntimeDiagnostics): Promise<ProjectHealthReport> {
  const issues: ProjectHealthIssue[] = [];
  const validation = validateAndMigrateProject(structuredClone(project));
  validation.errors.forEach((message, index) => issues.push(issue(`validation-error-${index}`, 'error', message, '프로젝트 검증', false)));
  validation.warnings.forEach((message, index) => issues.push(issue(`validation-warning-${index}`, 'warning', message, '프로젝트 검증', true)));
  project.scenes.forEach((scene, index) => addSceneIssues(scene, index, issues));

  for (const [index, asset] of project.assetLibrary.entries()) {
    if (asset.sizeBytes > 80 * 1024 * 1024) {
      issues.push(issue('large-glb', 'warning', `${asset.name}은 ${(asset.sizeBytes / 1024 / 1024).toFixed(1)}MB입니다. 편집용 경량 모델을 권장합니다.`, `assetLibrary[${index}]`, false));
    }
    if (asset.category === 'character' && (!asset.rig || asset.rig.status === 'none')) {
      issues.push(issue('character-rig-missing', 'warning', `${asset.name}에서 휴머노이드 리그를 찾지 못했습니다.`, `assetLibrary[${index}]`, false));
    }
  }

  const missingStorageKeys: string[] = [];
  for (const entry of collectReferencedStorageKeys(project)) {
    try {
      if (!await getAssetBlob(entry.key)) {
        missingStorageKeys.push(entry.key);
        issues.push(issue('missing-local-asset', 'error', `${entry.label}의 로컬 원본 파일을 찾지 못했습니다.`, entry.location, false));
      }
    } catch {
      issues.push(issue('storage-read-failed', 'error', `${entry.label}의 로컬 저장소를 읽지 못했습니다.`, entry.location, false));
    }
  }

  if (runtime) {
    runtime.issues.forEach((runtimeIssue) => {
      issues.push(issue(
        `runtime-${runtimeIssue.code}`,
        runtimeIssue.severity === 'critical' ? 'error' : runtimeIssue.severity === 'warning' ? 'warning' : 'info',
        runtimeIssue.message,
        '실행 환경',
        false,
      ));
    });
  }

  const uniqueIssues = [...new Map(issues.map((item) => [item.id, item])).values()];
  const errorCount = uniqueIssues.filter((item) => item.severity === 'error').length;
  const warningCount = uniqueIssues.filter((item) => item.severity === 'warning').length;
  const score = Math.max(0, Math.min(100, 100 - errorCount * 18 - warningCount * 5));
  const status: ProjectHealthReport['status'] = errorCount ? 'blocked' : warningCount ? 'attention' : 'healthy';

  return {
    generatedAt: new Date().toISOString(),
    score,
    status,
    issues: uniqueIssues,
    stats: projectStats(project),
    missingStorageKeys,
    runtime,
  };
}

function createRepairCamera(scene: Scene): Entity {
  const id = `camera-repair-${scene.id}`;
  return {
    id,
    name: '복구 카메라',
    type: 'camera',
    transform: { position: [0, 2.5, 7], rotation: [-0.15, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    camera: { projection: 'perspective', fov: 48, near: 0.1, far: 100, aspectRatio: '16:9', showSafeFrame: true },
    asset: { category: 'generic', primitive: 'box', color: '#38bdf8', material: 'matte', source: 'manual', tags: ['camera', 'repair'] },
  };
}

function normalizeActions(shot: Shot, validEntityIds: Set<string>, changes: string[]): ActionBlock[] {
  const accepted: ActionBlock[] = [];
  const sorted = structuredClone(shot.actions).sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  for (const action of sorted) {
    if (!validEntityIds.has(action.actorEntityId)
      || (action.targetEntityId && !validEntityIds.has(action.targetEntityId))
      || (action.parameters.surfaceEntityId && !validEntityIds.has(action.parameters.surfaceEntityId))) {
      changes.push(`${shot.name}: 삭제된 Entity를 참조한 Action ${action.id}를 제거했습니다.`);
      continue;
    }
    const next = structuredClone(action);
    const maxStart = Math.max(0, shot.duration - 0.1);
    next.startTime = Math.max(0, Math.min(maxStart, Number.isFinite(next.startTime) ? next.startTime : 0));
    next.duration = Math.max(0.1, Math.min(shot.duration - next.startTime, Number.isFinite(next.duration) ? next.duration : 0.1));
    if (next.startTime !== action.startTime || next.duration !== action.duration) {
      changes.push(`${shot.name}: Action ${action.id}를 Shot 범위 안으로 조정했습니다.`);
    }
    const conflicts = next.enabled ? collectActionConflicts([...accepted, next].filter((item) => item.enabled)) : [];
    if (conflicts.some((pair) => pair.actionId === next.id || pair.conflictingActionId === next.id)) {
      next.enabled = false;
      changes.push(`${shot.name}: 충돌하는 Action ${action.id}를 비활성화했습니다.`);
    }
    accepted.push(next);
  }
  return accepted;
}

export function repairProjectSafely(project: Project): ProjectRepairResult {
  const repaired = structuredClone(project);
  const changes: string[] = [];
  const assetIds = new Set(repaired.assetLibrary.map((asset) => asset.id));

  for (const scene of repaired.scenes) {
    let cameras = scene.entities.filter((entity) => entity.type === 'camera');
    if (cameras.length === 0) {
      const camera = createRepairCamera(scene);
      scene.entities.push(camera);
      cameras = [camera];
      changes.push(`${scene.name}: 복구 카메라를 추가했습니다.`);
    }
    const entityIds = new Set(scene.entities.map((entity) => entity.id));
    for (const entity of scene.entities) {
      if (entity.asset?.modelAssetId && !assetIds.has(entity.asset.modelAssetId)) {
        delete entity.asset.modelAssetId;
        changes.push(`${entity.name}: 존재하지 않는 GLB 연결을 해제했습니다.`);
      }
      if (entity.type === 'light' && entity.light?.targetEntityId && (!entityIds.has(entity.light.targetEntityId) || entity.light.targetEntityId === entity.id)) {
        delete entity.light.targetEntityId;
        changes.push(`${entity.name}: 잘못된 스포트라이트 대상을 해제했습니다.`);
      }
    }
    for (const image of scene.referenceImages) {
      if (image.cameraEntityId && !cameras.some((camera) => camera.id === image.cameraEntityId)) {
        delete image.cameraEntityId;
        changes.push(`${image.name}: 잘못된 카메라 연결을 해제했습니다.`);
      }
    }
    scene.shots.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    scene.shots.forEach((shot, index) => {
      if (!cameras.some((camera) => camera.id === shot.cameraEntityId)) {
        shot.cameraEntityId = cameras[0].id;
        changes.push(`${shot.name}: 카메라를 ${cameras[0].name}(으)로 복구했습니다.`);
      }
      if (shot.order !== index) {
        shot.order = index;
        changes.push(`${shot.name}: Shot 순서를 정규화했습니다.`);
      }
      shot.overrides = shot.overrides.filter((override) => entityIds.has(override.entityId));
      shot.relationships = shot.relationships.filter((relationship) => {
        const valid = relationship.sourceEntityId !== relationship.targetEntityId
          && entityIds.has(relationship.sourceEntityId)
          && entityIds.has(relationship.targetEntityId);
        if (!valid) changes.push(`${shot.name}: 삭제된 Entity를 참조한 관계 ${relationship.id}를 제거했습니다.`);
        return valid;
      });
      shot.actions = normalizeActions(shot, entityIds, changes);
    });
  }

  if (!repaired.scenes.some((scene) => scene.id === repaired.activeSceneId) && repaired.scenes[0]) {
    repaired.activeSceneId = repaired.scenes[0].id;
    changes.push('활성 Scene을 첫 Scene으로 복구했습니다.');
  }
  repaired.revision += changes.length ? 1 : 0;
  const validation = validateAndMigrateProject(repaired);
  return {
    project: validation.success && validation.project ? validation.project : repaired,
    changes,
    validationErrors: validation.errors,
  };
}
