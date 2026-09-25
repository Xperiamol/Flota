import { useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { ContentCopy } from '../common/AppIcons';
import { notifyError, notifySuccess } from '../../utils/notify';
import { settingsSectionSx, sectionDescriptionSx, sectionTitleSx } from '../../styles/commonStyles';

/**
 * 应用内 HTTP MCP：Flota 运行时即可用，无需安装独立的 stdio 服务；
 * 额外提供剪藏网页、读取组件数据等依赖应用内服务的工具。
 */
export default function McpHttpSection() {
  const [issued, setIssued] = useState(null);

  const issue = async () => {
    const result = await window.electronAPI?.clipper?.issueToken('MCP 客户端');
    if (!result?.success) return notifyError(result?.error || '生成令牌失败');
    setIssued(result.data);
  };

  const endpoint = `http://127.0.0.1:${issued?.port || 47831}/mcp`;
  const config = issued ? JSON.stringify({
    mcpServers: { flota: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${issued.token}` } } },
  }, null, 2) : '';

  const copy = async () => {
    await navigator.clipboard.writeText(config);
    notifySuccess('已复制配置');
  };

  return (
    <Box sx={settingsSectionSx}>
      <Typography variant="subtitle1" sx={sectionTitleSx}>HTTP 接入（Flota 运行时可用）</Typography>
      <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 1.5 }}>
        支持 Streamable HTTP 的客户端（如 Claude Code）可以直接连接 {endpoint}。除笔记、待办等工具外，还提供剪藏网页（clip_url）和读取组件数据的工具。只接受本机访问，需要访问令牌。
      </Typography>
      {issued ? (
        <>
          <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2 }}>令牌只显示这一次，请现在复制保存。可在“设置 → 网页剪藏”中取消授权。</Alert>
          <Box component="pre" sx={{ m: 0, mb: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', fontSize: 12, overflow: 'auto' }}>{config}</Box>
          <Button size="small" startIcon={<ContentCopy fontSize="small" />} onClick={copy}>复制配置</Button>
        </>
      ) : (
        <Button variant="outlined" size="small" onClick={issue}>生成访问令牌</Button>
      )}
    </Box>
  );
}
