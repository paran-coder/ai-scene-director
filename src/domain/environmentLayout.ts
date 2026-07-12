import { createEnvironmentState, createPresetEntities, ENVIRONMENT_PRESETS } from './environmentPresets.ts';
import type { Entity, Scene, Shot, Vec3 } from './types.ts';

function semanticRole(entity: Entity): string {
  const text = `${entity.name} ${(entity.asset?.tags ?? []).join(' ')}`.toLowerCase();
  const roles: Array<[string, string[]]> = [
    ['floor', ['바닥', '보도', '아스팔트', 'floor', 'sidewalk', 'ground']],
    ['wall', ['벽', '외벽', '배경', 'wall', 'backdrop', 'storefront']],
    ['table', ['테이블', '책상', '식탁', 'table', 'desk']],
    ['chair', ['의자', 'chair', 'seat', 'sofa', '소파']],
    ['window', ['창문', '유리창', 'window']],
    ['door', ['문', '출입문', 'door']],
    ['counter', ['카운터', '조리대', 'counter']],
    ['light', ['조명', '가로등', '램프', 'light', 'lamp']],
    ['sign', ['간판', 'sign']],
  ];
  return roles.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] ?? entity.asset?.category ?? 'generic';
}

function cameraRotationToward(position: Vec3, target: Vec3): Vec3 {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const horizontal = Math.hypot(dx, dz) || 1;
  return [-Math.atan2(dy, horizontal), Math.atan2(-dx, -dz), 0];
}

function characterPositions(count: number): Vec3[] {
  if (count <= 1) return [[0, 0, 0]];
  if (count === 2) return [[-1.1, 0, 0], [1.1, 0, 0]];
  if (count === 3) return [[-1.35, 0, 0.35], [1.35, 0, 0.35], [0, 0, -1.2]];
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return [(column - (columns - 1) / 2) * 1.4, 0, (row - 0.5) * 1.35];
  });
}

export function relayoutSceneEntities(scene: Scene): Scene {
  const next = structuredClone(scene);
  const characters = next.entities.filter((entity) => entity.type === 'character');
  const positions = characterPositions(characters.length);
  characters.forEach((character, index) => {
    character.transform.position = positions[index] ?? [0, 0, 0];
    const target: Vec3 = [0, 1, 0];
    character.transform.rotation = cameraRotationToward([character.transform.position[0], 1, character.transform.position[2]], target);
  });

  const looseProps = next.entities.filter((entity) => entity.type === 'prop' && entity.asset?.source !== 'preset');
  let handheldIndex = 0;
  let vehicleIndex = 0;
  looseProps.forEach((prop) => {
    const category = prop.asset?.category;
    if (category === 'handheld') {
      const owner = characters[handheldIndex % Math.max(1, characters.length)];
      const ownerPosition = owner?.transform.position ?? [0, 0, 0];
      prop.transform.position = [ownerPosition[0] + 0.55, 1.05, ownerPosition[2] - 0.15];
      handheldIndex += 1;
    } else if (category === 'vehicle') {
      prop.transform.position = [3.4 + vehicleIndex * 1.6, Math.max(0.5, prop.transform.position[1]), 1.8];
      vehicleIndex += 1;
    }
  });

  const centerX = characters.length ? characters.reduce((sum, entity) => sum + entity.transform.position[0], 0) / characters.length : 0;
  const centerZ = characters.length ? characters.reduce((sum, entity) => sum + entity.transform.position[2], 0) / characters.length : 0;
  const cameraDistance = 6 + Math.max(0, characters.length - 2) * 0.8;
  next.entities.filter((entity) => entity.type === 'camera').forEach((camera, index) => {
    const angle = index * 0.45;
    const position: Vec3 = [centerX + Math.sin(angle) * 1.6, 2.2 + Math.min(1.2, characters.length * 0.1), centerZ + cameraDistance + Math.cos(angle) * 0.8];
    camera.transform.position = position;
    camera.transform.rotation = cameraRotationToward(position, [centerX, 1, centerZ]);
  });
  return next;
}

function remapShotReferences(shot: Shot, idMap: Map<string, string>, removedIds: Set<string>): void {
  shot.overrides = shot.overrides.flatMap((override) => {
    const mapped = idMap.get(override.entityId);
    if (mapped) return [{ ...override, id: `${shot.id}:${mapped}:${override.path}`, entityId: mapped }];
    return removedIds.has(override.entityId) ? [] : [override];
  });
  shot.relationships = shot.relationships.flatMap((relationship) => {
    const source = idMap.get(relationship.sourceEntityId) ?? relationship.sourceEntityId;
    const target = idMap.get(relationship.targetEntityId) ?? relationship.targetEntityId;
    if ((removedIds.has(relationship.sourceEntityId) && !idMap.has(relationship.sourceEntityId))
      || (removedIds.has(relationship.targetEntityId) && !idMap.has(relationship.targetEntityId))) return [];
    return [{ ...relationship, sourceEntityId: source, targetEntityId: target }];
  });
  shot.actions = shot.actions.flatMap((action) => {
    const actor = idMap.get(action.actorEntityId) ?? action.actorEntityId;
    const target = action.targetEntityId ? idMap.get(action.targetEntityId) ?? action.targetEntityId : undefined;
    const surface = action.parameters.surfaceEntityId
      ? idMap.get(action.parameters.surfaceEntityId) ?? action.parameters.surfaceEntityId
      : undefined;
    if ((removedIds.has(action.actorEntityId) && !idMap.has(action.actorEntityId))
      || (action.targetEntityId && removedIds.has(action.targetEntityId) && !idMap.has(action.targetEntityId))
      || (action.parameters.surfaceEntityId && removedIds.has(action.parameters.surfaceEntityId) && !idMap.has(action.parameters.surfaceEntityId))) return [];
    return [{ ...action, actorEntityId: actor, targetEntityId: target, parameters: { ...action.parameters, surfaceEntityId: surface } }];
  });
}

export function replaceEnvironmentPreset(scene: Scene, presetId: string, relayout = true): Scene {
  const preset = ENVIRONMENT_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error('환경 프리셋을 찾지 못했습니다.');
  const next = structuredClone(scene);
  const removed = next.entities.filter((entity) => entity.asset?.presetId?.startsWith(`${next.environment.presetId}:`));
  const removedIds = new Set(removed.map((entity) => entity.id));
  const preserved = next.entities.filter((entity) => !removedIds.has(entity.id));
  const generated = createPresetEntities(preset);

  const existingRoles = new Set(preserved.filter((entity) => entity.type === 'prop').map(semanticRole));
  const filteredGenerated = generated.filter((entity) => {
    const role = semanticRole(entity);
    if (['floor', 'wall', 'window', 'door', 'light', 'sign'].includes(role)) return true;
    return !existingRoles.has(role);
  });

  const roleBuckets = new Map<string, Entity[]>();
  filteredGenerated.forEach((entity) => {
    const role = semanticRole(entity);
    roleBuckets.set(role, [...(roleBuckets.get(role) ?? []), entity]);
  });
  const idMap = new Map<string, string>();
  removed.forEach((entity) => {
    const bucket = roleBuckets.get(semanticRole(entity));
    const replacement = bucket?.shift();
    if (replacement) idMap.set(entity.id, replacement.id);
  });

  next.entities = [...preserved, ...filteredGenerated];
  next.environment = createEnvironmentState(preset, next.environment.atmosphere ?? []);
  next.shots.forEach((shot) => remapShotReferences(shot, idMap, removedIds));
  return relayout ? relayoutSceneEntities(next) : next;
}
