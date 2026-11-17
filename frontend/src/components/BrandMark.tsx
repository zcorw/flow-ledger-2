import { Box } from '@mui/material';

// The adjacent wordmark names the brand; the mark is decorative for screen readers.
export function BrandMark() {
  return <Box component="img" src="/brand/zhichan.svg" alt="" sx={{ width: 34, height: 34, flexShrink: 0 }} />;
}
