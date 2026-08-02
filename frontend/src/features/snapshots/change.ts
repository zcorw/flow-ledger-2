export function isUnusualChange(current: number, previous: number): boolean {
  const amount = Math.abs(current - previous);
  const percent = previous === 0 ? 0 : amount / Math.abs(previous);
  return amount > 20_000 || percent > 0.2;
}
