import { ACTION_LABELS } from './actions.ts';
import { describeRelationship } from './relationships.ts';
import { resolveSceneAtTime } from './resolver.ts';
import { CURRENT_SCHEMA_VERSION, type Entity, type Project, type Scene, type Shot } from './types.ts';

export type AIExportArchiveMode = 'image' | 'video';

export const AI_EXPORT_FILE_PATHS: Record<AIExportArchiveMode, readonly string[]> = {
  image: [
    'frames/reference.png',
    'controls/pose.png',
    'controls/depth.png',
    'controls/entity_mask.png',
    'prompts/final_prompt.txt',
    'prompts/scene_prompt.txt',
    'prompts/camera_prompt.txt',
    'prompts/negative_prompt.txt',
    'shot_manifest.json',
    '사용법.txt',
  ],
  video: [
    'frames/start_frame.png',
    'frames/end_frame.png',
    'controls/pose_start.png',
    'controls/pose_end.png',
    'controls/depth_start.png',
    'controls/depth_end.png',
    'controls/entity_mask_start.png',
    'controls/entity_mask_end.png',
    'prompts/final_prompt.txt',
    'prompts/scene_prompt.txt',
    'prompts/motion_prompt.txt',
    'prompts/camera_prompt.txt',
    'prompts/negative_prompt.txt',
    'shot_manifest.json',
    '사용법.txt',
  ],
};

export interface ShotPackageManifest {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  aiExportMode: AIExportArchiveMode;
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

export function buildShotPackageManifest(project: Project, scene: Scene, shot: Shot, mode: AIExportArchiveMode = 'video'): ShotPackageManifest {
  const start = resolveSceneAtTime(scene, shot, 0);
  const end = resolveSceneAtTime(scene, shot, shot.duration);
  const cameraStart = start.find((entity) => entity.id === shot.cameraEntityId);
  const cameraEnd = end.find((entity) => entity.id === shot.cameraEntityId);
  const endMap = new Map(end.map((entity) => [entity.id, entity]));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    aiExportMode: mode,
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
    files: mode === 'image' ? {
      referenceFrame: 'frames/reference.png',
      pose: 'controls/pose.png',
      depth: 'controls/depth.png',
      mask: 'controls/entity_mask.png',
      finalPrompt: 'prompts/final_prompt.txt',
      scenePrompt: 'prompts/scene_prompt.txt',
      cameraPrompt: 'prompts/camera_prompt.txt',
      negativePrompt: 'prompts/negative_prompt.txt',
      guide: '사용법.txt',
    } : {
      startFrame: 'frames/start_frame.png',
      endFrame: 'frames/end_frame.png',
      poseStart: 'controls/pose_start.png',
      poseEnd: 'controls/pose_end.png',
      depthStart: 'controls/depth_start.png',
      depthEnd: 'controls/depth_end.png',
      maskStart: 'controls/entity_mask_start.png',
      maskEnd: 'controls/entity_mask_end.png',
      finalPrompt: 'prompts/final_prompt.txt',
      scenePrompt: 'prompts/scene_prompt.txt',
      motionPrompt: 'prompts/motion_prompt.txt',
      cameraPrompt: 'prompts/camera_prompt.txt',
      negativePrompt: 'prompts/negative_prompt.txt',
      guide: '사용법.txt',
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

function normalizeZipPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').trim();
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`안전하지 않은 ZIP 경로입니다: ${value || '(빈 경로)'}`);
  }
  return normalized;
}

export async function createStoredZip(inputs: ZipInput[]): Promise<Blob> {
  if (!inputs.length) throw new Error('ZIP에 포함할 파일이 없습니다.');
  if (inputs.length > 0xffff) throw new Error('ZIP 파일 수가 지원 범위를 초과했습니다.');
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const timestamp = dosDateTime(new Date());
  const seenNames = new Set<string>();

  for (const input of inputs) {
    const normalizedName = normalizeZipPath(input.name);
    if (seenNames.has(normalizedName)) throw new Error(`ZIP에 중복 파일 경로가 있습니다: ${normalizedName}`);
    seenNames.add(normalizedName);
    const name = new TextEncoder().encode(normalizedName);
    if (name.length > 0xffff) throw new Error(`ZIP 파일명이 너무 깁니다: ${normalizedName}`);
    const data = await toBytes(input.data);
    if (data.length > 0xffffffff) throw new Error(`ZIP 파일 크기가 지원 범위를 초과했습니다: ${normalizedName}`);
    const checksum = crc32(data);
    const entrySize = 30 + name.length + data.length;
    if (localOffset + entrySize > 0xffffffff) throw new Error('ZIP 전체 크기가 Stored ZIP 지원 범위를 초과했습니다.');

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

interface StoredZipEntryMeta {
  name: string;
  checksum: number;
  size: number;
  localOffset: number;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minimum = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('ZIP 중앙 디렉터리 종료 레코드가 없습니다.');
}

export async function readStoredZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 22) throw new Error('ZIP 파일이 너무 작거나 손상되었습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  const localEntries = new Map<string, StoredZipEntryMeta>();
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('지원하지 않는 ZIP 구조입니다. AI Scene Director가 만든 ZIP을 사용해 주세요.');
    if (offset + 30 > bytes.length) throw new Error('ZIP 로컬 헤더가 손상되었습니다.');
    const localOffset = offset;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x0001) !== 0) throw new Error('암호화된 ZIP은 지원하지 않습니다.');
    if ((flags & 0x0008) !== 0) throw new Error('데이터 디스크립터 ZIP은 지원하지 않습니다.');
    if (method !== 0) throw new Error('압축된 ZIP은 아직 지원하지 않습니다. 앱에서 내보낸 ZIP을 사용해 주세요.');
    if (compressedSize !== uncompressedSize) throw new Error('Stored ZIP 크기 정보가 올바르지 않습니다.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('ZIP 파일 데이터가 손상되었습니다.');
    const name = normalizeZipPath(new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(nameStart, nameStart + nameLength)));
    if (files.has(name)) throw new Error(`ZIP에 중복 파일 경로가 있습니다: ${name}`);
    const data = bytes.slice(dataStart, dataEnd);
    if (crc32(data) !== checksum) throw new Error(`ZIP 파일 체크섬이 일치하지 않습니다: ${name}`);
    files.set(name, data);
    localEntries.set(name, { name, checksum, size: uncompressedSize, localOffset });
    offset = dataEnd;
  }

  const endOffset = findEndOfCentralDirectory(bytes, view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntryCount = view.getUint16(endOffset + 8, true);
  const totalEntryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== totalEntryCount) throw new Error('다중 디스크 ZIP은 지원하지 않습니다.');
  if (endOffset + 22 + commentLength !== bytes.length) throw new Error('ZIP 종료 레코드 길이가 올바르지 않습니다.');
  if (centralOffset !== offset || centralOffset + centralSize !== endOffset) throw new Error('ZIP 중앙 디렉터리 위치가 올바르지 않습니다.');
  if (totalEntryCount !== files.size) throw new Error('ZIP 파일 수 정보가 일치하지 않습니다.');

  let centralCursor = centralOffset;
  const centralNames = new Set<string>();
  for (let index = 0; index < totalEntryCount; index += 1) {
    if (centralCursor + 46 > endOffset || view.getUint32(centralCursor, true) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리가 손상되었습니다.');
    const flags = view.getUint16(centralCursor + 8, true);
    const method = view.getUint16(centralCursor + 10, true);
    const checksum = view.getUint32(centralCursor + 16, true);
    const compressedSize = view.getUint32(centralCursor + 20, true);
    const uncompressedSize = view.getUint32(centralCursor + 24, true);
    const nameLength = view.getUint16(centralCursor + 28, true);
    const extraLength = view.getUint16(centralCursor + 30, true);
    const fileCommentLength = view.getUint16(centralCursor + 32, true);
    const localOffset = view.getUint32(centralCursor + 42, true);
    const nameStart = centralCursor + 46;
    const next = nameStart + nameLength + extraLength + fileCommentLength;
    if (next > endOffset) throw new Error('ZIP 중앙 디렉터리 항목 길이가 올바르지 않습니다.');
    const name = normalizeZipPath(new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(nameStart, nameStart + nameLength)));
    const local = localEntries.get(name);
    if (!local || centralNames.has(name)) throw new Error(`ZIP 중앙 디렉터리 파일 정보가 일치하지 않습니다: ${name}`);
    if (method !== 0 || compressedSize !== uncompressedSize || checksum !== local.checksum || uncompressedSize !== local.size || localOffset !== local.localOffset || (flags & 0x0008) !== 0) {
      throw new Error(`ZIP 중앙 디렉터리 메타데이터가 일치하지 않습니다: ${name}`);
    }
    centralNames.add(name);
    centralCursor = next;
  }
  if (centralCursor !== endOffset) throw new Error('ZIP 중앙 디렉터리 크기가 일치하지 않습니다.');
  return files;
}

export interface StoredZipVerification {
  fileCount: number;
  byteLength: number;
  files: string[];
}

function verifyExpectedZipEntries(files: Map<string, Uint8Array>, byteLength: number, expectedPaths: readonly string[]): StoredZipVerification {
  const expected = [...expectedPaths].map(normalizeZipPath).sort();
  const actual = [...files.keys()].sort();
  const missing = expected.filter((path) => !files.has(path));
  const unexpected = actual.filter((path) => !expected.includes(path));
  if (missing.length || unexpected.length) {
    throw new Error(`ZIP 파일 구성이 일치하지 않습니다.${missing.length ? ` 누락: ${missing.join(', ')}` : ''}${unexpected.length ? ` 예상 밖: ${unexpected.join(', ')}` : ''}`);
  }
  return { fileCount: files.size, byteLength, files: actual };
}

export async function verifyStoredZipEntries(blob: Blob, expectedPaths: readonly string[]): Promise<StoredZipVerification> {
  const files = await readStoredZip(blob);
  return verifyExpectedZipEntries(files, blob.size, expectedPaths);
}

function verifyPng(bytes: Uint8Array, path: string): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) throw new Error(`${path}가 유효한 PNG가 아닙니다.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = new TextDecoder().decode(bytes.slice(12, 16));
  if (view.getUint32(8, false) !== 13 || chunkType !== 'IHDR' || view.getUint32(16, false) < 1 || view.getUint32(20, false) < 1) {
    throw new Error(`${path}의 PNG 헤더가 올바르지 않습니다.`);
  }
  const tailType = new TextDecoder().decode(bytes.slice(bytes.length - 8, bytes.length - 4));
  if (tailType !== 'IEND') throw new Error(`${path}의 PNG 종료 청크가 없습니다.`);
}

function readRequiredText(files: Map<string, Uint8Array>, path: string): string {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`${path} 파일이 없습니다.`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.trim()) throw new Error(`${path} 파일이 비어 있습니다.`);
  return text;
}

export async function verifyAIExportArchive(blob: Blob, mode: AIExportArchiveMode): Promise<StoredZipVerification> {
  const files = await readStoredZip(blob);
  const result = verifyExpectedZipEntries(files, blob.size, AI_EXPORT_FILE_PATHS[mode]);
  for (const path of result.files.filter((value) => value.endsWith('.png'))) verifyPng(files.get(path)!, path);
  for (const path of result.files.filter((value) => value.endsWith('.txt'))) readRequiredText(files, path);

  let manifest: ShotPackageManifest;
  try {
    manifest = JSON.parse(readRequiredText(files, 'shot_manifest.json')) as ShotPackageManifest;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('shot_manifest.json을 읽지 못했습니다.');
    throw error;
  }
  if (manifest.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error('shot_manifest.json의 스키마 버전이 현재 앱과 일치하지 않습니다.');
  if (manifest.aiExportMode !== mode) throw new Error('shot_manifest.json의 내보내기 모드가 ZIP 구성과 일치하지 않습니다.');
  const manifestPaths = Object.values(manifest.files ?? {});
  const missingReferences = manifestPaths.filter((path) => !files.has(path));
  if (missingReferences.length) throw new Error(`shot_manifest.json이 ZIP에 없는 파일을 참조합니다: ${missingReferences.join(', ')}`);
  const expectedManifestPaths = AI_EXPORT_FILE_PATHS[mode].filter((path) => path !== 'shot_manifest.json').sort();
  const uniqueManifestPaths = [...new Set(manifestPaths)].sort();
  if (manifestPaths.length !== uniqueManifestPaths.length || uniqueManifestPaths.length !== expectedManifestPaths.length || uniqueManifestPaths.some((path, index) => path !== expectedManifestPaths[index])) {
    throw new Error('shot_manifest.json의 파일 목록이 실제 AI 자료 구성과 일치하지 않습니다.');
  }
  return result;
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
