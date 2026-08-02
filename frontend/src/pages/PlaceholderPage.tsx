import { Paper, Typography } from '@mui/material';

export function PlaceholderPage({ title }: { title: string }) {
  return <Paper variant="outlined" sx={{ p: 5, borderRadius: 3 }}><Typography variant="h5" sx={{ fontWeight: 700 }}>{title}</Typography><Typography sx={{ mt: 1, color: 'text.secondary' }}>该模块将在对应 TodoList 任务中接入。</Typography></Paper>;
}
