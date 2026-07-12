import type { AssetCategory, AssetPrimitive, Entity, EntityAssetData, SceneEnvironment, Vec3 } from './types.ts';

export interface EnvironmentPresetProp {
  id: string;
  name: string;
  category: AssetCategory;
  primitive: AssetPrimitive;
  position: Vec3;
  rotation?: Vec3;
  scale: Vec3;
  color: string;
  material?: EntityAssetData['material'];
  locked?: boolean;
}

export interface EnvironmentPreset {
  id: string;
  name: string;
  keywords: string[];
  locationLabel: string;
  backgroundColor: string;
  floorColor: string;
  palette: string[];
  props: EnvironmentPresetProp[];
}

const box = (
  id: string,
  name: string,
  category: AssetCategory,
  position: Vec3,
  scale: Vec3,
  color: string,
  locked = true,
): EnvironmentPresetProp => ({ id, name, category, primitive: 'box', position, scale, color, locked });

const cylinder = (
  id: string,
  name: string,
  category: AssetCategory,
  position: Vec3,
  scale: Vec3,
  color: string,
  locked = false,
): EnvironmentPresetProp => ({ id, name, category, primitive: 'cylinder', position, scale, color, locked });

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'convenience-exterior',
    name: '편의점 외부',
    keywords: ['편의점 앞', '편의점'],
    locationLabel: '편의점 앞',
    backgroundColor: '#111827',
    floorColor: '#334155',
    palette: ['#111827', '#1e3a8a', '#22d3ee', '#f8fafc'],
    props: [
      box('sidewalk', '젖은 보도', 'environment', [0, -0.08, 0.5], [12, 0.16, 8], '#334155'),
      box('storefront', '편의점 외벽', 'architecture', [0, 2.3, 3.2], [8.5, 4.6, 0.35], '#e2e8f0'),
      box('store-window', '편의점 유리창', 'architecture', [-1.7, 2.1, 3.0], [3.8, 2.6, 0.12], '#67e8f9'),
      box('store-door', '편의점 출입문', 'architecture', [2.3, 1.45, 2.98], [1.45, 2.9, 0.16], '#0f172a'),
      box('store-sign', '편의점 네온 간판', 'decor', [0, 4.15, 2.9], [5.6, 0.65, 0.18], '#22d3ee'),
      cylinder('street-light', '가로등', 'lighting', [-4.2, 2.4, 0.2], [0.18, 4.8, 0.18], '#475569', true),
    ],
  },
  {
    id: 'cafe-interior',
    name: '카페 내부',
    keywords: ['카페 내부', '카페'],
    locationLabel: '카페 내부',
    backgroundColor: '#2b2118',
    floorColor: '#6b4f36',
    palette: ['#2b2118', '#6b4f36', '#d6b58a', '#f5e6cf'],
    props: [
      box('cafe-floor', '카페 바닥', 'environment', [0, -0.08, 0.5], [11, 0.16, 9], '#6b4f36'),
      box('cafe-wall', '카페 뒷벽', 'architecture', [0, 2.3, 3.7], [10, 4.6, 0.3], '#c4a484'),
      box('cafe-counter', '카페 카운터', 'furniture', [-3.6, 0.65, 2.4], [2.6, 1.3, 1.2], '#5c3d2e'),
      box('cafe-table', '카페 테이블', 'furniture', [0, 0.4, 0.4], [2.2, 0.8, 1.2], '#7c5137', false),
      box('cafe-chair-a', '카페 의자 1', 'furniture', [-1, 0.45, 1.15], [0.85, 0.9, 0.85], '#8b6f47', false),
      box('cafe-chair-b', '카페 의자 2', 'furniture', [1, 0.45, 1.15], [0.85, 0.9, 0.85], '#8b6f47', false),
      box('cafe-window', '카페 창문', 'architecture', [3.25, 2.2, 3.5], [2.4, 2.8, 0.12], '#bfdbfe'),
    ],
  },
  {
    id: 'street-night',
    name: '도심 거리',
    keywords: ['거리', '골목', '주차장'],
    locationLabel: '도심 거리',
    backgroundColor: '#0f172a',
    floorColor: '#374151',
    palette: ['#0f172a', '#374151', '#f97316', '#3b82f6'],
    props: [
      box('street-ground', '아스팔트', 'environment', [0, -0.08, 0.5], [14, 0.16, 10], '#374151'),
      box('street-building-left', '왼쪽 건물', 'architecture', [-5.4, 3.1, 2.5], [3.5, 6.2, 2.8], '#1f2937'),
      box('street-building-right', '오른쪽 건물', 'architecture', [5.4, 3.1, 2.5], [3.5, 6.2, 2.8], '#273449'),
      box('street-sign', '거리 간판', 'decor', [3.7, 2.7, 0.8], [1.5, 0.55, 0.18], '#f97316'),
      cylinder('street-lamp', '거리 조명 기둥', 'lighting', [-3.8, 2.5, 0.2], [0.18, 5, 0.18], '#64748b', true),
    ],
  },
  {
    id: 'living-room',
    name: '거실',
    keywords: ['거실', '방'],
    locationLabel: '거실',
    backgroundColor: '#ede9df',
    floorColor: '#b79067',
    palette: ['#ede9df', '#b79067', '#64748b', '#f8fafc'],
    props: [
      box('living-floor', '거실 바닥', 'environment', [0, -0.08, 0.5], [10, 0.16, 8], '#b79067'),
      box('living-wall', '거실 벽', 'architecture', [0, 2.3, 3.55], [9.5, 4.6, 0.3], '#ede9df'),
      box('living-sofa', '소파', 'furniture', [0, 0.5, 2.2], [3, 1, 1.1], '#64748b', false),
      box('living-table', '거실 테이블', 'furniture', [0, 0.28, 0.6], [1.8, 0.56, 1], '#8b6f47', false),
      box('living-window', '거실 창문', 'architecture', [3, 2.25, 3.35], [2.2, 2.8, 0.12], '#bfdbfe'),
      cylinder('living-lamp', '플로어 램프', 'lighting', [-3, 1.2, 2.5], [0.28, 2.4, 0.28], '#facc15', false),
    ],
  },
  {
    id: 'office',
    name: '사무실',
    keywords: ['사무실'],
    locationLabel: '사무실',
    backgroundColor: '#e5e7eb',
    floorColor: '#6b7280',
    palette: ['#e5e7eb', '#6b7280', '#0f172a', '#3b82f6'],
    props: [
      box('office-floor', '사무실 바닥', 'environment', [0, -0.08, 0.5], [11, 0.16, 9], '#6b7280'),
      box('office-wall', '사무실 벽', 'architecture', [0, 2.4, 3.7], [10, 4.8, 0.3], '#e5e7eb'),
      box('office-desk-a', '업무 책상 1', 'furniture', [-1.7, 0.4, 0.6], [2.1, 0.8, 1.1], '#9ca3af', false),
      box('office-desk-b', '업무 책상 2', 'furniture', [1.7, 0.4, 0.6], [2.1, 0.8, 1.1], '#9ca3af', false),
      box('office-chair-a', '업무 의자 1', 'furniture', [-1.7, 0.5, 1.6], [0.8, 1, 0.8], '#111827', false),
      box('office-chair-b', '업무 의자 2', 'furniture', [1.7, 0.5, 1.6], [0.8, 1, 0.8], '#111827', false),
      box('office-board', '회의 보드', 'decor', [0, 2.5, 3.5], [3.5, 1.8, 0.12], '#f8fafc'),
    ],
  },
  {
    id: 'classroom',
    name: '교실',
    keywords: ['교실', '학교'],
    locationLabel: '교실',
    backgroundColor: '#dbeafe',
    floorColor: '#a78b6d',
    palette: ['#dbeafe', '#a78b6d', '#14532d', '#f8fafc'],
    props: [
      box('classroom-floor', '교실 바닥', 'environment', [0, -0.08, 0.8], [12, 0.16, 10], '#a78b6d'),
      box('classroom-wall', '교실 벽', 'architecture', [0, 2.4, 4.1], [11, 4.8, 0.3], '#dbeafe'),
      box('classroom-board', '칠판', 'decor', [0, 2.5, 3.9], [5, 1.8, 0.12], '#14532d'),
      box('student-desk-a', '학생 책상 1', 'furniture', [-1.5, 0.4, 0.7], [1.4, 0.8, 0.9], '#c4a484', false),
      box('student-desk-b', '학생 책상 2', 'furniture', [1.5, 0.4, 0.7], [1.4, 0.8, 0.9], '#c4a484', false),
      box('student-chair-a', '학생 의자 1', 'furniture', [-1.5, 0.45, 1.5], [0.75, 0.9, 0.75], '#8b6f47', false),
      box('student-chair-b', '학생 의자 2', 'furniture', [1.5, 0.45, 1.5], [0.75, 0.9, 0.75], '#8b6f47', false),
    ],
  },
  {
    id: 'kitchen',
    name: '부엌',
    keywords: ['부엌', '식당'],
    locationLabel: '부엌·식당',
    backgroundColor: '#f3f4f6',
    floorColor: '#9ca3af',
    palette: ['#f3f4f6', '#9ca3af', '#d97706', '#fef3c7'],
    props: [
      box('kitchen-floor', '부엌 바닥', 'environment', [0, -0.08, 0.5], [10, 0.16, 8], '#9ca3af'),
      box('kitchen-wall', '부엌 벽', 'architecture', [0, 2.3, 3.6], [9.5, 4.6, 0.3], '#f3f4f6'),
      box('kitchen-counter', '조리대', 'furniture', [-3.2, 0.55, 2.6], [3, 1.1, 1.1], '#d1d5db', false),
      box('dining-table', '식탁', 'furniture', [0, 0.4, 0.6], [2.4, 0.8, 1.3], '#b45309', false),
      box('dining-chair-a', '식탁 의자 1', 'furniture', [-1, 0.45, 1.5], [0.8, 0.9, 0.8], '#92400e', false),
      box('dining-chair-b', '식탁 의자 2', 'furniture', [1, 0.45, 1.5], [0.8, 0.9, 0.8], '#92400e', false),
    ],
  },
  {
    id: 'studio',
    name: '기본 스튜디오',
    keywords: ['스튜디오', '기본 스튜디오'],
    locationLabel: '기본 스튜디오',
    backgroundColor: '#1f2937',
    floorColor: '#4b5563',
    palette: ['#1f2937', '#4b5563', '#94a3b8', '#f8fafc'],
    props: [
      box('studio-floor', '스튜디오 바닥', 'environment', [0, -0.08, 0.5], [11, 0.16, 9], '#4b5563'),
      box('studio-backdrop', '스튜디오 배경', 'architecture', [0, 2.4, 3.7], [9, 4.8, 0.28], '#1f2937'),
      box('studio-platform', '촬영 플랫폼', 'furniture', [0, 0.12, 0.3], [4, 0.24, 3], '#64748b', false),
    ],
  },
];

export function resolveEnvironmentPreset(location: string): EnvironmentPreset {
  return ENVIRONMENT_PRESETS.find((preset) => preset.keywords.some((keyword) => location.includes(keyword)))
    ?? ENVIRONMENT_PRESETS[ENVIRONMENT_PRESETS.length - 1];
}

export function createEnvironmentState(preset: EnvironmentPreset, atmosphere: string[]): SceneEnvironment {
  return {
    presetId: preset.id,
    name: preset.name,
    location: preset.locationLabel,
    backgroundColor: preset.backgroundColor,
    floorColor: preset.floorColor,
    palette: [...preset.palette],
    atmosphere: [...atmosphere],
  };
}

export function createPresetEntities(preset: EnvironmentPreset): Entity[] {
  return preset.props.map((prop, index) => ({
    id: `preset-${preset.id}-${prop.id}-${index + 1}`,
    name: prop.name,
    type: 'prop',
    transform: {
      position: [...prop.position],
      rotation: prop.rotation ? [...prop.rotation] : [0, 0, 0],
      scale: [...prop.scale],
    },
    visible: true,
    locked: prop.locked ?? true,
    asset: {
      presetId: `${preset.id}:${prop.id}`,
      category: prop.category,
      primitive: prop.primitive,
      color: prop.color,
      material: prop.material ?? 'matte',
      source: 'preset',
      tags: [preset.id, prop.id, prop.category],
    },
  }));
}
