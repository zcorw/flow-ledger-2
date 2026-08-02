import { Box } from '@mui/material';
import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

export function EChart({ option, height = 300 }: { option: echarts.EChartsOption; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = echarts.init(container.current, undefined, { renderer: 'svg' });
    chart.setOption(option);
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [option]);
  return <Box ref={container} sx={{ width: '100%', height }} />;
}
