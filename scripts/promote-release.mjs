import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apply = process.argv.includes('--apply');
const target = process.argv.find((argument) => argument.startsWith('--to='))?.slice('--to='.length) || '1.0.0';
const root = resolve(new URL('../', import.meta.url).pathname);
const packagePath = resolve(root, 'package.json');
const gatePath = resolve(root, 'RELEASE_GATE.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const gate = JSON.parse(await readFile(gatePath, 'utf8'));

const reasons = [];
if (gate.status !== 'ready') reasons.push(`릴리스 게이트가 ready가 아닙니다: ${gate.status}`);
if (gate.version !== packageJson.version) reasons.push(`게이트 버전(${gate.version})과 패키지 버전(${packageJson.version})이 다릅니다.`);
if (gate.evidence?.validation?.status !== 'pass') reasons.push('플랫폼 릴리스 증거 무결성 검사가 통과하지 않았습니다.');
if (!gate.evidence?.validation?.releaseId) reasons.push('검증된 릴리스 실행 ID가 없습니다.');
if (!/^1\.0\.0-rc\.\d+$/.test(packageJson.version)) reasons.push(`승격 가능한 RC 버전이 아닙니다: ${packageJson.version}`);
if (target !== '1.0.0') reasons.push(`현재 승격 도구는 1.0.0만 허용합니다: ${target}`);

const plan = {
  generatedAt: new Date().toISOString(),
  eligible: reasons.length === 0,
  applyRequested: apply,
  sourceVersion: packageJson.version,
  targetVersion: target,
  releaseId: gate.evidence?.validation?.releaseId ?? null,
  reasons,
};
await writeFile(resolve(root, 'PROMOTION_PLAN.json'), `${JSON.stringify(plan, null, 2)}\n`);

if (reasons.length) {
  console.error(`Promotion blocked: ${reasons.join(' | ')}`);
  process.exitCode = 1;
} else if (!apply) {
  console.log(`Promotion eligible: ${packageJson.version} -> ${target} · rerun with --apply`);
} else {
  const textFiles = [
    'package-lock.json',
    'src-tauri/Cargo.toml',
    'src-tauri/tauri.conf.json',
    'src/domain/validation.ts',
    'src/domain/sampleProject.ts',
    'src/domain/export.ts',
    'src/components/Onboarding.tsx',
    'tests/domain.test.ts',
  ];
  packageJson.version = target;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  for (const relativePath of textFiles) {
    const path = resolve(root, relativePath);
    const current = await readFile(path, 'utf8');
    let next = current.replaceAll(plan.sourceVersion, target);
    if (relativePath.endsWith('Onboarding.tsx')) next = next.replace(/AI Scene Director 1\.0 RC\d+/g, 'AI Scene Director 1.0');
    await writeFile(path, next);
  }
  const record = {
    ...plan,
    appliedAt: new Date().toISOString(),
    eligible: true,
    applied: true,
    sourceGate: 'RELEASE_GATE.json',
    sourceEvidenceManifest: 'RELEASE_EVIDENCE_MANIFEST.json',
  };
  await writeFile(resolve(root, 'PROMOTION_RECORD.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Promotion applied: ${plan.sourceVersion} -> ${target}`);
}
