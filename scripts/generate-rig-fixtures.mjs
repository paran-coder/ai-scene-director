import { mkdir, writeFile } from 'node:fs/promises';

function makeGlb(nodeNames, generator) {
  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: nodeNames.map((name, index) => ({ name, children: index + 1 < nodeNames.length ? [index + 1] : undefined })),
    skins: [{ joints: nodeNames.map((_, index) => index), skeleton: 0 }],
    animations: [{ name: 'idle', channels: [], samplers: [] }],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const totalLength = 12 + 8 + paddedLength;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, totalLength);
  bytes.set(encoded, 20);
  return bytes;
}

const fixtures = {
  'humanoid-vrm-smoke.glb': [
    'J_Bip_C_Hips', 'J_Bip_C_Spine', 'J_Bip_C_Chest', 'J_Bip_C_Neck', 'J_Bip_C_Head',
    'J_Bip_L_UpperArm', 'J_Bip_L_LowerArm', 'J_Bip_L_Hand',
    'J_Bip_R_UpperArm', 'J_Bip_R_LowerArm', 'J_Bip_R_Hand',
    'J_Bip_L_UpperLeg', 'J_Bip_L_LowerLeg', 'J_Bip_L_Foot',
    'J_Bip_R_UpperLeg', 'J_Bip_R_LowerLeg', 'J_Bip_R_Foot',
  ],
  'humanoid-generic-smoke.glb': [
    'pelvis', 'spine', 'chest', 'neck', 'head',
    'upper_arm.L', 'forearm.L', 'hand.L',
    'upper_arm.R', 'forearm.R', 'hand.R',
    'thigh.L', 'shin.L', 'foot.L',
    'thigh.R', 'shin.R', 'foot.R',
  ],
};
await mkdir(new URL('../public/fixtures/', import.meta.url), { recursive: true });
for (const [name, bones] of Object.entries(fixtures)) {
  await writeFile(new URL(`../public/fixtures/${name}`, import.meta.url), makeGlb(bones, `AI Scene Director ${name}`));
}
console.log(`Generated ${Object.keys(fixtures).length} rig fixtures.`);
