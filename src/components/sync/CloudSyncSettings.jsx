import React, { useState } from 'react';
import { Box, Button } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '../common/AppIcons';
import SyncRegistryView from './SyncRegistryView';
import NutcloudSyncSettings from './NutcloudSyncSettings';
import GoogleCalendarSettings from './GoogleCalendarSettings';
import CalendarSyncSettings from './CalendarSyncSettings';
import CloudBackupSettings from './CloudBackupSettings';
import { settingsSectionSx } from '../../styles/commonStyles';

const CloudSyncSettings = () => {
  const [currentView, setCurrentView] = useState('registry'); // 'registry', 'nutcloud', 'google-calendar', 'caldav'

  const handleOpenSettings = (providerId) => {
    setCurrentView(providerId);
  };

  const handleBackToRegistry = () => {
    setCurrentView('registry');
  };

  return (
    <Box>
      {/* 返回按钮 */}
      {currentView !== 'registry' && (
        <Box sx={(theme) => ({ ...settingsSectionSx(theme), py: 1.25 })}>
          <Button
            onClick={handleBackToRegistry}
            size="small"
            startIcon={<ArrowBackIcon />}
            sx={{ textTransform: 'none' }}
          >
            返回同步总览
          </Button>
        </Box>
      )}

      {/* 内容区域 */}
      {currentView === 'registry' && (
        <><SyncRegistryView onOpenSettings={handleOpenSettings} /><CloudBackupSettings /></>
      )}
      {currentView === 'nutcloud' && <NutcloudSyncSettings />}
      {currentView === 'google-calendar' && <GoogleCalendarSettings />}
      {currentView === 'caldav' && <CalendarSyncSettings />}
    </Box>
  );
};

export default CloudSyncSettings;
