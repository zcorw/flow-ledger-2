import { Alert, Box, Button, Checkbox, FormControlLabel, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { ApiClientError } from '../../api/client';
import { decidePairing, getPairing, listReceiptDevices, revokeReceiptDevice } from './api';

const normalized = (value: string) => value.replace(/[-\s]/g, '').toUpperCase();
const message = (error: unknown) => error instanceof ApiClientError ? error.message : '请求失败，请稍后重试';

export function ReceiptDevicesPage() {
  const [search] = useSearchParams();
  const [code, setCode] = useState(search.get('code') ?? '');
  const [selectedCode, setSelectedCode] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const queryClient = useQueryClient();
  const pairing = useQuery({ queryKey: ['receipt-pairing', selectedCode], queryFn: () => getPairing(selectedCode), enabled: selectedCode.length === 8, retry: false });
  const devices = useQuery({ queryKey: ['receipt-devices'], queryFn: listReceiptDevices, retry: false });
  const decision = useMutation({
    mutationFn: (action: 'approve' | 'deny') => decidePairing(selectedCode, action),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['receipt-devices'] }); },
  });
  const revoke = useMutation({
    mutationFn: revokeReceiptDevice,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['receipt-devices'] }); },
  });
  const codeValid = /^[A-HJ-NP-Z2-9]{8}$/.test(normalized(code));
  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Button component={RouterLink} to="/settings" sx={{ alignSelf: 'flex-start' }}>返回设置</Button>
      <Box>
        <Typography component="h1" variant="h4" data-page-title>设备授权</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>输入眼镜上显示的授权码，核对后允许它识别收据。</Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box component="form" onSubmit={(event) => { event.preventDefault(); if (codeValid) { setSelectedCode(normalized(code)); setAcknowledged(false); decision.reset(); } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField label="眼镜授权码" value={code} disabled={decision.isPending} onChange={(event) => { setCode(event.target.value); setSelectedCode(''); setAcknowledged(false); decision.reset(); }} slotProps={{ htmlInput: { maxLength: 16, autoCapitalize: 'characters', spellCheck: false } }} sx={{ flex: 1 }} />
              <Button type="submit" variant="outlined" disabled={!codeValid || pairing.isFetching || decision.isPending}>核对设备</Button>
            </Stack>
          </Box>
          {pairing.isFetching && <Typography role="status">正在核对设备…</Typography>}
          {selectedCode && pairing.error && <Alert severity="error">{message(pairing.error)}</Alert>}
          {selectedCode && pairing.data && !decision.isSuccess && (
            <Stack spacing={2}>
              <Typography variant="h6">{pairing.data.deviceName}</Typography>
              <Typography sx={{ fontFamily: 'monospace', fontSize: 28 }}>{selectedCode.slice(0, 4)}-{selectedCode.slice(4)}</Typography>
              <Typography color="text.secondary">授权码有效至 {new Date(pairing.data.expiresAt).toLocaleString()}</Typography>
              {pairing.data.status === 'pending' ? <>
                <Alert severity="info">仅允许识别收据，长期有效，可随时撤销。原图与识别结果将保存在知产，方便以后查看；图片也会发送给配置的识别服务。此授权不会创建开销或修改资产。</Alert>
                <FormControlLabel control={<Checkbox checked={acknowledged} disabled={decision.isPending} onChange={(event) => setAcknowledged(event.target.checked)} />} label="我已核对，授权码与眼镜显示一致" />
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" disabled={!acknowledged || decision.isPending} onClick={() => decision.mutate('approve')}>授权识别收据</Button>
                  <Button disabled={decision.isPending} onClick={() => decision.mutate('deny')}>拒绝</Button>
                </Stack>
              </> : <Alert severity="info">该授权码已经处理，请返回眼镜继续操作。</Alert>}
            </Stack>
          )}
          {decision.error && <Alert severity="error">{message(decision.error)}</Alert>}
          {decision.isSuccess && <Alert severity={decision.data.status === 'approved' ? 'success' : 'info'}>{decision.data.status === 'approved' ? '授权完成，请返回眼镜继续识别。' : '已拒绝设备授权。'}</Alert>}
        </Stack>
      </Paper>
      <Stack spacing={2}>
        <Typography component="h2" variant="h6">有效授权</Typography>
        {devices.error && <Alert severity="error">{message(devices.error)}</Alert>}
        {revoke.error && <Alert severity="error">{message(revoke.error)}</Alert>}
        {devices.data?.length === 0 && <Typography color="text.secondary">暂无有效设备授权。</Typography>}
        {devices.data?.map((device) => <Paper key={device.id} variant="outlined" sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box><Typography sx={{ fontWeight: 600 }}>{device.deviceName}</Typography><Typography color="text.secondary" variant="body2">收据识别 · {device.expiresAt ? new Date(device.expiresAt).toLocaleString() + ' 到期' : '长期有效'}</Typography></Box>
            <Button color="error" disabled={revoke.isPending} onClick={() => revoke.mutate(device.id)}>撤销授权</Button>
          </Stack>
        </Paper>)}
      </Stack>
    </Stack>
  );
}
