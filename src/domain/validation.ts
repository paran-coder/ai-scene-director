import { collectActionConflicts } from './actions.ts';
import { createEnvironmentState, resolveEnvironmentPreset } from './environmentPresets.ts';
import { createNeutralPose } from './pose.ts';
import {
  CURRENT_SCHEMA_VERSION,
  JOINT_NAMES,
  type ActionBlock,
  type AssetLibraryItem,
  type Entity,
  type ReferenceImage,
  type GenerationResult,
  type HumanoidRigProportions,
  type PoseState,
  type Project,
  type Relationship,
  type ShotOverride,
  type Vec3,
} from './types.ts';

export { CURRENT_SCHEMA_VERSION };

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
  'camera.settings',
  'light.settings',
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



function isCameraData(value: unknown): boolean {
  return isRecord(value)
    && value.projection === 'perspective'
    && isFiniteNumber(value.fov) && value.fov >= 10 && value.fov <= 140
    && isFiniteNumber(value.near) && value.near > 0
    && isFiniteNumber(value.far) && value.far > Number(value.near)
    && ['16:9', '9:16', '1:1', '4:3'].includes(String(value.aspectRatio))
    && typeof value.showSafeFrame === 'boolean';
}

function isLightData(value: unknown): boolean {
  return isRecord(value)
    && ['directional', 'point', 'spot', 'ambient'].includes(String(value.kind))
    && typeof value.color === 'string'
    && isFiniteNumber(value.intensity) && value.intensity >= 0
    && isFiniteNumber(value.range) && value.range >= 0
    && isFiniteNumber(value.angle) && value.angle > 0 && value.angle <= Math.PI
    && typeof value.castShadow === 'boolean'
    && (value.targetEntityId === undefined || typeof value.targetEntityId === 'string');
}

function isReferenceImage(value: unknown): value is ReferenceImage {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.storageKey === 'string'
    && value.storageKey.length > 0
    && (value.dataUrl === undefined || (typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:image/')))
    && typeof value.mimeType === 'string'
    && value.mimeType.startsWith('image/')
    && isFiniteNumber(value.sizeBytes) && value.sizeBytes >= 0
    && isFiniteNumber(value.opacity) && value.opacity >= 0 && value.opacity <= 1
    && typeof value.visible === 'boolean'
    && (value.cameraEntityId === undefined || typeof value.cameraEntityId === 'string')
    && ['contain', 'cover'].includes(String(value.fit));
}

function isAppearance(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['lead', 'supporting', 'background'].includes(String(value.role))
    && typeof value.descriptor === 'string'
    && ['child', 'teen', 'adult', 'senior', 'unspecified'].includes(String(value.ageGroup))
    && ['feminine', 'masculine', 'neutral', 'unspecified'].includes(String(value.presentation))
    && typeof value.outfitSummary === 'string'
    && Array.isArray(value.outfitColors)
    && value.outfitColors.every((color) => typeof color === 'string')
    && typeof value.hairColor === 'string'
    && typeof value.skinTone === 'string';
}

function isAsset(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if ('modelAssetId' in value && value.modelAssetId !== undefined && typeof value.modelAssetId !== 'string') return false;
  return ['environment', 'architecture', 'furniture', 'handheld', 'vehicle', 'decor', 'lighting', 'generic'].includes(String(value.category))
    && ['box', 'cylinder', 'sphere', 'plane'].includes(String(value.primitive))
    && typeof value.color === 'string'
    && ['matte', 'metal', 'glass', 'emissive'].includes(String(value.material))
    && ['preset', 'prompt', 'manual'].includes(String(value.source))
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === 'string');
}



function isRigProportions(value: unknown): value is HumanoidRigProportions {
  if (!isRecord(value) || !isFiniteNumber(value.referenceHeight) || !isFiniteNumber(value.pelvisHeight)) return false;
  const validArm = (arm: unknown) => isRecord(arm)
    && isVec3(arm.shoulderOffset)
    && isFiniteNumber(arm.upperLength)
    && arm.upperLength > 0
    && isFiniteNumber(arm.lowerLength)
    && arm.lowerLength > 0;
  const validLeg = (leg: unknown) => isRecord(leg)
    && isVec3(leg.hipOffset)
    && isFiniteNumber(leg.upperLength)
    && leg.upperLength > 0
    && isFiniteNumber(leg.lowerLength)
    && leg.lowerLength > 0
    && isFiniteNumber(leg.footLength)
    && leg.footLength > 0;
  return validArm(value.leftArm) && validArm(value.rightArm) && validLeg(value.leftLeg) && validLeg(value.rightLeg);
}

function migrateRigProportions(value: unknown): HumanoidRigProportions | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.referenceHeight)) return undefined;
  const validArm = (arm: unknown) => isRecord(arm)
    && isVec3(arm.shoulderOffset)
    && isFiniteNumber(arm.upperLength) && arm.upperLength > 0
    && isFiniteNumber(arm.lowerLength) && arm.lowerLength > 0;
  if (!validArm(value.leftArm) || !validArm(value.rightArm)) return undefined;
  const migrated = structuredClone(value) as unknown as HumanoidRigProportions;
  if (!isFiniteNumber(migrated.pelvisHeight)) migrated.pelvisHeight = 0.9;
  if (!isRecord(migrated.leftLeg)) migrated.leftLeg = { hipOffset: [-0.16, -0.08, 0], upperLength: 0.44, lowerLength: 0.42, footLength: 0.29 };
  if (!isRecord(migrated.rightLeg)) migrated.rightLeg = { hipOffset: [0.16, -0.08, 0], upperLength: 0.44, lowerLength: 0.42, footLength: 0.29 };
  return isRigProportions(migrated) ? migrated : undefined;
}

function isRigProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!['humanoid', 'partial', 'none'].includes(String(value.status))) return false;
  if (!['mixamo', 'vrm', 'generic', 'none'].includes(String(value.detectedPreset))) return false;
  if (!isFiniteNumber(value.skeletonCount) || !isFiniteNumber(value.mappedJointCount)) return false;
  if (!Array.isArray(value.nodeNames) || !value.nodeNames.every((name) => typeof name === 'string')) return false;
  if (!Array.isArray(value.missingJoints) || !value.missingJoints.every((joint) => JOINT_NAMES.includes(joint as never))) return false;
  if (!Array.isArray(value.animationClips) || !value.animationClips.every((name) => typeof name === 'string')) return false;
  if (!isRecord(value.boneMap) || !Object.entries(value.boneMap).every(([joint, boneName]) => JOINT_NAMES.includes(joint as never) && typeof boneName === 'string')) return false;
  if (!isRecord(value.axisCorrections) || !Object.entries(value.axisCorrections).every(([joint, correction]) => JOINT_NAMES.includes(joint as never) && isVec3(correction))) return false;
  return value.proportions === undefined || isRigProportions(value.proportions);
}

function isAssetLibraryItem(value: unknown): value is AssetLibraryItem {
  if (!isRecord(value)) return false;
  if ('rig' in value && value.rig !== undefined && !isRigProfile(value.rig)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && value.kind === 'glb'
    && ['character', 'prop', 'environment'].includes(String(value.category))
    && typeof value.mimeType === 'string'
    && isFiniteNumber(value.sizeBytes)
    && value.sizeBytes >= 0
    && typeof value.storageKey === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.originalFilename === 'string';
}

function isEnvironment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.presetId === 'string'
    && typeof value.name === 'string'
    && typeof value.location === 'string'
    && typeof value.backgroundColor === 'string'
    && typeof value.floorColor === 'string'
    && Array.isArray(value.palette)
    && value.palette.every((color) => typeof color === 'string')
    && Array.isArray(value.atmosphere)
    && value.atmosphere.every((item) => typeof item === 'string');
}

function defaultAppearance(name: string) {
  return {
    role: 'supporting' as const,
    descriptor: name,
    ageGroup: 'unspecified' as const,
    presentation: 'unspecified' as const,
    outfitSummary: '기본 의상',
    outfitColors: ['#64748b'],
    hairColor: '#1c1917',
    skinTone: '#d6a77a',
  };
}

function migrateEntity(raw: Record<string, unknown>, migrated: boolean, warnings: string[]): Entity | null {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !ENTITY_TYPES.has(String(raw.type))) return null;
  if (!isTransform(raw.transform) || typeof raw.visible !== 'boolean' || typeof raw.locked !== 'boolean') return null;

  const entity = structuredClone(raw) as unknown as Entity;
  if (entity.type === 'character') {
    if (!entity.character || !isPose(entity.character.pose)) {
      entity.character = { pose: createNeutralPose(), appearance: defaultAppearance(entity.name) };
      warnings.push(`${entity.name}: 기본 휴머노이드 포즈와 외형 정보를 추가했습니다.`);
    } else if (!isAppearance(entity.character.appearance)) {
      entity.character.appearance = defaultAppearance(entity.name);
      warnings.push(`${entity.name}: 기본 역할·의상 메타데이터를 추가했습니다.`);
    }
    if (migrated && entity.transform.scale[1] > 1.4) {
      entity.transform.scale = [1, 1, 1];
      if (entity.transform.position[1] > 0.5 && entity.transform.position[1] < 1.5) entity.transform.position[1] = 0;
      warnings.push(`${entity.name}: 이전 인물 프록시 크기를 휴머노이드 규격으로 변환했습니다.`);
    }
  } else {
    delete entity.character;
  }
  if (entity.type === 'camera') {
    if (!isCameraData(entity.camera)) {
      entity.camera = { projection: 'perspective', fov: 48, near: 0.1, far: 100, aspectRatio: '16:9', showSafeFrame: true };
      warnings.push(`${entity.name}: 기본 카메라 렌즈 설정을 추가했습니다.`);
    }
    delete entity.light;
  } else if (entity.type === 'light') {
    if (!isLightData(entity.light)) {
      entity.light = { kind: 'directional', color: '#fff4d6', intensity: 2, range: 12, angle: Math.PI / 4, castShadow: true };
      warnings.push(`${entity.name}: 기본 조명 설정을 추가했습니다.`);
    }
    delete entity.camera;
  } else {
    delete entity.camera;
    delete entity.light;
  }
  if (!isAsset(entity.asset)) {
    entity.asset = {
      category: entity.type === 'prop' ? 'generic' : entity.type === 'light' ? 'lighting' : 'generic',
      primitive: entity.type === 'light' ? 'sphere' : 'box',
      color: entity.type === 'camera' ? '#38bdf8' : entity.type === 'light' ? '#fde047' : entity.type === 'character' ? '#64748b' : '#a8a29e',
      material: entity.type === 'light' ? 'emissive' : 'matte',
      source: 'manual',
      tags: [entity.type],
    };
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
  if (value.path === 'camera.settings' && !isCameraData(value.value)) errors.push(`${location}: 카메라 설정이 올바르지 않습니다.`);
  if (value.path === 'light.settings' && !isLightData(value.value)) errors.push(`${location}: 조명 설정이 올바르지 않습니다.`);
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
  for (const key of ['distance', 'angle', 'strideLength', 'stepHeight', 'cadence', 'bodyLean'] as const) {
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
  if (!Array.isArray(raw.assetLibrary)) {
    raw.assetLibrary = [];
    warnings.push('빈 GLB 에셋 라이브러리를 추가했습니다.');
  }
  const assetLibraryIds = new Set<string>();
  if (Array.isArray(raw.assetLibrary)) {
    raw.assetLibrary.forEach((item, index) => {
      if (isRecord(item) && isRecord(item.rig)) {
        if (!isRecord(item.rig.axisCorrections)) {
          item.rig.axisCorrections = {};
          warnings.push(`assetLibrary[${index}]: 빈 본 축 보정 정보를 추가했습니다.`);
        }
        if ('proportions' in item.rig && item.rig.proportions !== undefined) {
          const proportions = migrateRigProportions(item.rig.proportions);
          if (proportions) {
            const changed = !isRigProportions(item.rig.proportions);
            item.rig.proportions = proportions;
            if (changed) warnings.push(`assetLibrary[${index}]: 다리 비율과 골반 높이 정보를 추가했습니다.`);
          } else {
            delete item.rig.proportions;
            warnings.push(`assetLibrary[${index}]: 잘못된 신체 비율 정보를 제거했습니다.`);
          }
        }
      }
      if (!isAssetLibraryItem(item)) {
        errors.push(`assetLibrary[${index}]: GLB 에셋 정보가 올바르지 않습니다.`);
        return;
      }
      if (assetLibraryIds.has(item.id)) errors.push(`assetLibrary[${index}]: 중복 에셋 ID입니다.`);
      assetLibraryIds.add(item.id);
    });
  }
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
    if (!isEnvironment(sceneValue.environment)) {
      const preset = resolveEnvironmentPreset(sceneValue.name);
      sceneValue.environment = createEnvironmentState(preset, []);
      warnings.push(`${location}: ${preset.name} 환경 프리셋을 추가했습니다.`);
    }
    if (!Array.isArray(sceneValue.referenceImages)) {
      sceneValue.referenceImages = [];
      warnings.push(`${location}: 빈 참조 이미지 배열을 추가했습니다.`);
    }
    const referenceIds = new Set<string>();
    if (Array.isArray(sceneValue.referenceImages)) {
      sceneValue.referenceImages.forEach((image, imageIndex) => {
        const imageLocation = `${location}.referenceImages[${imageIndex}]`;
        if (isRecord(image) && typeof image.id === 'string' && typeof image.storageKey !== 'string') {
          image.storageKey = `reference-image:${image.id}`;
          warnings.push(`${imageLocation}: 참조 이미지를 로컬 에셋 형식으로 변환했습니다.`);
        }
        if (!isReferenceImage(image)) {
          errors.push(`${imageLocation}: 참조 이미지 정보가 올바르지 않습니다.`);
          return;
        }
        if (referenceIds.has(image.id)) errors.push(`${imageLocation}: 중복 참조 이미지 ID입니다.`);
        referenceIds.add(image.id);
      });
    }
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
      if (entity.asset?.modelAssetId && !assetLibraryIds.has(entity.asset.modelAssetId)) {
        delete entity.asset.modelAssetId;
        entity.asset.tags = entity.asset.tags.filter((tag) => tag !== 'imported-glb');
        warnings.push(`${entity.name}: 찾을 수 없는 GLB 에셋 연결을 해제했습니다.`);
      }
      if (entityIds.has(entity.id)) errors.push(`${location}: 중복 Entity ID ${entity.id}입니다.`);
      entityIds.add(entity.id);
      migratedEntities.push(entity);
    }
    sceneValue.entities = migratedEntities;
    const entityMap = new Map(migratedEntities.map((entity) => [entity.id, entity]));
    for (const entity of migratedEntities) {
      if (entity.type !== 'light' || !entity.light?.targetEntityId) continue;
      const target = entityMap.get(entity.light.targetEntityId);
      if (!target || target.id === entity.id) {
        delete entity.light.targetEntityId;
        warnings.push(`${entity.name}: 존재하지 않는 스포트라이트 대상을 해제했습니다.`);
      }
    }
    if (Array.isArray(sceneValue.referenceImages)) {
      sceneValue.referenceImages.forEach((image, imageIndex) => {
        if (!isRecord(image) || image.cameraEntityId === undefined) return;
        const camera = entityMap.get(String(image.cameraEntityId));
        if (!camera || camera.type !== 'camera') {
          delete image.cameraEntityId;
          warnings.push(`${location}.referenceImages[${imageIndex}]: 존재하지 않는 카메라 연결을 해제했습니다.`);
        }
      });
    }

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
      else shotValue.overrides.forEach((override, overrideIndex) => {
        if (isRecord(override) && override.path === 'light.settings' && isRecord(override.value) && typeof override.value.targetEntityId === 'string') {
          if (!entityIds.has(override.value.targetEntityId) || override.value.targetEntityId === override.entityId) {
            delete override.value.targetEntityId;
            warnings.push(`${shotLocation}.overrides[${overrideIndex}]: 존재하지 않는 스포트라이트 대상을 해제했습니다.`);
          }
        }
        validateOverride(override, entityIds, errors, `${shotLocation}.overrides[${overrideIndex}]`);
      });

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
      if (Array.isArray(shotValue.actions)) {
        const conflicts = collectActionConflicts(shotValue.actions.filter((action): action is ActionBlock => isRecord(action) && typeof action.id === 'string' && typeof action.type === 'string') as ActionBlock[]);
        if (conflicts.length > 0) warnings.push(`${shotLocation}: 같은 객체를 동시에 사용하는 행동 ${conflicts.length}쌍을 확인해 주세요.`);
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
