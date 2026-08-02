export function containsFullAccountNumber(value: string): boolean {
  return /\d{7,}/.test(value);
}
