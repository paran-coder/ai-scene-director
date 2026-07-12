import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { calculateHandLocalPosition, findPosePreset } from './pose.ts';
import type { Entity, Relationship, RelationshipType, Vec3 } from './types.ts';

const RELATIONSHIP_PRIORITY: Record<RelationshipType, number> = {
  sitOn: 10,
  placeOn: 20,
  lookAt: 30,
  hold: 40,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function composeEntityMatrix(entity: Entity): Matrix4 {
  const quaternion = new Quaternion().setFromEuler(new Euler(...entity.transform.rotation, 'XYZ'));
  return new Matrix4().compose(
    new Vector3(...entity.transform.position),
    quaternion,
    new Vector3(...entity.transform.scale),
  );
}

function entityTop(entity: Entity): number {
  return entity.transform.position[1] + Math.abs(entity.transform.scale[1]) * 0.5;
}

function applySitOn(source: Entity, target: Entity, relationship: Relationship): void {
  if (source.type !== 'character' || !source.character) return;
  const offset = relationship.parameters.offset ?? [0, 0, 0];
  source.transform.position = [
    target.transform.position[0] + offset[0],
    entityTop(target) - 0.85 + (relationship.parameters.verticalOffset ?? 0) + offset[1],
    target.transform.position[2] + offset[2],
  ];
  if (relationship.parameters.alignRotation !== false) {
    source.transform.rotation = [
      source.transform.rotation[0],
      target.transform.rotation[1],
      source.transform.rotation[2],
    ];
  }
  const seated = findPosePreset('seated');
  if (seated) source.character.pose = structuredClone(seated.pose);
}

function applyPlaceOn(source: Entity, target: Entity, relationship: Relationship): void {
  const offset = relationship.parameters.offset ?? [0, 0, 0];
  source.transform.position = [
    target.transform.position[0] + offset[0],
    entityTop(target) + Math.abs(source.transform.scale[1]) * 0.5 + (relationship.parameters.verticalOffset ?? 0) + offset[1],
    target.transform.position[2] + offset[2],
  ];
  if (relationship.parameters.alignRotation) {
    source.transform.rotation = [source.transform.rotation[0], target.transform.rotation[1], source.transform.rotation[2]];
  }
}

function applyLookAt(source: Entity, target: Entity, relationship: Relationship): void {
  if (source.type !== 'character' || !source.character) return;
  const sourcePosition = new Vector3(...source.transform.position).add(new Vector3(0, 1.45 * source.transform.scale[1], 0));
  const targetPosition = new Vector3(...target.transform.position).add(
    new Vector3(0, target.type === 'character' ? 1.45 * target.transform.scale[1] : 0, 0),
  );
  const worldDirection = targetPosition.sub(sourcePosition);
  if (worldDirection.lengthSq() < 1e-8) return;

  const horizontal = Math.hypot(worldDirection.x, worldDirection.z);
  const pitch = clamp(Math.atan2(worldDirection.y, Math.max(horizontal, 1e-4)), -0.7, 0.7);
  const worldYaw = Math.atan2(-worldDirection.x, -worldDirection.z);

  if (relationship.parameters.lookMode === 'body') {
    source.transform.rotation = [source.transform.rotation[0], worldYaw, source.transform.rotation[2]];
    source.character.pose.head = [pitch, 0, source.character.pose.head[2]];
    return;
  }

  const localYaw = clamp(worldYaw - source.transform.rotation[1], -1.35, 1.35);
  source.character.pose.head = [pitch, localYaw, source.character.pose.head[2]];
  source.character.pose.neck = [pitch * 0.25, localYaw * 0.35, source.character.pose.neck[2]];
}

function applyHold(source: Entity, target: Entity, relationship: Relationship): void {
  if (source.type !== 'character' || !source.character || target.type !== 'prop') return;
  const hand = relationship.parameters.hand ?? 'right';
  const localHand = calculateHandLocalPosition(source.character.pose, hand);
  const sourceMatrix = composeEntityMatrix(source);
  const worldHand = new Vector3(...localHand).applyMatrix4(sourceMatrix);
  const offset = new Vector3(...(relationship.parameters.offset ?? [0, -0.08, 0]));
  const sourceQuaternion = new Quaternion().setFromEuler(new Euler(...source.transform.rotation, 'XYZ'));
  offset.applyQuaternion(sourceQuaternion);
  worldHand.add(offset);
  target.transform.position = worldHand.toArray() as Vec3;
  if (relationship.parameters.alignRotation !== false) {
    target.transform.rotation = [
      source.transform.rotation[0],
      source.transform.rotation[1],
      source.transform.rotation[2],
    ];
  }
}

export function applyRelationships(entities: Entity[], relationships: Relationship[]): Entity[] {
  const result = entities.map((entity) => structuredClone(entity));
  const entityMap = new Map(result.map((entity) => [entity.id, entity]));
  const active = relationships
    .filter((relationship) => relationship.active)
    .sort((a, b) => RELATIONSHIP_PRIORITY[a.type] - RELATIONSHIP_PRIORITY[b.type]);

  for (const relationship of active) {
    const source = entityMap.get(relationship.sourceEntityId);
    const target = entityMap.get(relationship.targetEntityId);
    if (!source || !target) continue;
    switch (relationship.type) {
      case 'sitOn':
        applySitOn(source, target, relationship);
        break;
      case 'placeOn':
        applyPlaceOn(source, target, relationship);
        break;
      case 'lookAt':
        applyLookAt(source, target, relationship);
        break;
      case 'hold':
        applyHold(source, target, relationship);
        break;
    }
  }
  return result;
}

export function findControllingRelationship(relationships: Relationship[], entityId: string): Relationship | undefined {
  return relationships.find((relationship) => relationship.active && (
    (relationship.type === 'hold' && relationship.targetEntityId === entityId)
    || (relationship.type === 'placeOn' && relationship.sourceEntityId === entityId)
    || (relationship.type === 'sitOn' && relationship.sourceEntityId === entityId)
  ));
}

export function describeRelationship(relationship: Relationship, entities: Entity[]): string {
  const source = entities.find((entity) => entity.id === relationship.sourceEntityId)?.name ?? '알 수 없음';
  const target = entities.find((entity) => entity.id === relationship.targetEntityId)?.name ?? '알 수 없음';
  switch (relationship.type) {
    case 'lookAt': return `${source} → ${target} 바라보기`;
    case 'hold': return `${source} ${relationship.parameters.hand === 'left' ? '왼손' : '오른손'} → ${target} 들기`;
    case 'sitOn': return `${source} → ${target} 앉기`;
    case 'placeOn': return `${source} → ${target} 위에 놓기`;
  }
}
