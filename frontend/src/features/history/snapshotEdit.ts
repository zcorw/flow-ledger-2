import { z } from 'zod';

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const snapshotEditSchema = z.object({
  snapshotDate: z.string().refine(isCalendarDate, '请选择有效的快照日期'),
  originalAmount: z.string().trim().regex(
    /^-?\d{1,14}(?:\.\d{1,6})?$/,
    '金额最多支持 14 位整数和 6 位小数',
  ),
});

export type SnapshotEditValues = z.infer<typeof snapshotEditSchema>;
