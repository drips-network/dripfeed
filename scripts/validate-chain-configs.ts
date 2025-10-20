import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAIN_CONFIGS_DIR = path.join(__dirname, '..', 'src', 'chain-configs');
const ALL_CHAINS_FILE = path.join(CHAIN_CONFIGS_DIR, 'all-chains.ts');

const EXCLUDED_FILES = ['all-chains.ts', 'loadChainConfig.ts'];

/**
 * Validates that all chain config files are properly registered in all-chains.ts.
 * This ensures developers don't forget to add new chains to the union types.
 */
function validateChainConfigs(): void {
  // Get all chain config files.
  const entries = fs.readdirSync(CHAIN_CONFIGS_DIR, { withFileTypes: true });
  const chainFiles = entries
    .filter((d) => d.isFile() && d.name.endsWith('.ts') && !EXCLUDED_FILES.includes(d.name))
    .map((d) => d.name.replace('.ts', ''));

  if (chainFiles.length === 0) {
    console.error('❌ No chain config files found in src/chain-configs/');
    process.exit(1);
  }

  // Parse all-chains.ts to extract imported chains.
  const allChainsContent = fs.readFileSync(ALL_CHAINS_FILE, 'utf-8');

  // Match imports like: import * as mainnet from './mainnet.js';
  // Also matches: import type * as mainnet from './mainnet.js';
  const importRegex = /import\s+(?:type\s+)?\*\s+as\s+(\w+)\s+from\s+['"]\.\/(\w+)\.js['"]/g;
  const matches = [...allChainsContent.matchAll(importRegex)];
  const importedChains = new Set(matches.map((m) => m[2]));

  // Check all chain files are imported.
  const missing = chainFiles.filter((file) => !importedChains.has(file));

  if (missing.length > 0) {
    console.error(
      `❌ Chain config files missing from src/chain-configs/all-chains.ts:\n   ${missing.join(', ')}\n\n` +
        `Add imports for these chains in src/chain-configs/all-chains.ts and update the union types.`,
    );
    process.exit(1);
  }

  console.log(`✅ All ${chainFiles.length} chain config(s) are properly registered:`);
  chainFiles.forEach((file) => console.log(`   - ${file}`));
}

validateChainConfigs();
