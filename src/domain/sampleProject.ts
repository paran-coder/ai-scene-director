import { createNeutralPose } from './pose.ts';
import type { Project } from './types.ts';

export const sampleProject: Project = {
  id: 'project-001',
  schemaVersion: '0.8.0',
  name: '카페 대화 장면',
  revision: 1,
  activeSceneId: 'scene-001',
  scenes: [
    {
      id: 'scene-001',
      name: '카페 내부',
      entities: [
        {
          id: 'character-a',
          name: '지윤',
          type: 'character',
          transform: { position: [-1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          visible: true,
          locked: false,
          character: { pose: createNeutralPose() },
        },
        {
          id: 'character-b',
          name: '민수',
          type: 'character',
          transform: { position: [1, 0, 0], rotation: [0, Math.PI, 0], scale: [1, 1, 1] },
          visible: true,
          locked: false,
          character: { pose: createNeutralPose() },
        },
        {
          id: 'table',
          name: '테이블',
          type: 'prop',
          transform: { position: [0, 0.4, 0], rotation: [0, 0, 0], scale: [2.2, 0.8, 1.2] },
          visible: true,
          locked: false,
        },
        {
          id: 'chair-01',
          name: '의자',
          type: 'prop',
          transform: { position: [-1, 0.45, 0.75], rotation: [0, 0, 0], scale: [0.9, 0.9, 0.9] },
          visible: true,
          locked: false,
        },
        {
          id: 'coffee-cup',
          name: '커피 컵',
          type: 'prop',
          transform: { position: [0, 1.0, 0], rotation: [0, 0, 0], scale: [0.22, 0.3, 0.22] },
          visible: true,
          locked: false,
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
