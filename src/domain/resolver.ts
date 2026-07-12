import { evaluateActions } from './actions.ts';
import { applyRelationships } from './relationships.ts';
import type { Entity, PoseState, Scene, Shot, ShotOverride } from './types.ts';

function cloneEntity(entity: Entity): Entity {
  return structuredClone(entity);
}

function applyOverride(entity: Entity, override: ShotOverride): void {
  switch (override.path) {
    case 'transform.position':
      entity.transform.position = [...(override.value as [number, number, number])];
      return;
    case 'transform.rotation':
      entity.transform.rotation = [...(override.value as [number, number, number])];
      return;
    case 'transform.scale':
      entity.transform.scale = [...(override.value as [number, number, number])];
      return;
    case 'visible':
      entity.visible = Boolean(override.value);
      return;
    case 'character.pose':
      if (entity.character) entity.character.pose = structuredClone(override.value as PoseState);
  }
}

export function resolveEntityWithoutRelationships(scene: Scene, shot: Shot, entityId: string): Entity {
  const base = scene.entities.find((entity) => entity.id === entityId);
  if (!base) throw new Error(`Entity not found: ${entityId}`);

  const resolved = cloneEntity(base);
  shot.overrides
    .filter((override) => override.entityId === entityId)
    .forEach((override) => applyOverride(resolved, override));
  return resolved;
}

export function resolveSceneWithoutRelationships(scene: Scene, shot: Shot): Entity[] {
  return scene.entities.map((entity) => resolveEntityWithoutRelationships(scene, shot, entity.id));
}

export function resolveSceneAtTime(scene: Scene, shot: Shot, time = 0): Entity[] {
  const base = resolveSceneWithoutRelationships(scene, shot);
  const initiallyResolved = applyRelationships(base, shot.relationships ?? []);
  const evaluated = evaluateActions(base, initiallyResolved, shot.relationships ?? [], shot.actions ?? [], time);
  return applyRelationships(evaluated.entities, evaluated.relationships);
}

export function resolveScene(scene: Scene, shot: Shot): Entity[] {
  return resolveSceneAtTime(scene, shot, 0);
}

export function resolveEntity(scene: Scene, shot: Shot, entityId: string, time = 0): Entity {
  const resolved = resolveSceneAtTime(scene, shot, time).find((entity) => entity.id === entityId);
  if (!resolved) throw new Error(`Entity not found: ${entityId}`);
  return resolved;
}
