import { createStoredZip } from './export.ts';
import type { Project } from './types.ts';
import type { ProjectHealthReport } from './projectDoctor.ts';
import type { RuntimeDiagnostics } from './runtimeDiagnostics.ts';
import type { VisualSnapshot } from './visualSnapshot.ts';
import type { RecoverySnapshot } from './recovery.ts';

export interface SupportBundleInput {
  project: Project;
  report: ProjectHealthReport;
  runtime?: RuntimeDiagnostics | null;
  snapshot?: VisualSnapshot | null;
  recoverySnapshots?: RecoverySnapshot[];
  appVersion: string;
  generatedAt?: Date;
}

function sanitizeProject(project: Project): Project {
  const copy = structuredClone(project);
  copy.name = 'redacted-project';
  copy.scenes.forEach((scene, sceneIndex) => {
    scene.name = `scene-${sceneIndex + 1}`;
    scene.description = '';
    scene.environment.location = '';
    scene.environment.atmosphere = [];
    scene.referenceImages = scene.referenceImages.map((image, imageIndex) => ({
      ...image,
      name: `reference-${imageIndex + 1}`,
      storageKey: `redacted-reference-${imageIndex + 1}`,
      dataUrl: undefined,
    }));
    scene.entities.forEach((entity, entityIndex) => {
      entity.name = `${entity.type}-${entityIndex + 1}`;
      if (entity.character) {
        entity.character.appearance = {
          ...entity.character.appearance,
          descriptor: '',
          occupation: undefined,
          outfitSummary: '',
        };
      }
    });
    scene.shots.forEach((shot, shotIndex) => {
      shot.name = `shot-${shotIndex + 1}`;
      shot.generationResults = shot.generationResults.map((result) => ({
        ...result,
        serverUrl: '',
        workflowName: 'redacted-workflow',
        outputs: result.outputs.map((output, outputIndex) => ({
          ...output,
          filename: `output-${outputIndex + 1}`,
          subfolder: '',
        })),
      }));
    });
  });
  copy.assetLibrary = copy.assetLibrary.map((asset, index) => ({
    ...asset,
    name: `asset-${index + 1}`,
    storageKey: `redacted-asset-${index + 1}`,
    originalFilename: `asset-${index + 1}.glb`,
  }));
  return copy;
}

export async function createSupportBundle(input: SupportBundleInput): Promise<Blob> {
  const generatedAt = input.generatedAt ?? new Date();
  const recovery = (input.recoverySnapshots ?? []).map((snapshot) => ({
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    activeShotId: snapshot.activeShotId,
    sequence: snapshot.sequence,
    checksum: snapshot.checksum,
    projectRevision: snapshot.project.revision,
    schemaVersion: snapshot.project.schemaVersion,
  }));
  const manifest = {
    format: 'ai-scene-director-support-bundle',
    version: '1',
    appVersion: input.appVersion,
    generatedAt: generatedAt.toISOString(),
    privacy: {
      projectTextRedacted: true,
      localAssetBinaryIncluded: false,
      referenceImageBinaryIncluded: false,
      generationServerUrlsRedacted: true,
    },
    files: [
      'diagnostics.json',
      'project_structure.json',
      'recovery_summary.json',
      ...(input.snapshot ? ['visual_snapshot.svg'] : []),
      'README.txt',
    ],
  };
  const diagnostics = {
    appVersion: input.appVersion,
    projectId: input.project.id,
    projectRevision: input.project.revision,
    schemaVersion: input.project.schemaVersion,
    report: input.report,
    runtime: input.runtime ?? null,
    visualSnapshot: input.snapshot ? {
      signature: input.snapshot.signature,
      entityCount: input.snapshot.entityCount,
    } : null,
  };
  const readme = [
    'AI Scene Director support bundle',
    '',
    'This archive contains diagnostics and a redacted structural copy of the project.',
    'It does not include GLB binaries, reference images, prompt text, scene descriptions, local storage keys, or generation server URLs.',
    'Review the files before sharing them with a support recipient.',
  ].join('\n');
  return createStoredZip([
    { name: 'support_manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'diagnostics.json', data: JSON.stringify(diagnostics, null, 2) },
    { name: 'project_structure.json', data: JSON.stringify(sanitizeProject(input.project), null, 2) },
    { name: 'recovery_summary.json', data: JSON.stringify(recovery, null, 2) },
    ...(input.snapshot ? [{ name: 'visual_snapshot.svg', data: input.snapshot.svg }] : []),
    { name: 'README.txt', data: readme },
  ]);
}
