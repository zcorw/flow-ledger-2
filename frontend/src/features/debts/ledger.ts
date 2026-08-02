export function applyDebtEvent(balance: number, eventType: string, amount: number): number {
  return eventType === 'issue' || eventType === 'adjustment' ? balance + amount : balance - amount;
}
