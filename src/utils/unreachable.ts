export function unreachable(message?: string): never {
  const prefix = 'Unreachable code executed';
  throw new Error(message ? `${prefix}: ${message}` : prefix);
}
