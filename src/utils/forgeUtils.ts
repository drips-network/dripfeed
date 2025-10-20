import type { Forge } from '../repositories/ProjectsRepository.js';

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
