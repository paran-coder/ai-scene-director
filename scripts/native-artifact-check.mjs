import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { releaseIdentity } from './release-identity.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const platform = String(args.platform || process.platform);
const identity = await releaseIdentity(platform);
const root = String(args.root || 'src-tauri/target/release/bundle');
const strict = Boolean(args.strict);
const reportFile = String(args.report || `NATIVE_ARTIFACTS_${platform}.json`);
const allowed = identity.platform === 'windows' ? ['.msi', '.exe']
  : identity.platform === 'macos' ? ['.dmg', '.app.tar.gz']
  : ['.deb', '.AppImage', '.rpm'];

async function walk(directory) {
  const out = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) out.push(...await walk(path));
      else out.push(path);
    }
  } catch { /* missing artifact directory */ }
  return out;
}
const files = (await walk(root)).filter((file) => allowed.some((extension) => file.endsWith(extension)));
const artifacts = [];
for (const file of files) {
  const info = await stat(file);
  const bytes = await readFile(file);
  artifacts.push({ path: relative('.', file), bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const report = { ...identity, generatedAt: new Date().toISOString(), platform: identity.platform, root, status: artifacts.length ? 'pass' : 'not-found', artifacts };
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Native artifacts ${platform}: ${report.status} · ${artifacts.length} file(s)`);
if (strict && !artifacts.length) process.exitCode = 1;
