import { Grid, Line, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Box3, Euler, Group, Matrix4, Mesh, MeshBasicMaterial, MeshDepthMaterial, Object3D, PerspectiveCamera, Quaternion, SpotLight, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { entityMaskColor } from '../domain/export';
import { getAssetObjectUrl } from '../domain/assetStorage';
import { createAsyncResourceCache } from '../domain/resourceCache';
import { referenceImageUrl } from '../domain/referenceImages';
import { viewportQualitySettings, type EffectiveRenderQuality } from '../domain/runtimeDiagnostics';
import { computeFrontViewFrame, type ViewFrame } from '../domain/viewFraming';
import type { ReferenceImage } from '../domain/types';
import { calculateAnkleLocalPosition, calculateHandLocalPosition, calculateHumanoidJointLocalPositions, createNeutralPose } from '../domain/pose';
import { applyHumanoidPoseToObject, collectHumanoidJointPositions } from '../domain/rigging';
import { findControllingRelationship } from '../domain/relationships';
import { resolveSceneAtTime } from '../domain/resolver';
import { JOINT_NAMES, type AssetLibraryCategory, type Entity, type JointName, type PoseState, type Relationship, type TransformMode, type Vec3 } from '../domain/types';
import { useEditorStore } from '../store/editorStore';

export type CaptureRenderMode = 'beauty' | 'pose' | 'depth' | 'mask';

export interface ViewportHandle {
  captureFrame(time: number, mode: CaptureRenderMode): Promise<Blob>;
}

interface CaptureRequest {
  id: number;
  time: number;
  mode: CaptureRenderMode;
  resolve(blob: Blob): void;
  reject(error: Error): void;
}

const NAVIGATION_HINT_STORAGE_KEY = 'ai-scene-director.viewport.navigationHintCollapsed';
const VIEWPORT_ASSIST_LIGHT_STORAGE_KEY = 'ai-scene-director.viewport.assistLightEnabled';

function SurfaceMaterial({ color, mode, wireframe = false, emissive = false }: { color: string; mode: CaptureRenderMode; wireframe?: boolean; emissive?: boolean }) {
  if (mode !== 'beauty') return <meshBasicMaterial color={color} wireframe={wireframe} />;
  return <meshStandardMaterial color={color} roughness={0.75} wireframe={wireframe} emissive={emissive ? color : '#000000'} emissiveIntensity={emissive ? 0.7 : 0} />;
}

function Limb({ length, radius, color, mode }: { length: number; radius: number; color: string; mode: CaptureRenderMode }) {
  return (
    <mesh position={[0, -length / 2, 0]} castShadow={mode === 'beauty'}>
      <capsuleGeometry args={[radius, Math.max(0.02, length - radius * 2), 8, 12]} />
      <SurfaceMaterial color={color} mode={mode} />
    </mesh>
  );
}

function JointHandle({ name, selected, onSelect }: { name: JointName; selected: boolean; onSelect(name: JointName): void }) {
  return (
    <mesh
      scale={selected ? 1.35 : 1}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(name);
      }}
    >
      <sphereGeometry args={[0.055, 14, 10]} />
      <meshBasicMaterial color={selected ? '#fb923c' : '#22d3ee'} depthTest={false} />
    </mesh>
  );
}

function Humanoid({
  entity,
  color,
  mode,
  showJoints,
  selectedJoint,
  onSelectJoint,
}: {
  entity: Entity;
  color: string;
  mode: CaptureRenderMode;
  showJoints: boolean;
  selectedJoint: JointName | null;
  onSelectJoint(joint: JointName): void;
}) {
  const pose: PoseState = entity.character?.pose ?? createNeutralPose();
  const appearance = entity.character?.appearance;
  const outfitColor = mode === 'beauty' ? (appearance?.outfitColors[0] ?? color) : color;
  const skinColor = mode === 'beauty' ? (appearance?.skinTone ?? '#d6a77a') : color;
  const hairColor = mode === 'beauty' ? (appearance?.hairColor ?? '#1c1917') : color;
  const handle = (joint: JointName) => showJoints
    ? <JointHandle name={joint} selected={selectedJoint === joint} onSelect={onSelectJoint} />
    : null;

  return (
    <group>
      <group position={[0, 0.9, 0]} rotation={pose.pelvis}>
        {handle('pelvis')}
        <mesh castShadow={mode === 'beauty'}>
          <boxGeometry args={[0.34, 0.22, 0.22]} />
          <SurfaceMaterial color={outfitColor} mode={mode} />
        </mesh>

        <group position={[0, 0.18, 0]} rotation={pose.spine}>
          {handle('spine')}
          <mesh position={[0, 0.1, 0]} castShadow={mode === 'beauty'}>
            <boxGeometry args={[0.38, 0.28, 0.22]} />
            <SurfaceMaterial color={outfitColor} mode={mode} />
          </mesh>

          <group position={[0, 0.25, 0]} rotation={pose.chest}>
            {handle('chest')}
            <mesh position={[0, 0.08, 0]} castShadow={mode === 'beauty'}>
              <boxGeometry args={[0.48, 0.3, 0.25]} />
              <SurfaceMaterial color={outfitColor} mode={mode} />
            </mesh>

            <group position={[0, 0.24, 0]} rotation={pose.neck}>
              {handle('neck')}
              <mesh position={[0, 0.05, 0]} castShadow={mode === 'beauty'}>
                <cylinderGeometry args={[0.07, 0.08, 0.12, 12]} />
                <SurfaceMaterial color={skinColor} mode={mode} />
              </mesh>
              <group position={[0, 0.15, 0]} rotation={pose.head}>
                {handle('head')}
                <mesh position={[0, 0.09, 0]} castShadow={mode === 'beauty'}>
                  <sphereGeometry args={[0.16, 22, 16]} />
                  <SurfaceMaterial color={skinColor} mode={mode} />
                </mesh>
                {mode === 'beauty' && (
                  <mesh position={[0, 0.18, 0]} scale={[1.04, 0.45, 1.04]}>
                    <sphereGeometry args={[0.16, 18, 12]} />
                    <meshStandardMaterial color={hairColor} />
                  </mesh>
                )}
                {mode === 'beauty' && (
                  <mesh position={[0, 0.09, -0.145]}>
                    <boxGeometry args={[0.1, 0.045, 0.025]} />
                    <meshStandardMaterial color="#292524" />
                  </mesh>
                )}
              </group>
            </group>

            <group position={[-0.32, 0.16, 0]} rotation={pose.leftShoulder}>
              {handle('leftShoulder')}
              <Limb length={0.34} radius={0.075} color={outfitColor} mode={mode} />
              <group position={[0, -0.34, 0]} rotation={pose.leftElbow}>
                {handle('leftElbow')}
                <Limb length={0.32} radius={0.065} color={outfitColor} mode={mode} />
                <group position={[0, -0.32, 0]} rotation={pose.leftWrist}>
                  {handle('leftWrist')}
                  <mesh position={[0, -0.07, 0]} castShadow={mode === 'beauty'}>
                    <boxGeometry args={[0.12, 0.15, 0.07]} />
                    <SurfaceMaterial color={skinColor} mode={mode} />
                  </mesh>
                </group>
              </group>
            </group>

            <group position={[0.32, 0.16, 0]} rotation={pose.rightShoulder}>
              {handle('rightShoulder')}
              <Limb length={0.34} radius={0.075} color={outfitColor} mode={mode} />
              <group position={[0, -0.34, 0]} rotation={pose.rightElbow}>
                {handle('rightElbow')}
                <Limb length={0.32} radius={0.065} color={outfitColor} mode={mode} />
                <group position={[0, -0.32, 0]} rotation={pose.rightWrist}>
                  {handle('rightWrist')}
                  <mesh position={[0, -0.07, 0]} castShadow={mode === 'beauty'}>
                    <boxGeometry args={[0.12, 0.15, 0.07]} />
                    <SurfaceMaterial color={skinColor} mode={mode} />
                  </mesh>
                </group>
              </group>
            </group>
          </group>
        </group>

        <group position={[-0.16, -0.08, 0]} rotation={pose.leftHip}>
          {handle('leftHip')}
          <Limb length={0.44} radius={0.09} color={outfitColor} mode={mode} />
          <group position={[0, -0.44, 0]} rotation={pose.leftKnee}>
            {handle('leftKnee')}
            <Limb length={0.42} radius={0.075} color={outfitColor} mode={mode} />
            <group position={[0, -0.42, 0]} rotation={pose.leftAnkle}>
              {handle('leftAnkle')}
              <mesh position={[0, -0.035, -0.07]} castShadow={mode === 'beauty'}>
                <boxGeometry args={[0.15, 0.09, 0.29]} />
                <SurfaceMaterial color={outfitColor} mode={mode} />
              </mesh>
            </group>
          </group>
        </group>

        <group position={[0.16, -0.08, 0]} rotation={pose.rightHip}>
          {handle('rightHip')}
          <Limb length={0.44} radius={0.09} color={outfitColor} mode={mode} />
          <group position={[0, -0.44, 0]} rotation={pose.rightKnee}>
            {handle('rightKnee')}
            <Limb length={0.42} radius={0.075} color={outfitColor} mode={mode} />
            <group position={[0, -0.42, 0]} rotation={pose.rightAnkle}>
              {handle('rightAnkle')}
              <mesh position={[0, -0.035, -0.07]} castShadow={mode === 'beauty'}>
                <boxGeometry args={[0.15, 0.09, 0.29]} />
                <SurfaceMaterial color={outfitColor} mode={mode} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}


const glbSceneCache = createAsyncResourceCache<Group>();

async function loadGlbScene(storageKey: string, url: string): Promise<Group> {
  return glbSceneCache.get(storageKey, async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    return gltf.scene;
  });
}

async function normalizeGlbObject(source: Group, category: AssetLibraryCategory, mode: CaptureRenderMode, color: string): Promise<Group> {
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const cloned = clone(source);
  const initialBox = new Box3().setFromObject(cloned);
  const size = initialBox.getSize(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
  const targetSize = category === 'character' ? 1.8 : category === 'environment' ? 4 : 1;
  cloned.scale.setScalar(targetSize / maxDimension);
  cloned.updateMatrixWorld(true);
  const normalizedBox = new Box3().setFromObject(cloned);
  const center = normalizedBox.getCenter(new Vector3());
  cloned.position.x -= center.x;
  cloned.position.z -= center.z;
  cloned.position.y -= normalizedBox.min.y;
  cloned.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.castShadow = mode === 'beauty';
    child.receiveShadow = mode === 'beauty';
    if (mode === 'mask') child.material = new MeshBasicMaterial({ color });
  });
  const wrapper = new Group();
  wrapper.add(cloned);
  return wrapper;
}

function ImportedGlbShape({
  entity,
  assetId,
  mode,
  color,
  fallback,
  showJoints,
  selectedJoint,
  onSelectJoint,
}: {
  entity: Entity;
  assetId: string;
  mode: CaptureRenderMode;
  color: string;
  fallback: ReactNode;
  showJoints: boolean;
  selectedJoint: JointName | null;
  onSelectJoint(joint: JointName): void;
}) {
  const item = useEditorStore((state) => state.project.assetLibrary.find((asset) => asset.id === assetId));
  const [object, setObject] = useState<Group | null>(null);
  const [jointPositions, setJointPositions] = useState<Partial<Record<JointName, Vec3>>>({});
  useEffect(() => {
    let active = true;
    setObject(null);
    setJointPositions({});
    if (!item) return () => { active = false; };
    getAssetObjectUrl(item.storageKey)
      .then(async (url) => {
        if (!url) return null;
        const source = await loadGlbScene(item.storageKey, url);
        return normalizeGlbObject(source, item.category, mode, color);
      })
      .then((nextObject) => {
        if (active && nextObject) setObject(nextObject);
      })
      .catch(() => active && setObject(null));
    return () => { active = false; };
  }, [color, item?.id, item?.storageKey, mode]);

  const poseKey = entity.character ? JSON.stringify(entity.character.pose) : '';
  const rigKey = item?.rig ? JSON.stringify([item.rig.boneMap, item.rig.axisCorrections]) : '';
  useEffect(() => {
    if (!object) return;
    if (entity.character) applyHumanoidPoseToObject(object, item?.rig, entity.character.pose);
    setJointPositions(collectHumanoidJointPositions(object, item?.rig));
  }, [object, item?.rig, poseKey, rigKey]);

  return object ? (
    <>
      <primitive object={object} />
      {showJoints && JOINT_NAMES.map((joint) => {
        const position = jointPositions[joint];
        return position ? (
          <group key={joint} position={position}>
            <JointHandle name={joint} selected={selectedJoint === joint} onSelect={onSelectJoint} />
          </group>
        ) : null;
      })}
    </>
  ) : <>{fallback}</>;
}

function EntityShape({
  entity,
  selected,
  transformMode,
  selectedJoint,
  onSelectJoint,
  renderMode,
}: {
  entity: Entity;
  selected: boolean;
  transformMode: TransformMode;
  selectedJoint: JointName | null;
  onSelectJoint(joint: JointName): void;
  renderMode: CaptureRenderMode;
}) {
  const baseColor = selected
    ? '#f59e0b'
    : entity.asset?.color
      ?? (entity.type === 'character'
        ? '#64748b'
        : entity.type === 'prop'
          ? '#a8a29e'
          : entity.type === 'camera'
            ? '#38bdf8'
            : '#fde047');
  const color = renderMode === 'pose' ? '#ffffff' : renderMode === 'mask' ? entityMaskColor(entity.id) : baseColor;
  const modelAssetId = entity.asset?.modelAssetId;

  const proxyShape = entity.type === 'character' ? (
    <Humanoid
      entity={entity}
      color={color}
      mode={renderMode}
      showJoints={renderMode === 'beauty' && selected && transformMode === 'pose'}
      selectedJoint={selectedJoint}
      onSelectJoint={onSelectJoint}
    />
  ) : entity.type === 'camera' ? (
    <>
      <mesh><boxGeometry args={[0.8, 0.5, 0.5]} /><SurfaceMaterial color={color} mode={renderMode} wireframe /></mesh>
      <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.28, 0.5, 4]} /><SurfaceMaterial color={color} mode={renderMode} wireframe />
      </mesh>
    </>
  ) : entity.type === 'light' ? (
    <mesh><sphereGeometry args={[0.32, 18, 12]} /><SurfaceMaterial color={color} mode={renderMode} wireframe emissive /></mesh>
  ) : null;

  if (modelAssetId && entity.type !== 'camera' && entity.type !== 'light' && renderMode !== 'pose') {
    return <ImportedGlbShape
      entity={entity}
      assetId={modelAssetId}
      mode={renderMode}
      color={color}
      fallback={proxyShape ?? <mesh><boxGeometry args={[1, 1, 1]} /><SurfaceMaterial color={color} mode={renderMode} /></mesh>}
      showJoints={renderMode === 'beauty' && selected && transformMode === 'pose'}
      selectedJoint={selectedJoint}
      onSelectJoint={onSelectJoint}
    />;
  }

  if (entity.type === 'character') {
    return (
      <Humanoid
        entity={entity}
        color={color}
        mode={renderMode}
        showJoints={renderMode === 'beauty' && selected && transformMode === 'pose'}
        selectedJoint={selectedJoint}
        onSelectJoint={onSelectJoint}
      />
    );
  }

  if (entity.type === 'camera') {
    return (
      <>
        <mesh><boxGeometry args={[0.8, 0.5, 0.5]} /><SurfaceMaterial color={color} mode={renderMode} wireframe /></mesh>
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.28, 0.5, 4]} /><SurfaceMaterial color={color} mode={renderMode} wireframe />
        </mesh>
      </>
    );
  }

  if (entity.type === 'light') {
    return <mesh><sphereGeometry args={[0.32, 18, 12]} /><SurfaceMaterial color={color} mode={renderMode} wireframe emissive /></mesh>;
  }

  const primitive = entity.asset?.primitive ?? 'box';
  if (primitive === 'cylinder') return <mesh castShadow={renderMode === 'beauty'}><cylinderGeometry args={[0.5, 0.5, 1, 20]} /><SurfaceMaterial color={color} mode={renderMode} emissive={entity.asset?.material === 'emissive'} /></mesh>;
  if (primitive === 'sphere') return <mesh castShadow={renderMode === 'beauty'}><sphereGeometry args={[0.5, 20, 14]} /><SurfaceMaterial color={color} mode={renderMode} emissive={entity.asset?.material === 'emissive'} /></mesh>;
  if (primitive === 'plane') return <mesh castShadow={renderMode === 'beauty'}><boxGeometry args={[1, 0.05, 1]} /><SurfaceMaterial color={color} mode={renderMode} /></mesh>;
  return <mesh castShadow={renderMode === 'beauty'}><boxGeometry args={[1, 1, 1]} /><SurfaceMaterial color={color} mode={renderMode} emissive={entity.asset?.material === 'emissive'} /></mesh>;
}

function SceneEntity({
  entity,
  transformMode,
  relationshipControlled,
  renderMode,
  interactive,
}: {
  entity: Entity;
  transformMode: TransformMode;
  relationshipControlled: boolean;
  renderMode: CaptureRenderMode;
  interactive: boolean;
}) {
  const objectRef = useRef<Group>(null);
  const selectedEntityId = useEditorStore((state) => state.selectedEntityId);
  const selectedJoint = useEditorStore((state) => state.selectedJoint);
  const selectEntity = useEditorStore((state) => state.selectEntity);
  const setSelectedJoint = useEditorStore((state) => state.setSelectedJoint);
  const updateSelectedTransform = useEditorStore((state) => state.updateSelectedTransform);
  const isSelected = interactive && selectedEntityId === entity.id;

  if (!entity.visible) return null;

  const object = (
    <group
      ref={objectRef}
      position={entity.transform.position}
      rotation={entity.transform.rotation}
      scale={entity.transform.scale}
      onClick={interactive ? (event) => {
        event.stopPropagation();
        selectEntity(entity.id);
      } : undefined}
    >
      <EntityShape
        entity={entity}
        selected={isSelected}
        transformMode={transformMode}
        selectedJoint={interactive ? selectedJoint : null}
        onSelectJoint={setSelectedJoint}
        renderMode={renderMode}
      />
    </group>
  );

  if (!interactive || !isSelected || entity.locked || relationshipControlled || transformMode === 'pose') return object;

  const commitTransform = () => {
    const target = objectRef.current;
    if (!target) return;
    if (transformMode === 'translate') updateSelectedTransform('transform.position', target.position.toArray() as Vec3);
    else if (transformMode === 'rotate') updateSelectedTransform('transform.rotation', [target.rotation.x, target.rotation.y, target.rotation.z]);
    else if (transformMode === 'scale') updateSelectedTransform('transform.scale', target.scale.toArray() as Vec3);
  };

  return (
    <TransformControls mode={transformMode} size={0.8} translationSnap={0.1} rotationSnap={Math.PI / 36} scaleSnap={0.05} onMouseUp={commitTransform}>
      {object}
    </TransformControls>
  );
}

function ArmIKTarget({ entity, side }: { entity: Entity; side: 'left' | 'right' }) {
  const targetRef = useRef<Group>(null);
  const applySelectedArmIK = useEditorStore((state) => state.applySelectedArmIK);
  const proportions = useEditorStore((state) => {
    const assetId = entity.asset?.modelAssetId;
    return assetId ? state.project.assetLibrary.find((asset) => asset.id === assetId)?.rig?.proportions : undefined;
  });
  const pose = entity.character?.pose ?? createNeutralPose();
  const localHand = useMemo(() => calculateHandLocalPosition(pose, side, proportions), [pose, side, proportions]);
  const matrix = useMemo(() => {
    const quaternion = new Quaternion().setFromEuler(new Euler(...entity.transform.rotation, 'XYZ'));
    return new Matrix4().compose(new Vector3(...entity.transform.position), quaternion, new Vector3(...entity.transform.scale));
  }, [entity.transform.position, entity.transform.rotation, entity.transform.scale]);
  const worldHand = useMemo(() => new Vector3(...localHand).applyMatrix4(matrix), [localHand, matrix]);

  const commit = () => {
    if (!targetRef.current) return;
    const local = targetRef.current.position.clone().applyMatrix4(matrix.clone().invert());
    applySelectedArmIK(side, local.toArray() as Vec3);
  };

  return (
    <TransformControls mode="translate" size={0.65} translationSnap={0.05} onMouseUp={commit}>
      <group ref={targetRef} position={worldHand}>
        <mesh><sphereGeometry args={[0.09, 16, 12]} /><meshBasicMaterial color="#ec4899" depthTest={false} wireframe /></mesh>
      </group>
    </TransformControls>
  );
}


function JointRotationGizmo({ entity, joint, localPosition }: { entity: Entity; joint: JointName; localPosition: Vec3 }) {
  const pivotRef = useRef<Group>(null);
  const updateSelectedJoint = useEditorStore((state) => state.updateSelectedJoint);
  const currentRotation = entity.character?.pose[joint] ?? [0, 0, 0];
  const commit = () => {
    const pivot = pivotRef.current;
    if (!pivot) return;
    const delta: Vec3 = [pivot.rotation.x, pivot.rotation.y, pivot.rotation.z];
    if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-5) return;
    updateSelectedJoint(joint, [
      currentRotation[0] + delta[0],
      currentRotation[1] + delta[1],
      currentRotation[2] + delta[2],
    ]);
  };
  return (
    <TransformControls
      key={`${joint}:${currentRotation.join(':')}`}
      mode="rotate"
      space="local"
      size={0.62}
      rotationSnap={Math.PI / 36}
      onMouseUp={commit}
    >
      <group ref={pivotRef} position={localPosition}>
        <mesh visible={false}><sphereGeometry args={[0.04, 8, 6]} /><meshBasicMaterial /></mesh>
      </group>
    </TransformControls>
  );
}

function SelectedCharacterJointControls({ entity, joint }: { entity: Entity; joint: JointName }) {
  const item = useEditorStore((state) => {
    const assetId = entity.asset?.modelAssetId;
    return assetId ? state.project.assetLibrary.find((asset) => asset.id === assetId) : undefined;
  });
  const [importedPositions, setImportedPositions] = useState<Partial<Record<JointName, Vec3>>>({});
  const pose = entity.character?.pose ?? createNeutralPose();
  const poseKey = JSON.stringify(pose);
  const rigKey = item?.rig ? JSON.stringify([item.rig.boneMap, item.rig.axisCorrections]) : '';
  useEffect(() => {
    let active = true;
    setImportedPositions({});
    if (!item || item.category !== 'character') return () => { active = false; };
    getAssetObjectUrl(item.storageKey)
      .then(async (url) => {
        if (!url) return null;
        const source = await loadGlbScene(item.storageKey, url);
        const object = await normalizeGlbObject(source, item.category, 'beauty', '#ffffff');
        applyHumanoidPoseToObject(object, item.rig, pose);
        return collectHumanoidJointPositions(object, item.rig);
      })
      .then((positions) => { if (active && positions) setImportedPositions(positions); })
      .catch(() => { if (active) setImportedPositions({}); });
    return () => { active = false; };
  }, [item?.id, item?.storageKey, poseKey, rigKey]);
  const proxyPositions = useMemo(
    () => calculateHumanoidJointLocalPositions(pose, item?.rig?.proportions),
    [poseKey, item?.rig?.proportions],
  );
  const position = importedPositions[joint] ?? proxyPositions[joint];
  if (!position) return null;
  return (
    <group position={entity.transform.position} rotation={entity.transform.rotation} scale={entity.transform.scale}>
      <JointRotationGizmo entity={entity} joint={joint} localPosition={position} />
    </group>
  );
}

function LegIKTarget({ entity, side }: { entity: Entity; side: 'left' | 'right' }) {
  const targetRef = useRef<Group>(null);
  const applySelectedLegIK = useEditorStore((state) => state.applySelectedLegIK);
  const proportions = useEditorStore((state) => {
    const assetId = entity.asset?.modelAssetId;
    return assetId ? state.project.assetLibrary.find((asset) => asset.id === assetId)?.rig?.proportions : undefined;
  });
  const pose = entity.character?.pose ?? createNeutralPose();
  const localAnkle = useMemo(() => calculateAnkleLocalPosition(pose, side, proportions), [pose, side, proportions]);
  const matrix = useMemo(() => {
    const quaternion = new Quaternion().setFromEuler(new Euler(...entity.transform.rotation, 'XYZ'));
    return new Matrix4().compose(new Vector3(...entity.transform.position), quaternion, new Vector3(...entity.transform.scale));
  }, [entity.transform.position, entity.transform.rotation, entity.transform.scale]);
  const worldAnkle = useMemo(() => new Vector3(...localAnkle).applyMatrix4(matrix), [localAnkle, matrix]);
  const commit = () => {
    if (!targetRef.current) return;
    const local = targetRef.current.position.clone().applyMatrix4(matrix.clone().invert());
    applySelectedLegIK(side, local.toArray() as Vec3);
  };
  return (
    <TransformControls mode="translate" size={0.65} translationSnap={0.05} onMouseUp={commit}>
      <group ref={targetRef} position={worldAnkle}>
        <mesh><sphereGeometry args={[0.095, 16, 12]} /><meshBasicMaterial color="#22c55e" depthTest={false} wireframe /></mesh>
      </group>
    </TransformControls>
  );
}

function RelationshipGuides({ entities, relationships }: { entities: Entity[]; relationships: Relationship[] }) {
  const colors: Record<Relationship['type'], string> = { lookAt: '#22d3ee', hold: '#ec4899', sitOn: '#a78bfa', placeOn: '#34d399' };
  return (
    <>
      {relationships.filter((relationship) => relationship.active).map((relationship) => {
        const source = entities.find((entity) => entity.id === relationship.sourceEntityId);
        const target = entities.find((entity) => entity.id === relationship.targetEntityId);
        if (!source || !target) return null;
        const sourcePoint: Vec3 = [source.transform.position[0], source.transform.position[1] + (source.type === 'character' ? 1.2 : 0.3), source.transform.position[2]];
        const targetPoint: Vec3 = [target.transform.position[0], target.transform.position[1] + (target.type === 'character' ? 1.2 : 0.3), target.transform.position[2]];
        return <Line key={relationship.id} points={[sourcePoint, targetPoint]} color={colors[relationship.type]} lineWidth={1.5} dashed />;
      })}
    </>
  );
}


function SelectedLightGuide({ entity, targetEntity }: { entity: Entity; targetEntity?: Entity }) {
  const settings = entity.light ?? { kind: 'ambient' as const, color: '#ffffff', intensity: 0, range: 0, angle: Math.PI / 4, castShadow: false };
  const guideQuaternion = useMemo(() => {
    if (settings.kind === 'spot' && targetEntity) {
      const direction = new Vector3(...targetEntity.transform.position).sub(new Vector3(...entity.transform.position));
      if (direction.lengthSq() > 0.0001) return new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), direction.normalize());
    }
    return new Quaternion().setFromEuler(new Euler(...entity.transform.rotation, 'XYZ'));
  }, [entity.transform.position, entity.transform.rotation, settings.kind, targetEntity?.transform.position]);
  if (settings.kind === 'ambient') return null;
  const range = Math.max(0.25, settings.range);
  const guideMaterial = <meshBasicMaterial color={settings.color} transparent opacity={0.22} wireframe depthTest={false} />;

  if (settings.kind === 'point') {
    return (
      <group position={entity.transform.position} renderOrder={20}>
        <mesh>{/* Range is the actual distance used by Three.js pointLight. */}
          <sphereGeometry args={[range, 28, 18]} />
          {guideMaterial}
        </mesh>
      </group>
    );
  }

  const directionLength = settings.kind === 'directional' ? Math.max(4, Math.min(range, 14)) : range;
  if (settings.kind === 'directional') {
    return (
      <group position={entity.transform.position} quaternion={guideQuaternion} renderOrder={20}>
        <Line points={[[0, 0, 0], [0, 0, -directionLength]]} color={settings.color} lineWidth={1.5} depthTest={false} />
        <mesh position={[0, 0, -directionLength]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.18, 0.5, 12]} />
          <meshBasicMaterial color={settings.color} transparent opacity={0.65} depthTest={false} />
        </mesh>
      </group>
    );
  }

  const halfAngle = Math.max(0.05, Math.min(settings.angle, Math.PI / 2 - 0.02));
  const radius = Math.tan(halfAngle) * range;
  const circlePoints: Vec3[] = Array.from({ length: 33 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, -range];
  });
  const edgePoints: Vec3[] = [
    [radius, 0, -range], [-radius, 0, -range], [0, radius, -range], [0, -radius, -range],
  ];
  return (
    <group position={entity.transform.position} quaternion={guideQuaternion} renderOrder={20}>
      <Line points={circlePoints} color={settings.color} lineWidth={1.25} depthTest={false} />
      {edgePoints.map((point, index) => <Line key={index} points={[[0, 0, 0], point]} color={settings.color} lineWidth={1.1} depthTest={false} />)}
    </group>
  );
}


function TargetedSpotLight({ entity, targetEntity }: { entity: Entity; targetEntity?: Entity }) {
  const settings = entity.light!;
  const lightRef = useRef<SpotLight>(null);
  const targetObject = useMemo(() => new Object3D(), []);
  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    if (targetEntity) targetObject.position.set(...targetEntity.transform.position);
    else {
      const forward = new Vector3(0, 0, -1).applyEuler(new Euler(...entity.transform.rotation, 'XYZ'));
      targetObject.position.set(...entity.transform.position).add(forward.multiplyScalar(Math.max(1, settings.range * 0.5)));
    }
    targetObject.updateMatrixWorld();
    light.target = targetObject;
  });
  return (
    <>
      <primitive object={targetObject} />
      <spotLight ref={lightRef} position={entity.transform.position} color={settings.color} intensity={settings.intensity} distance={settings.range} angle={settings.angle} penumbra={0.35} castShadow={settings.castShadow} />
    </>
  );
}

function SceneLight({ entity, entities }: { entity: Entity; entities: Entity[] }) {
  const settings = entity.light ?? { kind: 'directional' as const, color: '#fff4d6', intensity: 2, range: 12, angle: Math.PI / 4, castShadow: true };
  if (!entity.visible) return null;
  if (settings.kind === 'ambient') return <ambientLight color={settings.color} intensity={settings.intensity} />;
  if (settings.kind === 'point') return <pointLight position={entity.transform.position} color={settings.color} intensity={settings.intensity} distance={settings.range} castShadow={settings.castShadow} />;
  if (settings.kind === 'spot') return <TargetedSpotLight entity={{ ...entity, light: settings }} targetEntity={entities.find((item) => item.id === settings.targetEntityId)} />;
  return <directionalLight position={entity.transform.position} color={settings.color} intensity={settings.intensity} castShadow={settings.castShadow} />;
}

function FreeViewController({
  frame,
  frameKey,
  resetToken,
  enabled,
  controlsRef,
}: {
  frame: ViewFrame;
  frameKey: string;
  resetToken: number;
  enabled: boolean;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((state) => state.camera);
  const appliedKeyRef = useRef('');

  useEffect(() => {
    if (!enabled || !controlsRef.current) return;
    const nextKey = `${frameKey}:${resetToken}`;
    if (appliedKeyRef.current === nextKey) return;
    camera.position.set(...frame.position);
    camera.up.set(0, 1, 0);
    controlsRef.current.target.set(...frame.target);
    camera.lookAt(controlsRef.current.target);
    camera.updateProjectionMatrix();
    controlsRef.current.update();
    controlsRef.current.saveState();
    appliedKeyRef.current = nextKey;
  }, [camera, controlsRef, enabled, frame, frameKey, resetToken]);

  return null;
}

function ShotCameraController({ cameraEntity, enabled }: { cameraEntity?: Entity; enabled: boolean }) {
  const camera = useThree((state) => state.camera);
  useFrame(() => {
    if (!enabled || !cameraEntity) return;
    camera.position.set(...cameraEntity.transform.position);
    camera.rotation.set(...cameraEntity.transform.rotation, 'XYZ');
    const settings = cameraEntity.camera;
    camera.near = settings?.near ?? 0.1;
    camera.far = settings?.far ?? 100;
    if (camera instanceof PerspectiveCamera) camera.fov = settings?.fov ?? 48;
    camera.updateProjectionMatrix();
  });
  return null;
}

function DepthOverride({ enabled }: { enabled: boolean }) {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    if (!enabled) return undefined;
    const material = new MeshDepthMaterial();
    const previous = scene.overrideMaterial;
    scene.overrideMaterial = material;
    return () => {
      scene.overrideMaterial = previous;
      material.dispose();
    };
  }, [enabled, scene]);
  return null;
}

function ReferenceOverlay({ image }: { image: ReferenceImage }) {
  const [src, setSrc] = useState<string | null>(image.dataUrl ?? null);
  useEffect(() => {
    let active = true;
    void referenceImageUrl(image).then((url) => { if (active) setSrc(url); });
    return () => { active = false; };
  }, [image.storageKey, image.dataUrl]);
  if (!src) return null;
  return (
    <div className={`reference-image-overlay ${image.fit}`} style={{ opacity: image.opacity }}>
      <img src={src} alt={image.name} />
    </div>
  );
}

interface ViewportProps {
  qualityProfile?: EffectiveRenderQuality;
}

export const Viewport = forwardRef<ViewportHandle, ViewportProps>(function Viewport({ qualityProfile = 'balanced' }, ref) {
  const project = useEditorStore((state) => state.project);
  const activeShotId = useEditorStore((state) => state.activeShotId);
  const selectedEntityId = useEditorStore((state) => state.selectedEntityId);
  const selectedJoint = useEditorStore((state) => state.selectedJoint);
  const transformMode = useEditorStore((state) => state.transformMode);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const selectEntity = useEditorStore((state) => state.selectEntity);
  const playheadTime = useEditorStore((state) => state.playheadTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const [shotCameraView, setShotCameraView] = useState(false);
  const [freeViewResetToken, setFreeViewResetToken] = useState(0);
  const [navigationHintCollapsed, setNavigationHintCollapsed] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(NAVIGATION_HINT_STORAGE_KEY) === '1'; }
    catch { return false; }
  });
  const [viewportAssistLightEnabled, setViewportAssistLightEnabled] = useState(() => {
    try { return typeof window === 'undefined' || window.localStorage.getItem(VIEWPORT_ASSIST_LIGHT_STORAGE_KEY) !== '0'; }
    catch { return true; }
  });
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);
  const [captureRequest, setCaptureRequest] = useState<CaptureRequest | null>(null);
  const rendererRef = useRef<RootState | null>(null);
  const captureBusyRef = useRef(false);
  const captureIdRef = useRef(0);
  const quality = useMemo(() => viewportQualitySettings(qualityProfile), [qualityProfile]);

  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0];
  const shot = scene.shots.find((item) => item.id === activeShotId) ?? scene.shots[0];
  const effectiveTime = captureRequest?.time ?? playheadTime;
  const renderMode = captureRequest?.mode ?? 'beauty';
  const captureActive = Boolean(captureRequest);
  const entities = resolveSceneAtTime(scene, shot, effectiveTime);
  const selected = entities.find((entity) => entity.id === selectedEntityId) ?? null;
  const activeCamera = entities.find((entity) => entity.id === shot.cameraEntityId && entity.type === 'camera');
  const ikSide = selectedJoint === 'leftWrist' ? 'left' : selectedJoint === 'rightWrist' ? 'right' : null;
  const legIkSide = selectedJoint === 'leftAnkle' ? 'left' : selectedJoint === 'rightAnkle' ? 'right' : null;
  const cameraEnabled = shotCameraView || captureActive;
  const sceneLights = entities.filter((entity) => entity.type === 'light' && entity.visible);
  const activeReferences = (scene.referenceImages ?? []).filter((image) => image.visible && (!image.cameraEntityId || image.cameraEntityId === activeCamera?.id));
  const frontViewFrame = useMemo(() => computeFrontViewFrame(entities), [scene.id]);

  useImperativeHandle(ref, () => ({
    captureFrame(time, mode) {
      return new Promise<Blob>((resolve, reject) => {
        if (captureBusyRef.current) {
          reject(new Error('다른 프레임을 캡처하고 있습니다.'));
          return;
        }
        captureBusyRef.current = true;
        setCaptureRequest({ id: ++captureIdRef.current, time, mode, resolve, reject });
      });
    },
  }), []);

  useEffect(() => {
    try { window.localStorage.setItem(NAVIGATION_HINT_STORAGE_KEY, navigationHintCollapsed ? '1' : '0'); }
    catch { /* private mode */ }
  }, [navigationHintCollapsed]);

  useEffect(() => {
    try { window.localStorage.setItem(VIEWPORT_ASSIST_LIGHT_STORAGE_KEY, viewportAssistLightEnabled ? '1' : '0'); }
    catch { /* private mode */ }
  }, [viewportAssistLightEnabled]);

  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.gl.toneMappingExposure = !captureActive && viewportAssistLightEnabled ? 1.08 : 1;
  }, [captureActive, viewportAssistLightEnabled]);

  useEffect(() => {
    if (!captureRequest || !rendererRef.current) return undefined;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const state = rendererRef.current;
        if (!state) {
          captureBusyRef.current = false;
          captureRequest.reject(new Error('렌더러를 찾지 못했습니다.'));
          setCaptureRequest(null);
          return;
        }
        state.gl.render(state.scene, state.camera);
        state.gl.domElement.toBlob((blob) => {
          if (!blob) {
            captureBusyRef.current = false;
            captureRequest.reject(new Error('PNG 프레임을 만들지 못했습니다.'));
            setCaptureRequest(null);
            return;
          }
          captureBusyRef.current = false;
          setCaptureRequest(null);
          setTimeout(() => captureRequest.resolve(blob), 0);
        }, 'image/png');
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [captureRequest]);

  const visibleEntities = entities.filter((entity) => {
    if (cameraEnabled && entity.type === 'camera') return false;
    if (!captureActive) return true;
    if (entity.type === 'light') return false;
    if (renderMode === 'pose') return entity.type === 'character';
    return true;
  });
  const navigationHintVisible = !captureActive && playheadTime === 0 && transformMode !== 'pose' && !shotCameraView;
  const editingLightAssist = renderMode === 'beauty' && !captureActive && viewportAssistLightEnabled;

  return (
    <div className="viewport">
      <Canvas
        camera={{ position: [0, 2.4, -7], fov: 48 }}
        dpr={quality.dpr}
        gl={{ preserveDrawingBuffer: true, antialias: quality.antialias, powerPreference: quality.powerPreference }}
        onCreated={(state) => { rendererRef.current = state; state.gl.toneMappingExposure = viewportAssistLightEnabled ? 1.08 : 1; }}
        onPointerMissed={() => !captureActive && selectEntity(null)}
        shadows={renderMode === 'beauty' && quality.shadows}
      >
        <color attach="background" args={[renderMode === 'beauty' ? (editingLightAssist ? '#0d1117' : '#0c0a09') : '#000000']} />
        {editingLightAssist && <hemisphereLight args={['#dbeafe', '#2b2f36', sceneLights.length === 0 ? 0.72 : 0.38]} />}
        {renderMode === 'beauty' && sceneLights.length === 0 && <ambientLight intensity={0.65} />}
        {renderMode === 'beauty' && sceneLights.length === 0 && <directionalLight position={[4, 8, 4]} intensity={2.2} castShadow={quality.shadows} />}
        {renderMode === 'beauty' && sceneLights.map((entity) => <SceneLight key={`light:${entity.id}`} entity={entity} entities={entities} />)}
        {!captureActive && quality.showInfiniteGrid && <Grid infiniteGrid fadeDistance={30} sectionColor="#57534e" cellColor="#292524" />}
        <DepthOverride enabled={renderMode === 'depth'} />
        <ShotCameraController cameraEntity={activeCamera} enabled={cameraEnabled} />
        <FreeViewController frame={frontViewFrame} frameKey={scene.id} resetToken={freeViewResetToken} enabled={!cameraEnabled && !captureActive} controlsRef={orbitControlsRef} />
        {visibleEntities.map((entity) => (
          <SceneEntity
            key={`${entity.id}:${activeShotId}:${renderMode}`}
            entity={entity}
            transformMode={transformMode}
            renderMode={renderMode}
            interactive={!captureActive}
            relationshipControlled={Boolean(findControllingRelationship(shot.relationships, entity.id)) || playheadTime > 0 || isPlaying}
          />
        ))}
        {!captureActive && renderMode === 'beauty' && selected?.type === 'light' && (
          <SelectedLightGuide entity={selected} targetEntity={entities.find((entity) => entity.id === selected.light?.targetEntityId)} />
        )}
        {!captureActive && <RelationshipGuides entities={entities} relationships={shot.relationships} />}
        {!captureActive && transformMode === 'pose' && selected?.type === 'character' && selectedJoint && !selected.locked && playheadTime === 0 && !isPlaying && (
          <SelectedCharacterJointControls entity={selected} joint={selectedJoint} />
        )}
        {!captureActive && transformMode === 'pose' && selected?.type === 'character' && ikSide && !selected.locked && playheadTime === 0 && !isPlaying && (
          <ArmIKTarget entity={selected} side={ikSide} />
        )}
        {!captureActive && transformMode === 'pose' && selected?.type === 'character' && legIkSide && !selected.locked && playheadTime === 0 && !isPlaying && (
          <LegIKTarget entity={selected} side={legIkSide} />
        )}
        <OrbitControls ref={orbitControlsRef} makeDefault enabled={!cameraEnabled && !captureActive} target={frontViewFrame.target} minDistance={1.2} maxDistance={80} />
      </Canvas>

      {!captureActive && shotCameraView && activeReferences.map((image) => (
        <ReferenceOverlay key={image.id} image={image} />
      ))}
      {!captureActive && shotCameraView && activeCamera?.camera?.showSafeFrame && (
        <div className={`camera-safe-frame ratio-${activeCamera.camera.aspectRatio.replace(':', '-')}`}><span>SAFE FRAME · {activeCamera.camera.aspectRatio}</span></div>
      )}

      <div className="viewport-toolbar" aria-label="변환 도구">
        <button className={!shotCameraView ? 'active' : ''} onClick={() => setShotCameraView(false)}>자유 시점</button>
        <button className={shotCameraView ? 'active' : ''} disabled={!activeCamera} onClick={() => setShotCameraView(true)}>샷 카메라</button>
        <button title="장면 정면(-Z)에서 피사체가 보이도록 자유 시점을 초기화합니다." onClick={() => { setShotCameraView(false); setFreeViewResetToken((value) => value + 1); }}>정면 맞춤</button>
        <button
          className={viewportAssistLightEnabled ? 'active' : ''}
          title="편집 화면에서만 약한 보조광과 노출 보정을 적용합니다. AI용 내보내기에는 반영되지 않습니다."
          aria-pressed={viewportAssistLightEnabled}
          onClick={() => setViewportAssistLightEnabled((value) => !value)}
        >작업 밝기</button>
        <span className="toolbar-divider" />
        <button className={transformMode === 'translate' ? 'active' : ''} onClick={() => setTransformMode('translate')}>이동</button>
        <button className={transformMode === 'rotate' ? 'active' : ''} onClick={() => setTransformMode('rotate')}>회전</button>
        <button className={transformMode === 'scale' ? 'active' : ''} onClick={() => setTransformMode('scale')}>크기</button>
        <button className={transformMode === 'pose' ? 'active' : ''} disabled={selected?.type !== 'character'} onClick={() => setTransformMode('pose')}>포즈·IK</button>
        {navigationHintVisible && (
          <>
            <span className="toolbar-divider" />
            <button className={!navigationHintCollapsed ? 'active help-toggle' : 'help-toggle'} onClick={() => setNavigationHintCollapsed((value) => !value)}>
              {navigationHintCollapsed ? '조작 도움말' : '도움말 숨기기'}
            </button>
          </>
        )}
      </div>

      <div className="viewport-badge">
        {shotCameraView ? '샷 카메라' : '자유 시점'} · {quality.profile} · 선택: {selected?.name ?? '없음'} · Shot: {shot.name}
        {transformMode === 'pose' && selectedJoint ? ` · 관절: ${selectedJoint}` : ''}
        {selected && findControllingRelationship(shot.relationships, selected.id) ? ' · 관계 제어 중' : ''}
        {playheadTime > 0 ? ` · ${playheadTime.toFixed(2)}초 미리보기` : ''}
      </div>
      {captureActive ? (
        <div className="viewport-hint"><p>{renderMode} 제어 프레임을 캡처하고 있습니다.</p></div>
      ) : playheadTime > 0 ? (
        <div className="viewport-hint"><p>타임라인 미리보기 중에는 직접 변형이 잠깁니다. 0초로 이동해 편집하세요.</p></div>
      ) : transformMode === 'pose' && legIkSide ? (
        <div className="viewport-hint"><p>회전 링으로 관절을 돌리거나 초록색 목표점을 끌어 {legIkSide === 'left' ? '왼발' : '오른발'} IK를 조절하세요.</p></div>
      ) : transformMode === 'pose' && ikSide ? (
        <div className="viewport-hint"><p>회전 링으로 관절을 돌리거나 분홍색 목표점을 끌어 {ikSide === 'left' ? '왼손' : '오른손'} IK를 조절하세요.</p></div>
      ) : transformMode === 'pose' && selectedJoint ? (
        <div className="viewport-hint"><p>선택 관절의 회전 링을 직접 드래그해 포즈를 조절하세요.</p></div>
      ) : navigationHintVisible && !navigationHintCollapsed ? (
        <div className="viewport-hint navigation-hint">
          <p>왼쪽 드래그: 회전 · 오른쪽 드래그: 화면 이동 · 휠: 확대/축소 · 방향이 어긋나면 ‘정면 맞춤’</p>
          <button className="hint-dismiss" aria-label="조작 도움말 접기" onClick={() => setNavigationHintCollapsed(true)}>접기</button>
        </div>
      ) : null}
    </div>
  );
});
