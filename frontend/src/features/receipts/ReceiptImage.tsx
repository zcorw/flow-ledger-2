import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useEffect, useState } from 'react';
import { receiptImageUrl } from './api';

export function ReceiptImage({ id, onClose }: { id: string; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '';
    void fetch(receiptImageUrl(id), { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('原图加载失败，请确认登录状态后重试。');
        const blob = await response.blob();
        if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
      }).catch(() => { if (!controller.signal.aborted) setError('原图加载失败，请关闭后重试。'); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return <Dialog open onClose={onClose} fullWidth maxWidth="lg" aria-labelledby="receipt-image-title">
    <DialogTitle id="receipt-image-title">单据原图</DialogTitle>
    <DialogContent dividers sx={{ textAlign: 'center' }}>
      {error ? <Alert severity="error">{error}</Alert> : url
        ? <Box component="img" src={url} alt="单据原图" sx={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
        : <CircularProgress aria-label="正在加载单据原图" />}
    </DialogContent>
    <DialogActions>{url && <Button component="a" href={url} target="_blank" rel="noopener noreferrer">新窗口查看</Button>}<Button onClick={onClose}>关闭</Button></DialogActions>
  </Dialog>;
}
