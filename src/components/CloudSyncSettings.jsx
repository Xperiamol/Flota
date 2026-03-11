import React, { useState } from 'react';
import { Box, IconButton } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import SyncRegistryView from './SyncRegistryView';
import NutcloudSyncSettings from './NutcloudSyncSettings';
import GoogleCalendarSettings from './GoogleCalendarSettings';
import CalendarSyncSettings from './CalendarSyncSettings';

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
        <Box sx={{ mb: 2 }}>
          <IconButton onClick={handleBackToRegistry} size="small" aria-label="返回">
            <ArrowBackIcon />
          </IconButton>
        </Box>
      )}

      {/* 内容区域 */}
      {currentView === 'registry' && (
        <SyncRegistryView onOpenSettings={handleOpenSettings} />
      )}
      {currentView === 'nutcloud' && <NutcloudSyncSettings />}
      {currentView === 'google-calendar' && <GoogleCalendarSettings />}
      {currentView === 'caldav' && <CalendarSyncSettings />}
    </Box>
  );
};

export default CloudSyncSettings;
