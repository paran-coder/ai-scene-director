import { createNeutralPose } from './pose.ts';
import {
  JOINT_NAMES,
  type ActionBlock,
  type Entity,
  type GenerationResult,
  type PoseState,
  type Project,
  type Relationship,
  type ShotOverride,
  type Vec3,
} from './types.ts';

export const CURRENT_SCHEMA_VERSION = '0.8.0';

export interface ProjectValidationResult {
  success: boolean;
  project?: Project;
  errors: string[];
  warnings: string[];
  migrated: boolean;
}

const ENTITY_TYPES = new Set(['character', 'prop', 'camera', 'light']);
const OVERRIDE_PATHS = new Set([
  'transform.position',
  'transform.rotation',
  'transform.scale',
  'visible',
  'character.pose',
]);
const RELATIONSHIP_TYPES = new Set(['lookAt', 'hold', 'sitOn', 'placeOn']);
const ACTION_TYPES = new Set(['walk', 'turnAround', 'pickUp', 'putDown', 'cameraDolly', 'cameraOrbit']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isPose(value: unknown): value is PoseState {
  if (!isRecord(value)) return false;
  return JOINT_NAMES.every((joint) => isVec3(value[joint]));
}

function isTransform(value: unknown): boolean {
  return isRecord(value) && isVec3(value.position) && isVec3(value.rotation) && isVec3(value.scale);
}

function migrateEntity(raw: Record<string, unknown>, migrated: boolean, warnings: string[]): Entity | null {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !ENTITY_TYPES.has(String(raw.type))) return null;
  if (!isTransform(raw.transform) || typeof raw.visible !== 'boolean' || typeof raw.locked !== 'boolean') return null;

  const entity = structuredClone(raw) as unknown as Entity;
  if (entity.type === 'character') {
    if (!entity.character || !isPose(entity.character.pose)) {
      entity.character = { pose: createNeutralPose() };
      warnings.push(`${entity.name}: 기본 휴머노이드 포즈를 추가했습니다.`);
    }
    if (migrated && entity.transform.scale[1] > 1.4) {
      entity.transform.scale = [1, 1, 1];
      if (entity.transform.position[1] > 0.5 && entity.transform.position[1] < 1.5) entity.transform.position[1] = 0;
      warnings.push(`${entity.name}: 이전 인물 프록시 크기를 휴머노이드 규격으로 변환했습니다.`);
    }
  } else {
    delete entity.character;
  }
  return entity;
}

function validateOverride(value: unknown, entityIds: Set<string>, errors: string[], location: string): value is ShotOverride {
  if (!isRecord(value)) {
    errors.push(`${location}: Override가 객체가 아닙니다.`);
    return false;
  }
  if (typeof value.id !== 'string' || typeof value.entityId !== 'string' || typeof value.path !== 'string') {
    errors.push(`${location}: Override 필수 필드가 올바르지 않습니다.`);
    return false;
  }
  if (!entityIds.has(value.entityId)) errors.push(`${location}: 존재하지 않는 Entity ${value.entityId}를 참조합니다.`);
  if (!OVERRIDE_PATHS.has(value.path)) errors.push(`${location}: 지원하지 않는 경로 ${value.path}입니다.`);
  if (value.path === 'visible' && typeof value.value !== 'boolean') errors.push(`${location}: visible 값은 boolean이어야 합니다.`);
  if (value.path.startsWith('transform.') && !isVec3(value.value)) errors.push(`${location}: Transform 값은 유한한 Vec3여야 합니다.`);
  if (value.path === 'character.pose' && !isPose(value.value)) errors.push(`${location}: 포즈 데이터가 올바르지 않습니다.`);
  return true;
}

function validateRelationship(
  value: unknown,
  entityMap: Map<string, Entity>,
  errors: string[],
  location: string,
): value is Relationship {
  if (!isRecord(value)) {
    errors.push(`${location}: 관계가 객체가 아닙니다.`);
    return false;
  }
  if (
    typeof value.id !== 'string'
    || typeof value.type !== 'string'
    || typeof value.sourceEntityId !== 'string'
    || typeof value.targetEntityId !== 'string'
    || typeof value.active !== 'boolean'
    || !isRecord(value.parameters)
  ) {
    errors.push(`${location}: 관계 필수 필드가 올바르지 않습니다.`);
    return false;
  }
  if (!RELATIONSHIP_TYPES.has(value.type)) errors.push(`${location}: 지원하지 않는 관계 ${value.type}입니다.`);
  const source = entityMap.get(value.sourceEntityId);
  const target = entityMap.get(value.targetEntityId);
  if (!source || !target) errors.push(`${location}: 존재하지 않는 Entity를 참조합니다.`);
  if (value.sourceEntityId === value.targetEntityId) errors.push(`${location}: 자기 자신과 관계를 만들 수 없습니다.`);

  if (source && target) {
    if ((value.type === 'lookAt' || value.type === 'hold' || value.type === 'sitOn') && source.type !== 'character') {
      errors.push(`${location}: ${value.type} 관계의 시작 객체는 인물이어야 합니다.`);
    }
    if ((value.type === 'hold' || value.type === 'sitOn') && target.type !== 'prop') {
      errors.push(`${location}: ${value.type} 관계의 대상은 소품이어야 합니다.`);
    }
    if (value.type === 'placeOn' && (source.type !== 'prop' || target.type !== 'prop')) {
      errors.push(`${location}: placeOn 관계는 소품 사이에서만 사용할 수 있습니다.`);
    }
  }

  const parameters = value.parameters;
  if ('hand' in parameters && parameters.hand !== 'left' && parameters.hand !== 'right') {
    errors.push(`${location}: hand 값은 left 또는 right여야 합니다.`);
  }
  if ('lookMode' in parameters && parameters.lookMode !== 'head' && parameters.lookMode !== 'body') {
    errors.push(`${location}: lookMode 값이 올바르지 않습니다.`);
  }
  if ('offset' in parameters && parameters.offset !== undefined && !isVec3(parameters.offset)) {
    errors.push(`${location}: offset은 Vec3여야 합니다.`);
  }
  return true;
}

function validateAction(
  value: unknown,
  entityMap: Map<string, Entity>,
  shotDuration: number,
  errors: string[],
  location: string,
): value is ActionBlock {
  if (!isRecord(value)) {
    errors.push(`${location}: 행동이 객체가 아닙니다.`);
    return false;
  }
  if (
    typeof value.id !== 'string'
    || typeof value.type !== 'string'
    || typeof value.actorEntityId !== 'string'
    || !isFiniteNumber(value.startTime)
    || !isFiniteNumber(value.duration)
    || typeof value.enabled !== 'boolean'
    || !isRecord(value.parameters)
  ) {
    errors.push(`${location}: 행동 필수 필드가 올바르지 않습니다.`);
    return false;
  }
  if (!ACTION_TYPES.has(value.type)) errors.push(`${location}: 지원하지 않는 행동 ${value.type}입니다.`);
  if (value.startTime < 0 || value.duration <= 0 || value.startTime + value.duration > shotDuration + 1e-6) {
    errors.push(`${location}: 행동 시간이 Shot 범위를 벗어납니다.`);
  }
  const actor = entityMap.get(value.actorEntityId);
  const target = typeof value.targetEntityId === 'string' ? entityMap.get(value.targetEntityId) : undefined;
  const surfaceId = typeof value.parameters.surfaceEntityId === 'string' ? value.parameters.surfaceEntityId : undefined;
  const surface = surfaceId ? entityMap.get(surfaceId) : undefined;
  if (!actor) errors.push(`${location}: 실행 객체가 존재하지 않습니다.`);
  if (typeof value.targetEntityId === 'string' && !target) errors.push(`${location}: 대상 객체가 존재하지 않습니다.`);
  if (surfaceId && !surface) errors.push(`${location}: 표면 객체가 존재하지 않습니다.`);

  if (actor) {
    if ((value.type === 'walk' || value.type === 'turnAround' || value.type === 'pickUp' || value.type === 'putDown') && actor.type !== 'character') {
      errors.push(`${location}: ${value.type} 행동의 실행 객체는 인물이어야 합니다.`);
    }
    if ((value.type === 'cameraDolly' || value.type === 'cameraOrbit') && actor.type !== 'camera') {
      errors.push(`${location}: 카메라 행동의 실행 객체는 카메라여야 합니다.`);
    }
  }
  if ((value.type === 'pickUp' || value.type === 'putDown') && (!target || target.type !== 'prop')) {
    errors.push(`${location}: ${value.type} 행동의 대상은 소품이어야 합니다.`);
  }
  if (value.type === 'putDown' && (!surface || surface.type !== 'prop')) {
    errors.push(`${location}: putDown 행동에는 표면 소품이 필요합니다.`);
  }
  if (value.type === 'cameraOrbit' && !target) errors.push(`${location}: cameraOrbit에는 대상 객체가 필요합니다.`);

  const parameters = value.parameters;
  if ('direction' in parameters && parameters.direction !== undefined && !isVec3(parameters.direction)) {
    errors.push(`${location}: direction은 Vec3여야 합니다.`);
  }
  for (const key of ['distance', 'angle'] as const) {
    if (key in parameters && parameters[key] !== undefined && !isFiniteNumber(parameters[key])) {
      errors.push(`${location}: ${key} 값은 유한한 숫자여야 합니다.`);
    }
  }
  if ('hand' in parameters && parameters.hand !== undefined && parameters.hand !== 'left' && parameters.hand !== 'right') {
    errors.push(`${location}: hand 값은 left 또는 right여야 합니다.`);
  }
  return true;
}


function validateGenerationResult(value: unknown, errors: string[], location: string): value is GenerationResult {
  if (!isRecord(value)) {
    errors.push(`${location}: 생성 결과가 객체가 아닙니다.`);
    return false;
  }
  if (
    typeof value.id !== 'string'
    || value.provider !== 'comfyui'
    || typeof value.serverUrl !== 'string'
    || typeof value.promptId !== 'string'
    || typeof value.workflowName !== 'string'
    || typeof value.createdAt !== 'string'
    || !Array.isArray(value.outputs)
  ) {
    errors.push(`${location}: 생성 결과 필수 필드가 올바르지 않습니다.`);
    return false;
  }
  value.outputs.forEach((output, index) => {
    if (!isRecord(output)
      || typeof output.nodeId !== 'string'
      || typeof output.filename !== 'string'
      || typeof output.subfolder !== 'string'
      || typeof output.type !== 'string'
      || !['image', 'video', 'audio', 'file'].includes(String(output.kind))) {
      errors.push(`${location}.outputs[${index}]: 출력 파일 정보가 올바르지 않습니다.`);
    }
  });
  return true;
}

export function validateAndMigrateProject(value: unknown): ProjectValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ['프로젝트 루트가 객체가 아닙니다.'], warnings, migrated: false };

  const raw = structuredClone(value) as Record<string, unknown>;
  const previousVersion = typeof raw.schemaVersion === 'string' ? raw.schemaVersion : '0.2.0 이하';
  const migrated = raw.schemaVersion !== CURRENT_SCHEMA_VERSION;
  if (migrated) warnings.push(`${previousVersion} 프로젝트를 ${CURRENT_SCHEMA_VERSION} 스키마로 변환했습니다.`);

  if (typeof raw.id !== 'string') errors.push('project.id가 없습니다.');
  if (typeof raw.name !== 'string') errors.push('project.name이 없습니다.');
  if (!isFiniteNumber(raw.revision)) errors.push('project.revision이 유한한 숫자가 아닙니다.');
  if (typeof raw.activeSceneId !== 'string') errors.push('project.activeSceneId가 없습니다.');
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) errors.push('프로젝트에는 최소 한 개의 Scene이 필요합니다.');
  if (errors.length || !Array.isArray(raw.scenes)) return { success: false, errors, warnings, migrated };

  const sceneIds = new Set<string>();
  for (const [sceneIndex, sceneValue] of raw.scenes.entries()) {
    const location = `scenes[${sceneIndex}]`;
    if (!isRecord(sceneValue)) {
      errors.push(`${location}: Scene이 객체가 아닙니다.`);
      continue;
    }
    if (typeof sceneValue.id !== 'string' || typeof sceneValue.name !== 'string') {
      errors.push(`${location}: id 또는 name이 없습니다.`);
      continue;
    }
    if (sceneIds.has(sceneValue.id)) errors.push(`${location}: 중복 Scene ID ${sceneValue.id}입니다.`);
    sceneIds.add(sceneValue.id);
    if (!Array.isArray(sceneValue.entities)) {
      errors.push(`${location}.entities가 배열이 아닙니다.`);
      continue;
    }

    const migratedEntities: Entity[] = [];
    const entityIds = new Set<string>();
    for (const [entityIndex, entityValue] of sceneValue.entities.entries()) {
      if (!isRecord(entityValue)) {
        errors.push(`${location}.entities[${entityIndex}]: Entity가 객체가 아닙니다.`);
        continue;
      }
      const entity = migrateEntity(entityValue, migrated, warnings);
      if (!entity) {
        errors.push(`${location}.entities[${entityIndex}]: Entity 데이터가 올바르지 않습니다.`);
        continue;
      }
      if (entityIds.has(entity.id)) errors.push(`${location}: 중복 Entity ID ${entity.id}입니다.`);
      entityIds.add(entity.id);
      migratedEntities.push(entity);
    }
    sceneValue.entities = migratedEntities;
    const entityMap = new Map(migratedEntities.map((entity) => [entity.id, entity]));

    if (!Array.isArray(sceneValue.shots) || sceneValue.shots.length === 0) {
      errors.push(`${location}: 최소 한 개의 Shot이 필요합니다.`);
      continue;
    }
    const shotIds = new Set<string>();
    for (const [shotIndex, shotValue] of sceneValue.shots.entries()) {
      const shotLocation = `${location}.shots[${shotIndex}]`;
      if (!isRecord(shotValue)) {
        errors.push(`${shotLocation}: Shot이 객체가 아닙니다.`);
        continue;
      }
      if (typeof shotValue.id !== 'string' || typeof shotValue.name !== 'string') errors.push(`${shotLocation}: id 또는 name이 없습니다.`);
      if (typeof shotValue.id === 'string' && shotIds.has(shotValue.id)) errors.push(`${shotLocation}: 중복 Shot ID입니다.`);
      if (typeof shotValue.id === 'string') shotIds.add(shotValue.id);
      if (!isFiniteNumber(shotValue.order) || !isFiniteNumber(shotValue.duration) || Number(shotValue.duration) <= 0) errors.push(`${shotLocation}: order 또는 duration이 올바르지 않습니다.`);
      if (typeof shotValue.cameraEntityId !== 'string' || !entityIds.has(shotValue.cameraEntityId)) errors.push(`${shotLocation}: 유효한 카메라 Entity를 참조하지 않습니다.`);
      const cameraEntity = migratedEntities.find((entity) => entity.id === shotValue.cameraEntityId);
      if (cameraEntity && cameraEntity.type !== 'camera') errors.push(`${shotLocation}: cameraEntityId가 카메라가 아닙니다.`);
      if (!Array.isArray(shotValue.overrides)) errors.push(`${shotLocation}.overrides가 배열이 아닙니다.`);
      else shotValue.overrides.forEach((override, overrideIndex) => validateOverride(override, entityIds, errors, `${shotLocation}.overrides[${overrideIndex}]`));

      if (!Array.isArray(shotValue.relationships)) {
        shotValue.relationships = [];
        warnings.push(`${shotLocation}: 빈 관계 배열을 추가했습니다.`);
      }
      const relationshipIds = new Set<string>();
      if (Array.isArray(shotValue.relationships)) {
        shotValue.relationships.forEach((relationship, relationshipIndex) => {
          const relationshipLocation = `${shotLocation}.relationships[${relationshipIndex}]`;
          if (isRecord(relationship) && typeof relationship.id === 'string') {
            if (relationshipIds.has(relationship.id)) errors.push(`${relationshipLocation}: 중복 관계 ID입니다.`);
            relationshipIds.add(relationship.id);
          }
          validateRelationship(relationship, entityMap, errors, relationshipLocation);
        });
      }


      if (!Array.isArray(shotValue.actions)) {
        shotValue.actions = [];
        warnings.push(`${shotLocation}: 빈 행동 배열을 추가했습니다.`);
      }
      const actionIds = new Set<string>();
      if (Array.isArray(shotValue.actions)) {
        shotValue.actions.forEach((action, actionIndex) => {
          const actionLocation = `${shotLocation}.actions[${actionIndex}]`;
          if (isRecord(action) && typeof action.id === 'string') {
            if (actionIds.has(action.id)) errors.push(`${actionLocation}: 중복 행동 ID입니다.`);
            actionIds.add(action.id);
          }
          validateAction(action, entityMap, Number(shotValue.duration), errors, actionLocation);
        });
      }

      if (!Array.isArray(shotValue.generationResults)) {
        shotValue.generationResults = [];
        warnings.push(`${shotLocation}: 빈 생성 결과 배열을 추가했습니다.`);
      }
      const generationResultIds = new Set<string>();
      if (Array.isArray(shotValue.generationResults)) {
        shotValue.generationResults.forEach((result, resultIndex) => {
          const resultLocation = `${shotLocation}.generationResults[${resultIndex}]`;
          if (isRecord(result) && typeof result.id === 'string') {
            if (generationResultIds.has(result.id)) errors.push(`${resultLocation}: 중복 생성 결과 ID입니다.`);
            generationResultIds.add(result.id);
          }
          validateGenerationResult(result, errors, resultLocation);
        });
      }
    }
  }

  if (typeof raw.activeSceneId === 'string' && !sceneIds.has(raw.activeSceneId)) {
    const firstScene = raw.scenes[0];
    if (isRecord(firstScene) && typeof firstScene.id === 'string') {
      raw.activeSceneId = firstScene.id;
      warnings.push('존재하지 않는 activeSceneId를 첫 Scene으로 교정했습니다.');
    }
  }

  raw.schemaVersion = CURRENT_SCHEMA_VERSION;
  if (errors.length) return { success: false, errors, warnings, migrated };
  return { success: true, project: raw as unknown as Project, errors, warnings, migrated };
}

export function isProject(value: unknown): value is Project {
  return validateAndMigrateProject(value).success;
}
