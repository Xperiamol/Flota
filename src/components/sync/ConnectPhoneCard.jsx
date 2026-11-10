import { Box, Button, Paper, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';

/** 云同步页里的入口：「连接手机」是单独的设置项，这里只放一个跳过去的按钮 */
export const CONNECT_PHONE_TAB = 15;

export default function ConnectPhoneCard({ sx, wrapperSx }) {
  const card = (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>连接手机</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            扫码把同步账号和 AI 设置带到手机
          </Typography>
        </Box>
        <Button size="small" variant="outlined" onClick={() => useStore.getState().setSettingsTabValue?.(CONNECT_PHONE_TAB)}>去连接</Button>
      </Box>
    </Paper>
  );
  return wrapperSx ? <Box sx={wrapperSx}>{card}</Box> : card;
}
