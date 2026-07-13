import type { Entity, Vec3 } from './types.ts';

export interface ViewFrame {
  position: Vec3;
  target: Vec3;
  distance: number;
}

function entityHalfSize(entity: Entity): Vec3 {
  const scale = entity.transform.scale.map((value) => Math.max(0.05, Math.abs(value))) as Vec3;
  if (entity.type === 'character') return [0.42 * scale[0], 0.95 * scale[1], 0.42 * scale[2]];
  return [0.5 * scale[0], 0.5 * scale[1], 0.5 * scale[2]];
}

function isPrimarySubject(entity: Entity): boolean {
  if (!entity.visible || entity.type === 'camera' || entity.type === 'light') return false;
  if (entity.type === 'character') return true;
  const category = entity.asset?.category;
  return entity.asset?.source !== 'preset' || (category !== 'environment' && category !== 'architecture');
}

/**
 * Computes a predictable free-view camera frame.
 * The editor's humanoids face -Z, so the camera is intentionally placed on
 * the -Z side and looks toward +Z. Environment back walls normally live on
 * +Z and therefore remain behind the subjects instead of covering them.
 */
export function computeFrontViewFrame(entities: Entity[]): ViewFrame {
  const visible = entities.filter((entity) => entity.visible && entity.type !== 'camera' && entity.type !== 'light');
  const primary = visible.filter(isPrimarySubject);
  const framed = primary.length > 0 ? primary : visible;

  if (framed.length === 0) {
    return { position: [0, 2.4, -7], target: [0, 1, 0], distance: 7 };
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const entity of framed) {
    const half = entityHalfSize(entity);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], entity.transform.position[axis] - half[axis]);
      max[axis] = Math.max(max[axis], entity.transform.position[axis] + half[axis]);
    }
  }

  const width = Math.max(1, max[0] - min[0]);
  const height = Math.max(1.8, max[1] - min[1]);
  const depth = Math.max(1, max[2] - min[2]);
  const target: Vec3 = [
    (min[0] + max[0]) / 2,
    Math.max(0.9, min[1] + height * 0.52),
    (min[2] + max[2]) / 2,
  ];
  const distance = Math.max(5.5, width * 1.15, height * 1.65, depth + 4.5);

  return {
    target,
    distance,
    position: [target[0], target[1] + Math.min(1.1, height * 0.18), target[2] - distance],
  };
}
