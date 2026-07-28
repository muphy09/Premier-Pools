const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tar = require('tar');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const sourceRef = 'v2.3.8';
const sourceCommit = 'ff202d12331c255856ed6afb66a91b076a8b4879';
const outputDirectory = path.join(root, 'src', 'services', 'legacy');
const outputFile = path.join(outputDirectory, 'feenstraMay2026Engine.generated.js');

const wrapperSource = `
import pricingData from './src/services/pricingData';
import { MasterPricingEngine } from './src/services/masterPricingEngine';

const clone = (value) => JSON.parse(JSON.stringify(value));

const mergeDeep = (target, source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return clone(source);
  }

  const result = target && typeof target === 'object' && !Array.isArray(target)
    ? clone(target)
    : {};

  Object.entries(source).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = clone(value);
    }
  });

  return result;
};

const replaceObject = (target, source) => {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, clone(source));
};

export function calculateFeenstraMay2026Proposal(proposal, papDiscounts, pricingSnapshot) {
  const previousPricing = clone(pricingData);
  const legacyPricing = mergeDeep(previousPricing, pricingSnapshot || {});
  replaceObject(pricingData, legacyPricing);
  try {
    return MasterPricingEngine.calculateCompleteProposal(proposal, papDiscounts);
  } finally {
    replaceObject(pricingData, previousPricing);
  }
}
`;

async function main() {
  const resolvedCommit = execFileSync('git', ['rev-list', '-n', '1', sourceRef], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

  if (resolvedCommit !== sourceCommit) {
    throw new Error(
      `Expected ${sourceRef} to resolve to ${sourceCommit}, but found ${resolvedCommit}.`
    );
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'submerge-feenstra-may-'));
  const archivePath = path.join(temporaryRoot, 'source.tar');
  const sourceRoot = path.join(temporaryRoot, 'source');
  fs.mkdirSync(sourceRoot);

  try {
    execFileSync(
      'git',
      ['archive', '--format=tar', '--output', archivePath, sourceRef],
      { cwd: root, stdio: 'inherit' }
    );
    await tar.x({ file: archivePath, cwd: sourceRoot });

    const entryFile = path.join(sourceRoot, 'feenstra-legacy-entry.ts');
    fs.writeFileSync(entryFile, wrapperSource);
    fs.mkdirSync(outputDirectory, { recursive: true });

    await build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      outfile: outputFile,
      legalComments: 'none',
      minify: true,
      sourcemap: false,
      banner: {
        js: [
          '/*',
          ' * Generated, immutable May 1, 2026 pricing engine for Feenstra only.',
          ` * Source: ${sourceRef} (${sourceCommit})`,
          ' * Regenerate with: npm run generate:feenstra-may-engine',
          ' */',
        ].join('\n'),
      },
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
