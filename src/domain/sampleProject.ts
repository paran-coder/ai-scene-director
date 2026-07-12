import { createNeutralPose } from './pose.ts';
import type { Project } from './types.ts';

export const sampleProject: Project = {
  id: 'project-001',
  schemaVersion: '0.10.0',
  name: '카페 대화 장면',
  revision: 1,
  activeSceneId: 'scene-001',
  assetLibrary: [],
  scenes: [
    {
      id: 'scene-001',
      name: '카페 내부',
      environment: { presetId: 'cafe-interior', name: '카페 내부', location: '카페 내부', backgroundColor: '#2b2118', floorColor: '#6b4f36', palette: ['#2b2118', '#6b4f36', '#d6b58a', '#f5e6cf'], atmosphere: ['따뜻한'] },
      entities: [
        {
          id: 'character-a',
          name: '지윤',
          type: 'character',
          transform: { position: [-1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          visible: true,
          locked: false,
          character: { pose: createNeutralPose(), appearance: { role: 'lead', descriptor: '지윤', ageGroup: 'adult', presentation: 'feminine', outfitSummary: '검은 코트', outfitColors: ['#111827'], hairColor: '#1c1917', skinTone: '#d6a77a' } },
          asset: { category: 'generic', primitive: 'box', color: '#111827', material: 'matte', source: 'manual', tags: ['character', 'lead'] },
        },
        {
          id: 'character-b',
          name: '민수',
          type: 'character',
          transform: { position: [1, 0, 0], rotation: [0, Math.PI, 0], scale: [1, 1, 1] },
          visible: true,
          locked: false,
          character: { pose: createNeutralPose(), appearance: { role: 'supporting', descriptor: '민수', ageGroup: 'adult', presentation: 'masculine', outfitSummary: '회색 재킷', outfitColors: ['#64748b'], hairColor: '#1c1917', skinTone: '#d6a77a' } },
          asset: { category: 'generic', primitive: 'box', color: '#64748b', material: 'matte', source: 'manual', tags: ['character', 'supporting'] },
        },
        {
          id: 'table',
          name: '테이블',
          type: 'prop',
          transform: { position: [0, 0.4, 0], rotation: [0, 0, 0], scale: [2.2, 0.8, 1.2] },
          visible: true,
          locked: false,
          asset: { presetId: 'cafe-interior:cafe-table', category: 'furniture', primitive: 'box', color: '#7c5137', material: 'matte', source: 'preset', tags: ['table'] },
        },
        {
          id: 'chair-01',
          name: '의자',
          type: 'prop',
          transform: { position: [-1, 0.45, 0.75], rotation: [0, 0, 0], scale: [0.9, 0.9, 0.9] },
          visible: true,
          locked: false,
          asset: { category: 'furniture', primitive: 'box', color: '#8b6f47', material: 'matte', source: 'manual', tags: ['chair'] },
        },
        {
          id: 'coffee-cup',
          name: '커피 컵',
          type: 'prop',
          transform: { position: [0, 1.0, 0], rotation: [0, 0, 0], scale: [0.22, 0.3, 0.22] },
          visible: true,
          locked: false,
          asset: { category: 'handheld', primitive: 'cylinder', color: '#f8fafc', material: 'matte', source: 'manual', tags: ['cup'] },
        },
        {
          id: 'camera-wide',
          name: '와이드 카메라',
          type: 'camera',
          transform: { position: [0, 2.5, 8], rotation: [-0.2, 0, 0], scale: [1, 1, 1] },
          visible: true,
          locked: false,
        },
      ],
      shots: [
        { id: 'shot-001', name: '와이드 샷', order: 1, duration: 4, cameraEntityId: 'camera-wide', overrides: [], relationships: [], actions: [], generationResults: [] },
        { id: 'shot-002', name: '지윤 클로즈업', order: 2, duration: 3, cameraEntityId: 'camera-wide', overrides: [], relationships: [], actions: [], generationResults: [] },
      ],
    },
  ],
};
