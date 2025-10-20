#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ARTIFACT = join(ROOT, '../solardao-hardhat-template/deployments');

function findLatestNetwork() {
  // Prefer localhost then sepolia
  const networks = ['localhost', 'sepolia'];
  for (const net of networks) {
    try {
      const p = join(ARTIFACT, net, 'SolarDAO.json');
      const s = readFileSync(p, 'utf8');
      return { path: p, network: net, json: JSON.parse(s) };
    } catch {}
  }
  throw new Error('No deployment found. Deploy SolarDAO first.');
}

function main() {
  const { json, network } = findLatestNetwork();
  const outDir = join(ROOT, 'abi');
  mkdirSync(outDir, { recursive: true });
  const abi = json.abi;
  const address = json.address;
  writeFileSync(join(outDir, 'SolarDAOABI.json'), JSON.stringify(abi, null, 2));
  writeFileSync(
    join(outDir, 'SolarDAOAddresses.ts'),
    `export const SolarDAOAddresses = { "${network}": { address: "${address}" } } as const;\n`
  );
  console.log(`[genabi] wrote ABI and address for ${network}`);
}

main();



