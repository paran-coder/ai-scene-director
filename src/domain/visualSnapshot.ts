import { resolveSceneAtTime } from './resolver.ts';
import type { Entity, Scene, Shot } from './types.ts';

export interface VisualSnapshot {
  width: number;
  height: number;
  svg: string;
  signature: string;
  entityCount: number;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;',
  }[character] ?? character));
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalEntity(entity: Entity) {
  return {
    id: entity.id,
    type: entity.type,
    visible: entity.visible,
    position: entity.transform.position.map((value) => Number(value.toFixed(4))),
    rotation: entity.transform.rotation.map((value) => Number(value.toFixed(4))),
    scale: entity.transform.scale.map((value) => Number(value.toFixed(4))),
    color: entity.asset?.color ?? '#94a3b8',
    modelAssetId: entity.asset?.modelAssetId ?? null,
    pose: entity.character?.pose ?? null,
    camera: entity.camera ?? null,
    light: entity.light ?? null,
  };
}

function entityShape(entity: Entity, x: number, y: number, scale: number): string {
  const color = entity.asset?.color ?? (entity.type === 'character' ? '#60a5fa' : '#a8a29e');
  const name = escapeXml(entity.name);
  if (entity.type === 'character') {
    return `<g data-entity="${escapeXml(entity.id)}"><circle cx="${x}" cy="${y - 9 * scale}" r="${4 * scale}" fill="${color}"/><rect x="${x - 4 * scale}" y="${y - 5 * scale}" width="${8 * scale}" height="${12 * scale}" rx="${2 * scale}" fill="${color}"/><text x="${x}" y="${y + 16 * scale}" text-anchor="middle">${name}</text></g>`;
  }
  if (entity.type === 'camera') {
    const rotation = (-entity.transform.rotation[1] * 180) / Math.PI;
    return `<g data-entity="${escapeXml(entity.id)}" transform="translate(${x} ${y}) rotate(${rotation})"><path d="M -8 -6 L 5 -6 L 5 -10 L 12 -6 L 12 6 L 5 2 L 5 6 L -8 6 Z" fill="${color}"/><path d="M 12 0 L 32 -12 L 32 12 Z" fill="${color}" opacity="0.16"/><text x="0" y="20" text-anchor="middle" transform="rotate(${-rotation})">${name}</text></g>`;
  }
  if (entity.type === 'light') {
    return `<g data-entity="${escapeXml(entity.id)}"><circle cx="${x}" cy="${y}" r="${7 * scale}" fill="${color}"/><path d="M ${x - 12 * scale} ${y} H ${x + 12 * scale} M ${x} ${y - 12 * scale} V ${y + 12 * scale}" stroke="${color}" stroke-width="${2 * scale}"/><text x="${x}" y="${y + 20 * scale}" text-anchor="middle">${name}</text></g>`;
  }
  const width = Math.max(8, Math.abs(entity.transform.scale[0]) * 12) * scale;
  const depth = Math.max(8, Math.abs(entity.transform.scale[2]) * 12) * scale;
  const rotation = (-entity.transform.rotation[1] * 180) / Math.PI;
  return `<g data-entity="${escapeXml(entity.id)}" transform="translate(${x} ${y}) rotate(${rotation})"><rect x="${-width / 2}" y="${-depth / 2}" width="${width}" height="${depth}" rx="2" fill="${color}"/><text x="0" y="${depth / 2 + 12}" text-anchor="middle" transform="rotate(${-rotation})">${name}</text></g>`;
}

export function buildVisualSnapshot(scene: Scene, shot: Shot, time = 0, width = 640, height = 360): VisualSnapshot {
  const entities = resolveSceneAtTime(scene, shot, time).filter((entity) => entity.visible);
  const canonical = entities.map(canonicalEntity).sort((a, b) => a.id.localeCompare(b.id));
  const signature = hashString(JSON.stringify({
    sceneId: scene.id,
    shotId: shot.id,
    time: Number(time.toFixed(4)),
    environment: scene.environment,
    entities: canonical,
  }));

  const positions = entities.map((entity) => ({ x: entity.transform.position[0], z: entity.transform.position[2] }));
  const minX = Math.min(-2, ...positions.map((position) => position.x));
  const maxX = Math.max(2, ...positions.map((position) => position.x));
  const minZ = Math.min(-2, ...positions.map((position) => position.z));
  const maxZ = Math.max(2, ...positions.map((position) => position.z));
  const rangeX = Math.max(1, maxX - minX);
  const rangeZ = Math.max(1, maxZ - minZ);
  const margin = 34;
  const scale = Math.min((width - margin * 2) / rangeX, (height - margin * 2) / rangeZ);
  const projectPoint = (entity: Entity) => ({
    x: margin + (entity.transform.position[0] - minX) * scale,
    y: height - margin - (entity.transform.position[2] - minZ) * scale,
  });

  const relationLines = shot.relationships
    .filter((relationship) => relationship.active)
    .map((relationship) => {
      const source = entities.find((entity) => entity.id === relationship.sourceEntityId);
      const target = entities.find((entity) => entity.id === relationship.targetEntityId);
      if (!source || !target) return '';
      const a = projectPoint(source);
      const b = projectPoint(target);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.7"/>`;
    }).join('');

  const shapes = entities
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entity) => {
      const point = projectPoint(entity);
      return entityShape(entity, point.x, point.y, Math.max(0.7, Math.min(1.5, scale / 30)));
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${escapeXml(scene.environment.backgroundColor || '#0f172a')}"/>
  <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#ffffff" stroke-opacity="0.08"/></pattern></defs>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <g font-family="system-ui, sans-serif" font-size="10" fill="#f8fafc">${relationLines}${shapes}</g>
  <g font-family="system-ui, sans-serif"><text x="16" y="22" fill="#f8fafc" font-size="13" font-weight="700">${escapeXml(scene.name)} · ${escapeXml(shot.name)}</text><text x="${width - 16}" y="22" text-anchor="end" fill="#94a3b8" font-size="10">visual ${signature}</text></g>
</svg>`;

  return { width, height, svg, signature, entityCount: entities.length };
}
