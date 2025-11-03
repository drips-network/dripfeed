import type { Forge } from '../db/schemas.js';

export function convertForgeToNumber(forge: Forge): number {
  if (forge === 'github') return 0;
  if (forge === 'gitlab') return 1;
  throw new Error(`Invalid forge: ${forge}`);
}

export function mapForge(forgeNum: number): Forge {
  if (forgeNum === 0) return 'github';
  if (forgeNum === 1) return 'gitlab';
  throw new Error(`Invalid forge enum value: ${forgeNum}`);
}

export function forgeToUrl(forge: Forge, projectName: string): string {
  switch (forge) {
    case 'github':
      return `https://github.com/${projectName}`;
    default:
      throw new Error(`Unsupported forge: ${forge}`);
  }
}
