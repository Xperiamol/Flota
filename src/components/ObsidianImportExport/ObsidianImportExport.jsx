import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Typography,
  Paper,
  Divider,
  FormControlLabel,
  Checkbox,
  TextField,
  LinearProgress,
  Alert,
  Collapse,
  IconButton
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CloudUpload as ExportIcon,
  CloudDownload as ImportIcon
} from '@mui/icons-material';
import {
  importObsidianVault,
  exportToObsidian,
  getImporterConfig,
  updateImporterConfig,
  getExporterConfig,
  updateExporterConfig,
  onImportProgress,
  onExportProgress
} from '../../api/obsidian';

/**
 * Obsidian 导入导出组件
 * 提供从 Obsidian 导入笔记和导出笔记到 Obsidian 的功能
 */
const ObsidianImportExport = () => {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [exportProgress, setExportProgress] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [exportResult, setExportResult] = useState(null);
  const [importerConfig, setImporterConfig] = useState(null);
  const [exporterConfig, setExporterConfig] = useState(null);
  const [showImportConfig, setShowImportConfig] = useState(false);
  const [showExportConfig, setShowExportConfig] = useState(false);

  useEffect(() => {
    // 加载配置
    loadConfigs();

    // 设置进度监听
    const unsubscribeImportStarted = onImportProgress('import-started', (event, data) => {
      setImportProgress({ phase: 'started', ...data });
    });

    const unsubscribeImportProcessing = onImportProgress('file-processing', (event, data) => {
      setImportProgress({ phase: 'processing', ...data });
    });

    const unsubscribeImportCompleted = onImportProgress('import-completed', (event, data) => {
      setImportProgress({ phase: 'completed', ...data });
      setImporting(false);
    });

    const unsubscribeExportStarted = onExportProgress('export-started', (event, data) => {
      setExportProgress({ phase: 'started', ...data });
    });

    const unsubscribeExportProcessing = onExportProgress('note-processing', (event, data) => {
      setExportProgress({ phase: 'processing', ...data });
    });

    const unsubscribeExportCompleted = onExportProgress('export-completed', (event, data) => {
      setExportProgress({ phase: 'completed', ...data });
      setExporting(false);
    });

    return () => {
      unsubscribeImportStarted();
      unsubscribeImportProcessing();
      unsubscribeImportCompleted();
      unsubscribeExportStarted();
      unsubscribeExportProcessing();
      unsubscribeExportCompleted();
    };
  }, []);

  const loadConfigs = async () => {
    const importerConfigResult = await getImporterConfig('obsidian');
    if (importerConfigResult.success) {
      setImporterConfig(importerConfigResult.data);
    }

    const exporterConfigResult = await getExporterConfig('obsidian');
    if (exporterConfigResult.success) {
      setExporterConfig(exporterConfigResult.data);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    setImportProgress(null);

    const result = await importObsidianVault({
      importAttachments: true,
      createCategories: true
    });

    setImportResult(result);
    setImporting(false);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportResult(null);
    setExportProgress(null);

    const result = await exportToObsidian({
      // 可以添加过滤条件
      filters: {}
    });

    setExportResult(result);
    setExporting(false);
  };

  const handleConfigChange = async (type, key, value) => {
    if (type === 'importer') {
      const newConfig = { ...importerConfig, [key]: value };
      setImporterConfig(newConfig);
      await updateImporterConfig('obsidian', newConfig);
    } else {
      const newConfig = { ...exporterConfig, [key]: value };
      setExporterConfig(newConfig);
      await updateExporterConfig('obsidian', newConfig);
    }
  };

  return (
    <Box>
      {/* 导入部分 */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            从 Obsidian 导入
          </Typography>
          <IconButton 
            size="small" 
            onClick={() => setShowImportConfig(!showImportConfig)}
            aria-label="展开导入配置"
          >
            {showImportConfig ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
        
        <Collapse in={showImportConfig}>
          {importerConfig && (
            <Box sx={{ mb: 2, pl: 2, borderLeft: '2px solid', borderColor: 'divider' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={importerConfig.convertWikiLinks}
                    onChange={(e) => handleConfigChange('importer', 'convertWikiLinks', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">转换 WikiLinks 为标准 Markdown 链接</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={importerConfig.preserveFrontMatter}
                    onChange={(e) => handleConfigChange('importer', 'preserveFrontMatter', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">保留 Front-matter 元数据</Typography>}
              />
            </Box>
          )}
        </Collapse>

        <Button 
          variant="contained" 
          startIcon={<ImportIcon />}
          onClick={handleImport} 
          disabled={importing}
          fullWidth
        >
          {importing ? '导入中...' : '选择 Vault 文件夹导入'}
        </Button>

        {importProgress && (
          <Box sx={{ mt: 2 }}>
            {importProgress.phase === 'started' && (
              <Typography variant="body2" color="text.secondary">
                开始导入，共 {importProgress.totalFiles} 个文件...
              </Typography>
            )}
            {importProgress.phase === 'processing' && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  处理中：{importProgress.current} / {importProgress.total}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={(importProgress.current / importProgress.total) * 100} 
                />
              </Box>
            )}
            {importProgress.phase === 'completed' && (
              <Alert severity="success" sx={{ mt: 1 }}>
                导入完成！成功：{importProgress.successCount} 个，失败：{importProgress.errorCount} 个
                {importProgress.warnings && importProgress.warnings.length > 0 && (
                  <Typography variant="caption" display="block">
                    警告：{importProgress.warnings.length} 个
                  </Typography>
                )}
              </Alert>
            )}
          </Box>
        )}

        {importResult && !importResult.success && (
          <Alert severity="error" sx={{ mt: 2 }}>
            导入失败：{importResult.error}
          </Alert>
        )}
      </Paper>

      {/* 导出部分 */}
      <Paper elevation={0} sx={{ p: 2, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            导出到 Obsidian
          </Typography>
          <IconButton 
            size="small" 
            onClick={() => setShowExportConfig(!showExportConfig)}
            aria-label="展开导出配置"
          >
            {showExportConfig ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
        
        <Collapse in={showExportConfig}>
          {exporterConfig && (
            <Box sx={{ mb: 2, pl: 2, borderLeft: '2px solid', borderColor: 'divider' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={exporterConfig.useFrontMatter}
                    onChange={(e) => handleConfigChange('exporter', 'useFrontMatter', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">使用 Front-matter 元数据</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={exporterConfig.useWikiLinks}
                    onChange={(e) => handleConfigChange('exporter', 'useWikiLinks', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">使用 WikiLinks 格式</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={exporterConfig.useCategories}
                    onChange={(e) => handleConfigChange('exporter', 'useCategories', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">按分类创建文件夹</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={exporterConfig.exportImages}
                    onChange={(e) => handleConfigChange('exporter', 'exportImages', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">导出图片附件</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={exporterConfig.exportWhiteboards}
                    onChange={(e) => handleConfigChange('exporter', 'exportWhiteboards', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">导出白板笔记（导出为 .excalidraw 文件）</Typography>}
              />
              <Box sx={{ mt: 1 }}>
                <TextField
                  label="附件文件夹名称"
                  value={exporterConfig.attachmentFolder}
                  onChange={(e) => handleConfigChange('exporter', 'attachmentFolder', e.target.value)}
                  size="small"
                  fullWidth
                />
              </Box>
            </Box>
          )}
        </Collapse>

        <Button 
          variant="contained" 
          startIcon={<ExportIcon />}
          onClick={handleExport} 
          disabled={exporting}
          fullWidth
        >
          {exporting ? '导出中...' : '选择文件夹导出'}
        </Button>

        {exportProgress && (
          <Box sx={{ mt: 2 }}>
            {exportProgress.phase === 'started' && (
              <Typography variant="body2" color="text.secondary">
                开始导出，共 {exportProgress.totalNotes} 个笔记...
              </Typography>
            )}
            {exportProgress.phase === 'processing' && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  处理中：{exportProgress.current} / {exportProgress.total}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={(exportProgress.current / exportProgress.total) * 100} 
                />
              </Box>
            )}
            {exportProgress.phase === 'completed' && (
              <Alert severity="success" sx={{ mt: 1 }}>
                导出完成！成功：{exportProgress.successCount} 个，失败：{exportProgress.errorCount} 个
              </Alert>
            )}
          </Box>
        )}

        {exportResult && !exportResult.success && (
          <Alert severity="error" sx={{ mt: 2 }}>
            导出失败：{exportResult.error}
          </Alert>
        )}
      </Paper>
    </Box>
  );
};

export default ObsidianImportExport;
