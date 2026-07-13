import { ACTION_LABELS } from './actions.ts';
import { describeRelationship } from './relationships.ts';
import { resolveSceneAtTime } from './resolver.ts';
import type { Entity, Project, Scene, Shot } from './types.ts';

export interface ShotPackageManifest {
  schemaVersion: '1.0.0-rc.11';
  generatedAt: string;
  project: { id: string; name: string; revision: number };
  scene: { id: string; name: string; environment: Scene['environment']; referenceImages: Array<Omit<Scene['referenceImages'][number], 'dataUrl'>> };
  shot: {
    id: string;
    name: string;
    duration: number;
    cameraEntityId: string;
  };
  camera: {
    id: string;
    name: string;
    startTransform: Entity['transform'];
    endTransform: Entity['transform'];
    settings?: Entity['camera'];
  } | null;
  entities: Array<{
    id: string;
    name: string;
    type: Entity['type'];
    asset?: Entity['asset'];
    characterAppearance?: NonNullable<Entity['character']>['appearance'];
    maskColor: string;
    start: { transform: Entity['transform']; visible: boolean };
    end: { transform: Entity['transform']; visible: boolean };
  }>;
  relationships: Shot['relationships'];
  actions: Shot['actions'];
  files: Record<string, string>;
}

export function entityMaskColor(id: string): string {
  let hash = 2166136261;
  for (const char of id) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 82%, 55%)`;
}

export function buildShotPrompt(scene: Scene, shot: Shot): string {
  const start = resolveSceneAtTime(scene, shot, 0).filter((entity) => entity.visible && entity.type !== 'camera' && entity.type !== 'light');
  const characters = start.filter((entity) => entity.type === 'character').map((entity) => {
    const appearance = entity.character?.appearance;
    return appearance ? `${entity.name}(${appearance.role}, ${appearance.outfitSummary})` : entity.name;
  });
  const props = start.filter((entity) => entity.type === 'prop' && entity.asset?.category !== 'environment' && entity.asset?.category !== 'architecture').map((entity) => entity.name);
  const environmentAssets = start.filter((entity) => entity.type === 'prop' && (entity.asset?.category === 'environment' || entity.asset?.category === 'architecture')).map((entity) => entity.name);
  const relationships = shot.relationships
    .filter((relationship) => relationship.active)
    .map((relationship) => describeRelationship(relationship, scene.entities));

  const parts = [
    `장면: ${scene.name}. 배경 프리셋: ${scene.environment?.name ?? '미지정'}, 장소: ${scene.environment?.location ?? scene.name}, 분위기: ${(scene.environment?.atmosphere ?? []).join(', ') || '기본'}.`,
    characters.length ? `등장인물: ${characters.join(', ')}.` : '',
    environmentAssets.length ? `배경 구조: ${environmentAssets.join(', ')}.` : '',
    props.length ? `주요 소품: ${props.join(', ')}.` : '',
    relationships.length ? `객체 관계: ${relationships.join('; ')}.` : '',
    `카메라 구도는 3D 샷 카메라와 시작 프레임의 구도를 정확히 유지한다.`,
    `인물 수, 앞뒤 배치, 시선, 손과 소품의 접촉 관계를 유지한다.`,
  ];
  return parts.filter(Boolean).join(' ');
}

export function buildMotionPrompt(scene: Scene, shot: Shot): string {
  if (!shot.actions.length) return '카메라와 인물은 정적인 상태를 유지한다.';
  return shot.actions
    .filter((action) => action.enabled)
    .sort((a, b) => a.startTime - b.startTime)
    .map((action) => {
      const actor = scene.entities.find((entity) => entity.id === action.actorEntityId)?.name ?? action.actorEntityId;
      const target = action.targetEntityId
        ? scene.entities.find((entity) => entity.id === action.targetEntityId)?.name ?? action.targetEntityId
        : undefined;
      return `${action.startTime.toFixed(1)}초부터 ${action.duration.toFixed(1)}초 동안 ${actor}: ${ACTION_LABELS[action.type]}${target ? `, 대상 ${target}` : ''}`;
    })
    .join('. ') + '.';
}

export function buildCameraPrompt(scene: Scene, shot: Shot): string {
  const camera = scene.entities.find((entity) => entity.id === shot.cameraEntityId);
  const cameraActions = shot.actions.filter((action) => action.actorEntityId === shot.cameraEntityId && action.enabled);
  const actionText = cameraActions.length
    ? cameraActions.map((action) => `${ACTION_LABELS[action.type]} ${action.duration.toFixed(1)}초`).join(', ')
    : '고정 카메라';
  return `${camera?.name ?? '샷 카메라'}를 사용한다. 위치 ${camera?.transform.position.join(', ') ?? '미지정'}, 회전 ${camera?.transform.rotation.join(', ') ?? '미지정'}. ${actionText}. 시작·종료 프레임의 화면 구도를 우선한다.`;
}

export const DEFAULT_NEGATIVE_PROMPT = [
  '인물 수 변경',
  '중복 인물',
  '사라진 소품',
  '잘못된 손가락',
  '분리된 손과 소품',
  '왜곡된 관절',
  '카메라 구도 변경',
  '배경 구조 변경',
  '프레임 밖 잘린 주요 인물',
].join(', ');

export function buildShotPackageManifest(project: Project, scene: Scene, shot: Shot): ShotPackageManifest {
  const start = resolveSceneAtTime(scene, shot, 0);
  const end = resolveSceneAtTime(scene, shot, shot.duration);
  const cameraStart = start.find((entity) => entity.id === shot.cameraEntityId);
  const cameraEnd = end.find((entity) => entity.id === shot.cameraEntityId);
  const endMap = new Map(end.map((entity) => [entity.id, entity]));

  return {
    schemaVersion: '1.0.0-rc.11',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, name: project.name, revision: project.revision },
    scene: { id: scene.id, name: scene.name, environment: structuredClone(scene.environment), referenceImages: (scene.referenceImages ?? []).map(({ dataUrl: _dataUrl, ...image }) => structuredClone(image)) },
    shot: {
      id: shot.id,
      name: shot.name,
      duration: shot.duration,
      cameraEntityId: shot.cameraEntityId,
    },
    camera: cameraStart && cameraEnd ? {
      id: cameraStart.id,
      name: cameraStart.name,
      startTransform: structuredClone(cameraStart.transform),
      endTransform: structuredClone(cameraEnd.transform),
      settings: cameraStart.camera ? structuredClone(cameraStart.camera) : undefined,
    } : null,
    entities: start
      .filter((entity) => entity.type !== 'camera' && entity.type !== 'light')
      .map((entity) => {
        const final = endMap.get(entity.id) ?? entity;
        return {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          asset: entity.asset ? structuredClone(entity.asset) : undefined,
          characterAppearance: entity.character?.appearance ? structuredClone(entity.character.appearance) : undefined,
          maskColor: entityMaskColor(entity.id),
          start: { transform: structuredClone(entity.transform), visible: entity.visible },
          end: { transform: structuredClone(final.transform), visible: final.visible },
        };
      }),
    relationships: structuredClone(shot.relationships),
    actions: structuredClone(shot.actions),
    files: {
      startFrame: 'frames/start_frame.png',
      endFrame: 'frames/end_frame.png',
      poseStart: 'controls/pose_start.png',
      poseEnd: 'controls/pose_end.png',
      depthStart: 'controls/depth_start.png',
      depthEnd: 'controls/depth_end.png',
      maskStart: 'controls/entity_mask_start.png',
      maskEnd: 'controls/entity_mask_end.png',
      scenePrompt: 'prompts/scene_prompt.txt',
      motionPrompt: 'prompts/motion_prompt.txt',
      cameraPrompt: 'prompts/camera_prompt.txt',
      negativePrompt: 'prompts/negative_prompt.txt',
    },
  };
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

export interface ZipInput {
  name: string;
  data: Blob | Uint8Array | string;
}

async function toBytes(data: ZipInput['data']): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

export async function createStoredZip(inputs: ZipInput[]): Promise<Blob> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const timestamp = dosDateTime(new Date());

  for (const input of inputs) {
    const name = new TextEncoder().encode(input.name.replaceAll('\\', '/'));
    const data = await toBytes(input.data);
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, timestamp.time);
    writeUint16(localView, 12, timestamp.date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, name.length);
    writeUint16(localView, 28, 0);
    localParts.push(localHeader, name, data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, timestamp.time);
    writeUint16(centralView, 14, timestamp.date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, name.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + data.length;
  }

  const local = concat(localParts);
  const central = concat(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, inputs.length);
  writeUint16(endView, 10, inputs.length);
  writeUint32(endView, 12, central.length);
  writeUint32(endView, 16, local.length);
  writeUint16(endView, 20, 0);

  const archive = concat([local, central, end]);
  const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]/g, '-').replaceAll(/\s+/g, '_');
}
