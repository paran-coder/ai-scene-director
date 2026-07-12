import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { calculateHandLocalPosition } from './pose.ts';
import type { ActionBlock, ActionType, Entity, Relationship, Vec3 } from './types.ts';

export const ACTION_LABELS: Record<ActionType, string> = {
  walk: '걷기',
  turnAround: '뒤돌아보기',
  pickUp: '물건 집기',
  putDown: '물건 내려놓기',
  cameraDolly: '카메라 돌리 인',
  cameraOrbit: '카메라 오빗',
};

export const ACTION_DEFAULT_DURATION: Record<ActionType, number> = {
  walk: 2.5,
  turnAround: 1.2,
  pickUp: 1.5,
  putDown: 1.5,
  cameraDolly: 2.5,
  cameraOrbit: 3,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function actionProgress(action: ActionBlock, time: number): number {
  if (time < action.startTime) return -1;
  if (action.duration <= 0) return 1;
  return clamp01((time - action.startTime) / action.duration);
}

function entityMap(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function normalizedDirection(direction: Vec3 | undefined, fallback: Vec3 = [0, 0, -1]): Vector3 {
  const vector = new Vector3(...(direction ?? fallback));
  if (vector.lengthSq() < 1e-8) vector.set(...fallback);
  return vector.normalize();
}

function entityTop(entity: Entity): number {
  return entity.transform.position[1] + Math.abs(entity.transform.scale[1]) * 0.5;
}

function composeEntityMatrix(entity: Entity): Matrix4 {
  const quaternion = new Quaternion().setFromEuler(new Euler(...entity.transform.rotation, 'XYZ'));
  return new Matrix4().compose(
    new Vector3(...entity.transform.position),
    quaternion,
    new Vector3(...entity.transform.scale),
  );
}

function worldHandPosition(character: Entity, hand: 'left' | 'right'): Vector3 | null {
  if (character.type !== 'character' || !character.character) return null;
  const local = calculateHandLocalPosition(character.character.pose, hand);
  return new Vector3(...local).applyMatrix4(composeEntityMatrix(character));
}

function removePropRelationships(relationships: Relationship[], propId: string): Relationship[] {
  return relationships.filter((relationship) => !(
    (relationship.type === 'hold' && relationship.targetEntityId === propId)
    || (relationship.type === 'placeOn' && relationship.sourceEntityId === propId)
  ));
}

function addOrReplaceRelationship(relationships: Relationship[], relationship: Relationship): Relationship[] {
  const withoutConflicts = relationships.filter((item) => {
    if (relationship.type === 'hold') {
      const hand = relationship.parameters.hand ?? 'right';
      return !(
        (item.type === 'hold' && item.targetEntityId === relationship.targetEntityId)
        || (item.type === 'hold' && item.sourceEntityId === relationship.sourceEntityId && (item.parameters.hand ?? 'right') === hand)
      );
    }
    if (relationship.type === 'placeOn') {
      return !(item.type === 'placeOn' && item.sourceEntityId === relationship.sourceEntityId);
    }
    return item.id !== relationship.id;
  });
  return [...withoutConflicts, relationship];
}

function animateWalk(entity: Entity, action: ActionBlock, progress: number): void {
  const eased = smoothstep(progress);
  const direction = normalizedDirection(action.parameters.direction);
  const distance = action.parameters.distance ?? 1.5;
  entity.transform.position = new Vector3(...entity.transform.position)
    .add(direction.multiplyScalar(distance * eased))
    .toArray() as Vec3;

  if (entity.type === 'character' && entity.character && progress > 0 && progress < 1) {
    const phase = progress * Math.PI * 4;
    const swing = Math.sin(phase) * 0.55;
    const knee = Math.max(0, Math.sin(phase + Math.PI / 2)) * 0.65;
    entity.character.pose.leftShoulder = [swing, 0, entity.character.pose.leftShoulder[2]];
    entity.character.pose.rightShoulder = [-swing, 0, entity.character.pose.rightShoulder[2]];
    entity.character.pose.leftHip = [-swing * 0.7, 0, 0];
    entity.character.pose.rightHip = [swing * 0.7, 0, 0];
    entity.character.pose.leftKnee = [knee, 0, 0];
    entity.character.pose.rightKnee = [Math.max(0, -Math.sin(phase + Math.PI / 2)) * 0.65, 0, 0];
    entity.character.pose.pelvis = [0, 0, Math.sin(phase * 2) * 0.03];
  }
}

function animateTurn(entity: Entity, action: ActionBlock, progress: number): void {
  const angle = action.parameters.angle ?? Math.PI;
  entity.transform.rotation = [
    entity.transform.rotation[0],
    entity.transform.rotation[1] + angle * smoothstep(progress),
    entity.transform.rotation[2],
  ];
  if (entity.type === 'character' && entity.character && progress > 0 && progress < 1) {
    const lead = Math.sin(progress * Math.PI);
    entity.character.pose.head = [
      entity.character.pose.head[0],
      Math.sign(angle) * lead * 0.55,
      entity.character.pose.head[2],
    ];
    entity.character.pose.chest = [
      entity.character.pose.chest[0],
      Math.sign(angle) * lead * 0.25,
      entity.character.pose.chest[2],
    ];
  }
}

function animateCameraDolly(entity: Entity, target: Entity | undefined, action: ActionBlock, progress: number): void {
  const distance = action.parameters.distance ?? 2;
  let direction: Vector3;
  if (target) {
    direction = new Vector3(...target.transform.position).sub(new Vector3(...entity.transform.position));
    if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1);
    direction.normalize();
  } else {
    direction = new Vector3(0, 0, -1).applyEuler(new Euler(...entity.transform.rotation, 'XYZ')).normalize();
  }
  entity.transform.position = new Vector3(...entity.transform.position)
    .add(direction.multiplyScalar(distance * smoothstep(progress)))
    .toArray() as Vec3;
}

function animateCameraOrbit(entity: Entity, target: Entity | undefined, action: ActionBlock, progress: number): void {
  if (!target) return;
  const center = new Vector3(...target.transform.position);
  const start = new Vector3(...entity.transform.position);
  const offset = start.clone().sub(center);
  const angle = (action.parameters.angle ?? Math.PI / 2) * (action.parameters.clockwise === false ? -1 : 1) * smoothstep(progress);
  offset.applyAxisAngle(new Vector3(0, 1, 0), angle);
  const next = center.clone().add(offset);
  entity.transform.position = next.toArray() as Vec3;
  const direction = center.clone().sub(next);
  entity.transform.rotation = [
    Math.atan2(direction.y, Math.hypot(direction.x, direction.z)),
    Math.atan2(-direction.x, -direction.z),
    0,
  ];
}

export interface ActionEvaluationResult {
  entities: Entity[];
  relationships: Relationship[];
}

export function evaluateActions(
  baseEntities: Entity[],
  initiallyResolvedEntities: Entity[],
  baseRelationships: Relationship[],
  actions: ActionBlock[],
  time: number,
): ActionEvaluationResult {
  const entities = baseEntities.map((entity) => structuredClone(entity));
  const initialMap = entityMap(initiallyResolvedEntities);
  const map = entityMap(entities);
  let relationships = baseRelationships.map((relationship) => structuredClone(relationship));

  const sorted = actions
    .filter((action) => action.enabled)
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));

  for (const action of sorted) {
    const rawProgress = actionProgress(action, time);
    if (rawProgress < 0) continue;
    const actor = map.get(action.actorEntityId);
    const target = action.targetEntityId ? map.get(action.targetEntityId) : undefined;
    if (!actor) continue;

    switch (action.type) {
      case 'walk':
        relationships = relationships.filter((relationship) => !(relationship.type === 'sitOn' && relationship.sourceEntityId === actor.id));
        animateWalk(actor, action, rawProgress);
        break;
      case 'turnAround':
        animateTurn(actor, action, rawProgress);
        break;
      case 'cameraDolly':
        if (actor.type === 'camera') animateCameraDolly(actor, target, action, rawProgress);
        break;
      case 'cameraOrbit':
        if (actor.type === 'camera') animateCameraOrbit(actor, target, action, rawProgress);
        break;
      case 'pickUp': {
        if (!target || target.type !== 'prop' || actor.type !== 'character') break;
        relationships = removePropRelationships(relationships, target.id);
        const initial = initialMap.get(target.id);
        const hand = action.parameters.hand ?? 'right';
        const handPosition = worldHandPosition(actor, hand);
        if (!initial || !handPosition) break;
        if (rawProgress < 1) {
          target.transform.position = new Vector3(...initial.transform.position)
            .lerp(handPosition.add(new Vector3(0, -0.08, 0)), smoothstep(rawProgress))
            .toArray() as Vec3;
        } else {
          relationships = addOrReplaceRelationship(relationships, {
            id: `action:${action.id}:hold`,
            type: 'hold',
            sourceEntityId: actor.id,
            targetEntityId: target.id,
            parameters: { hand, alignRotation: true },
            active: true,
          });
        }
        break;
      }
      case 'putDown': {
        if (!target || target.type !== 'prop' || actor.type !== 'character') break;
        const surface = action.parameters.surfaceEntityId ? map.get(action.parameters.surfaceEntityId) : undefined;
        if (!surface || surface.type !== 'prop') break;
        const existingHold = relationships.find((relationship) => relationship.type === 'hold' && relationship.targetEntityId === target.id);
        let initialPosition = initialMap.get(target.id)?.transform.position;
        if (existingHold) {
          const holder = map.get(existingHold.sourceEntityId);
          const handPosition = holder ? worldHandPosition(holder, existingHold.parameters.hand ?? 'right') : null;
          if (handPosition) initialPosition = handPosition.add(new Vector3(0, -0.08, 0)).toArray() as Vec3;
        }
        relationships = removePropRelationships(relationships, target.id);
        if (!initialPosition) break;
        const end = new Vector3(
          surface.transform.position[0],
          entityTop(surface) + Math.abs(target.transform.scale[1]) * 0.5,
          surface.transform.position[2],
        );
        if (rawProgress < 1) {
          target.transform.position = new Vector3(...initialPosition)
            .lerp(end, smoothstep(rawProgress))
            .toArray() as Vec3;
        } else {
          relationships = addOrReplaceRelationship(relationships, {
            id: `action:${action.id}:placeOn`,
            type: 'placeOn',
            sourceEntityId: target.id,
            targetEntityId: surface.id,
            parameters: { alignRotation: false },
            active: true,
          });
        }
        break;
      }
    }
  }

  return { entities, relationships };
}

export function describeAction(action: ActionBlock, entities: Entity[]): string {
  const actor = entities.find((entity) => entity.id === action.actorEntityId)?.name ?? '알 수 없음';
  const target = entities.find((entity) => entity.id === action.targetEntityId)?.name;
  const surface = entities.find((entity) => entity.id === action.parameters.surfaceEntityId)?.name;
  switch (action.type) {
    case 'walk': return `${actor} 걷기 ${action.parameters.distance ?? 1.5}m`;
    case 'turnAround': return `${actor} 뒤돌아보기`;
    case 'pickUp': return `${actor} → ${target ?? '소품'} 집기`;
    case 'putDown': return `${actor} → ${target ?? '소품'}을 ${surface ?? '표면'}에 내려놓기`;
    case 'cameraDolly': return `${actor} → ${target ?? '전방'} 돌리 인`;
    case 'cameraOrbit': return `${actor} → ${target ?? '대상'} 오빗`;
  }
}
