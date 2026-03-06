import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Avatar,
  Button,
  Chip,
  LinearProgress,
  Alert,
  Stack,
  Fade,
  Zoom,
  Tooltip
} from '@mui/material';
import {
  Person as PersonIcon,
  Notes as NotesIcon,
  CheckCircle as CheckCircleIcon,
  Extension as ExtensionIcon,
  Today as TodayIcon,
  Warning as WarningIcon,
  TrendingUp as TrendingUpIcon,
  Edit as EditIcon,
  WavingHand as WavingHandIcon,
  CalendarMonth as CalendarMonthIcon,
  Tag as TagIcon
} from '@mui/icons-material';
import { scrollbar } from '../styles/commonStyles';
import { useStore } from '../store/useStore';
import { fetchTodoStats } from '../api/todoAPI';
import { fetchInstalledPlugins } from '../api/pluginAPI';
import { createTransitionString, ANIMATIONS } from '../utils/animationConfig';
import { useTranslation } from '../utils/i18n';
import TimeZoneUtils from '../utils/timeZoneUtils';
import { useError } from './ErrorProvider';
import logger from '../utils/logger';

const Profile = () => {
  const { t } = useTranslation();
  const { showError } = useError();
  const { notes, userAvatar, theme, primaryColor, setCurrentView, userName, christmasMode } = useStore();
  const [todoStats, setTodoStats] = useState(null);
  const [installedPlugins, setInstalledPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);

  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true);
        setError(null);

        // 获取待办事项统计
        const todoStatsResult = await fetchTodoStats();
        logger.log('[Profile] 待办统计结果:', todoStatsResult);

        // invoke函数会自动解包数据，直接返回stats对象
        if (todoStatsResult && typeof todoStatsResult === 'object') {
          logger.log('[Profile] 待办总数:', todoStatsResult.total);
          logger.log('[Profile] 已完成:', todoStatsResult.completed);
          logger.log('[Profile] 进行中:', todoStatsResult.pending);
          logger.log('[Profile] 逾期:', todoStatsResult.overdue);
          logger.log('[Profile] 今日到期:', todoStatsResult.dueToday);
          setTodoStats(todoStatsResult);
        } else {
          console.error('[Profile] 待办统计数据格式错误:', todoStatsResult);
          // 设置默认值
          setTodoStats({
            total: 0,
            completed: 0,
            pending: 0,
            overdue: 0,
            dueToday: 0,
            completedOnTime: 0,
            onTimeRate: 0
          });
        }

        // 获取已安装插件
        const pluginsResult = await fetchInstalledPlugins();
        logger.log('[Profile] 插件列表:', pluginsResult);
        if (Array.isArray(pluginsResult)) {
          setInstalledPlugins(pluginsResult);
        }

      } catch (err) {
        console.error('[Profile] 加载统计数据失败:', err);
        showError(err, '加载统计数据失败');
        setError('加载统计数据失败: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  // 计算笔记统计 - 使用 useMemo 避免重复计算
  const noteStats = useMemo(() => ({
    total: notes.length,
    deleted: notes.filter(note => note.is_deleted).length,
    pinned: notes.filter(note => note.is_pinned && !note.is_deleted).length,
    active: notes.filter(note => !note.is_deleted).length
  }), [notes]);

  // 计算待办事项统计 - 使用 useMemo 避免重复计算
  const todoStatsDisplay = useMemo(() => todoStats || {
    total: 0,
    completed: 0,
    pending: 0,
    overdue: 0,
    dueToday: 0,
    completedOnTime: 0,
    onTimeRate: 0
  }, [todoStats]);

  const completionRate = useMemo(() => todoStatsDisplay.total > 0
    ? Math.round((todoStatsDisplay.completed / todoStatsDisplay.total) * 100)
    : 0, [todoStatsDisplay.total, todoStatsDisplay.completed]);

  // 处理编辑资料按钮点击
  const handleEditProfile = () => {
    setCurrentView('settings');
  };

  // 处理头像点击
  const handleAvatarClick = () => {
    setShowWelcome(true);
    setTimeout(() => {
      setShowWelcome(false);
    }, 3000);
  };

  // 获取当前时间的问候语
  const getGreeting = () => {
    // 圣诞模式下使用圣诞问候语
    if (christmasMode) {
      const greetings = [
        '🎄 圣诞快乐',
        '🎅 Ho Ho Ho!',
        '✨ Merry Christmas!',
        '🎁 愿你的圣诞充满欢乐',
        '❄️ 祝你幸福安康',
        '🌟 愿圣诞之光照亮你的心'
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }
    const hour = new Date().getHours();
    if (hour < 6) return t('profile.greetingNight');
    if (hour < 9) return t('profile.greetingMorning');
    if (hour < 12) return t('profile.greetingMorning');
    if (hour < 14) return t('profile.greetingNoon');
    if (hour < 18) return t('profile.greetingNoon');
    if (hour < 22) return t('profile.greetingEvening');
    return t('profile.greetingNight');
  };

  // 获取显示名称
  const displayName = userName || t('profile.defaultUser');

  // 计算笔记活动热力图数据（过去90天）
  const getHeatmapData = () => {
    const days = 90;
    const today = new Date();
    const heatmapData = [];

    // 创建日期到笔记数量的映射（区分创建和更新）
    const dateCountMap = {};

    notes.forEach(note => {
      if (!note.is_deleted) {
        // 统计创建时间
        if (note.created_at) {
          const createdDate = new Date(note.created_at);
          const createdDateKey = createdDate.getFullYear() + '-' +
            String(createdDate.getMonth() + 1).padStart(2, '0') + '-' +
            String(createdDate.getDate()).padStart(2, '0');
          if (!dateCountMap[createdDateKey]) {
            dateCountMap[createdDateKey] = { created: 0, updated: 0 };
          }
          dateCountMap[createdDateKey].created += 1;
        }

        // 统计更新时间（如果更新时间与创建时间不同）
        if (note.updated_at && note.updated_at !== note.created_at) {
          const updatedDate = new Date(note.updated_at);
          const updatedDateKey = updatedDate.getFullYear() + '-' +
            String(updatedDate.getMonth() + 1).padStart(2, '0') + '-' +
            String(updatedDate.getDate()).padStart(2, '0');
          if (!dateCountMap[updatedDateKey]) {
            dateCountMap[updatedDateKey] = { created: 0, updated: 0 };
          }
          dateCountMap[updatedDateKey].updated += 1;
        }
      }
    });

    // 生成过去90天的数据
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
      const counts = dateCountMap[dateKey] || { created: 0, updated: 0 };
      const totalCount = counts.created + counts.updated;
      heatmapData.push({
        date: dateKey,
        created: counts.created,
        updated: counts.updated,
        count: totalCount,
        level: totalCount === 0 ? 0 : totalCount <= 2 ? 1 : totalCount <= 5 ? 2 : totalCount <= 8 ? 3 : 4
      });
    }

    return heatmapData;
  };

  // 计算高频词统计
  const getTopWords = () => {
    const wordMap = {};
    const stopWords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这']);

    notes.forEach(note => {
      if (!note.is_deleted && note.content) {
        // 简单的中文分词（匹配2-4个连续的中文字符）
        const matches = note.content.match(/[\u4e00-\u9fa5]{2,4}/g);
        if (matches) {
          matches.forEach(word => {
            if (!stopWords.has(word) && word.length >= 2) {
              wordMap[word] = (wordMap[word] || 0) + 1;
            }
          });
        }
      }
    });

    // 转换为数组并排序
    return Object.entries(wordMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word, count]) => ({ word, count }));
  };

  const heatmapData = getHeatmapData();
  const topWords = getTopWords();

  // 计算热力图网格布局（13周 x 7天）
  const weeks = [];
  for (let i = 0; i < heatmapData.length; i += 7) {
    weeks.push(heatmapData.slice(i, i + 7));
  }

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <LinearProgress sx={{ width: '100%', maxWidth: 400 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto', height: '100%', overflow: 'auto' }}>
      {/* 头部信息 */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        mb: 3,
        p: 3,
        borderRadius: 2,
        position: 'relative',
        background: theme === 'dark'
          ? 'linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%)'
          : 'linear-gradient(135deg, #f5f5f5 0%, #ffffff 100%)',
        border: `1px solid ${theme === 'dark' ? '#333' : '#e0e0e0'}`
      }}>
        <Box
          sx={{ position: 'relative', mr: 3 }}
          onClick={handleAvatarClick}
        >
          <Avatar
            sx={{
              width: 80,
              height: 80,
              bgcolor: primaryColor,
              fontSize: '2rem',
              cursor: 'pointer',
              transition: createTransitionString(ANIMATIONS.button),
              transform: avatarHover ? 'scale(1.1) rotate(5deg)' : 'scale(1)',
              boxShadow: avatarHover ? 4 : 1,
              '&:hover': {
                boxShadow: 6
              }
            }}
            src={userAvatar}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
          >
            <PersonIcon fontSize="large" />
          </Avatar>

          {/* 欢迎消息气泡 */}
          <Zoom in={showWelcome}>
            <Box
              sx={{
                position: 'absolute',
                top: -60,
                left: '50%',
                transform: 'translateX(-50%)',
                bgcolor: theme === 'dark' ? '#2d2d2d' : '#fff',
                color: theme === 'dark' ? '#fff' : '#000',
                px: 2,
                py: 1,
                borderRadius: 2,
                boxShadow: 3,
                whiteSpace: 'nowrap',
                border: `1px solid ${theme === 'dark' ? '#444' : '#e0e0e0'}`,
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 0,
                  height: 0,
                  borderLeft: '8px solid transparent',
                  borderRight: '8px solid transparent',
                  borderTop: `8px solid ${theme === 'dark' ? '#2d2d2d' : '#fff'}`
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WavingHandIcon sx={{ fontSize: 20, color: primaryColor }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {getGreeting()}，{displayName}！
                </Typography>
              </Box>
            </Box>
          </Zoom>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" sx={{ mb: 1, fontWeight: 600 }}>
            {displayName}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('profile.subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={handleEditProfile}
          sx={{
            transition: createTransitionString(ANIMATIONS.button),
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: 2
            }
          }}
        >
          {t('profile.editProfile')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* 瀑布流布局 - 使用 CSS columns */}
      <Box
        sx={{
          columnCount: {
            xs: 1,
            sm: 2,
            md: 3,
            lg: 4
          },
          columnGap: 3,
          '& > *': {
            breakInside: 'avoid',
            marginBottom: 3
          }
        }}
      >
        {/* 笔记统计卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <NotesIcon sx={{ fontSize: 32, color: primaryColor, mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                笔记统计
              </Typography>
            </Box>
            <Typography variant="h3" sx={{ mb: 2, fontWeight: 600, color: primaryColor }}>
              {noteStats.active}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              活跃笔记
            </Typography>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">总笔记数</Typography>
                <Chip label={noteStats.total} size="small" variant="outlined" />
              </Box>
              {noteStats.pinned > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">置顶笔记</Typography>
                  <Chip label={noteStats.pinned} size="small" color="primary" />
                </Box>
              )}
              {noteStats.deleted > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">已删除</Typography>
                  <Chip label={noteStats.deleted} size="small" color="error" />
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* 待办事项统计卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CheckCircleIcon sx={{ fontSize: 32, color: 'success.main', mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                待办事项
              </Typography>
            </Box>
            <Typography variant="h3" sx={{ mb: 2, fontWeight: 600, color: 'success.main' }}>
              {todoStatsDisplay.total}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              总待办数
            </Typography>
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption">完成率</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {completionRate}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={completionRate}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: 'success.main',
                    borderRadius: 4
                  }
                }}
              />
            </Box>
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption">按时完成率</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {todoStatsDisplay.onTimeRate || 0}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={todoStatsDisplay.onTimeRate || 0}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: 'info.main',
                    borderRadius: 4
                  }
                }}
              />
            </Box>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">已完成</Typography>
                <Chip label={todoStatsDisplay.completed} size="small" color="success" />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">按时完成</Typography>
                <Chip label={todoStatsDisplay.completedOnTime || 0} size="small" color="info" />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">进行中</Typography>
                <Chip label={todoStatsDisplay.pending} size="small" color="warning" />
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* 待办专注时长卡片 */}
        <Card sx={{
          transition: createTransitionString(ANIMATIONS.card),
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <TrendingUpIcon sx={{ fontSize: 32, color: 'primary.main', mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                专注时长
              </Typography>
            </Box>
            <Typography variant="h3" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
              {TimeZoneUtils.formatSeconds(todoStatsDisplay.totalFocusTime || 0)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              累计专注时间
            </Typography>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">今日专注</Typography>
                <Chip
                  label={TimeZoneUtils.formatSeconds(todoStatsDisplay.todayFocusTime || 0)}
                  size="small"
                  color="primary"
                  variant={(todoStatsDisplay.todayFocusTime || 0) > 0 ? "filled" : "outlined"}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">本周专注</Typography>
                <Chip
                  label={TimeZoneUtils.formatSeconds(todoStatsDisplay.weekFocusTime || 0)}
                  size="small"
                  color="info"
                  variant={(todoStatsDisplay.weekFocusTime || 0) > 0 ? "filled" : "outlined"}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">本月专注</Typography>
                <Chip
                  label={TimeZoneUtils.formatSeconds(todoStatsDisplay.monthFocusTime || 0)}
                  size="small"
                  color="secondary"
                  variant={(todoStatsDisplay.monthFocusTime || 0) > 0 ? "filled" : "outlined"}
                />
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* 今日待办卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <TodayIcon sx={{ fontSize: 32, color: 'info.main', mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                今日待办
              </Typography>
            </Box>
            <Typography variant="h3" sx={{ mb: 2, fontWeight: 600, color: 'info.main' }}>
              {todoStatsDisplay.dueToday}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              今日到期待办
            </Typography>
            {todoStatsDisplay.dueToday > 0 ? (
              <Chip
                label="需要关注"
                size="small"
                color="info"
                variant="filled"
                sx={{ width: '100%' }}
              />
            ) : (
              <Chip
                label="暂无待办"
                size="small"
                variant="outlined"
                sx={{ width: '100%' }}
              />
            )}
          </CardContent>
        </Card>

        {/* 逾期待办卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <WarningIcon sx={{ fontSize: 32, color: 'error.main', mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                逾期待办
              </Typography>
            </Box>
            <Typography variant="h3" sx={{ mb: 2, fontWeight: 600, color: 'error.main' }}>
              {todoStatsDisplay.overdue}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              需要处理的逾期待办
            </Typography>
            {todoStatsDisplay.overdue > 0 ? (
              <Chip
                label="紧急处理"
                size="small"
                color="error"
                variant="filled"
                sx={{ width: '100%' }}
              />
            ) : (
              <Chip
                label="无逾期"
                size="small"
                color="success"
                variant="outlined"
                sx={{ width: '100%' }}
              />
            )}
          </CardContent>
        </Card>

        {/* 插件统计卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <ExtensionIcon sx={{ fontSize: 32, color: primaryColor, mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                已安装插件
              </Typography>
            </Box>
            <Typography variant="h3" sx={{ mb: 2, fontWeight: 600, color: primaryColor }}>
              {installedPlugins.length}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              扩展应用功能
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {installedPlugins.slice(0, 3).map((plugin) => (
                <Chip
                  key={plugin.id}
                  label={plugin.manifest?.name || plugin.id}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              ))}
              {installedPlugins.length > 3 && (
                <Chip
                  label={`+${installedPlugins.length - 3}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              )}
            </Box>
          </CardContent>
        </Card>

        {/* 使用概览卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <TrendingUpIcon sx={{ fontSize: 32, color: 'success.main', mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                使用概览
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              您的生产力数据
            </Typography>
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">笔记创建</Typography>
                <Typography variant="h6" sx={{ fontWeight: 600, color: primaryColor }}>
                  {noteStats.total}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">任务完成</Typography>
                <Typography variant="h6" sx={{ fontWeight: 600, color: 'success.main' }}>
                  {todoStatsDisplay.completed}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">插件使用</Typography>
                <Typography variant="h6" sx={{ fontWeight: 600, color: primaryColor }}>
                  {installedPlugins.length}
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* 笔记详细信息卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
              <NotesIcon sx={{ mr: 1, color: primaryColor }} />
              笔记详情
            </Typography>
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">总笔记数</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{noteStats.total}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">活跃笔记</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{noteStats.active}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">置顶笔记</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{noteStats.pinned}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">已删除</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{noteStats.deleted}</Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* 待办详细信息卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
              <CheckCircleIcon sx={{ mr: 1, color: 'success.main' }} />
              待办详情
            </Typography>
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">总任务数</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{todoStatsDisplay.total}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">已完成</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{todoStatsDisplay.completed}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">进行中</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{todoStatsDisplay.pending}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">今日到期</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{todoStatsDisplay.dueToday}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">已逾期</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{todoStatsDisplay.overdue}</Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* 笔记活动热力图卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CalendarMonthIcon sx={{ fontSize: 32, color: primaryColor, mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                笔记活动热力图
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              过去90天的笔记创建活动
            </Typography>

            {/* 热力图网格和图例 */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              {/* 热力图网格 */}
              <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                overflowX: 'auto',
                overflowY: 'hidden',
                pb: 1,
                ...scrollbar.auto
              }}>
                {weeks.map((week, weekIndex) => (
                  <Box key={weekIndex} sx={{ display: 'flex', gap: 0.5 }}>
                    {week.map((day, dayIndex) => {
                      const colors = [
                        theme === 'dark' ? '#1a1a1a' : '#ebedf0',
                        theme === 'dark' ? '#0e4429' : '#9be9a8',
                        theme === 'dark' ? '#006d32' : '#40c463',
                        theme === 'dark' ? '#26a641' : '#30a14e',
                        theme === 'dark' ? '#39d353' : '#216e39'
                      ];
                      return (
                        <Tooltip
                          key={dayIndex}
                          title={
                            <Box>
                              <Typography variant="caption" display="block">{day.date}</Typography>
                              <Typography variant="caption" display="block">创建: {day.created} 篇</Typography>
                              <Typography variant="caption" display="block">更新: {day.updated} 篇</Typography>
                              <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>
                                总计: {day.count} 次活动
                              </Typography>
                            </Box>
                          }
                          placement="top"
                        >
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              backgroundColor: colors[day.level],
                              borderRadius: '2px',
                              cursor: 'pointer',
                              transition: 'transform 0.2s, box-shadow 0.2s',
                              '&:hover': {
                                transform: 'scale(1.3)',
                                boxShadow: 1
                              }
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                  </Box>
                ))}
              </Box>

              {/* 图例 */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">少</Typography>
                {[0, 1, 2, 3, 4].map(level => {
                  const colors = [
                    theme === 'dark' ? '#1a1a1a' : '#ebedf0',
                    theme === 'dark' ? '#0e4429' : '#9be9a8',
                    theme === 'dark' ? '#006d32' : '#40c463',
                    theme === 'dark' ? '#26a641' : '#30a14e',
                    theme === 'dark' ? '#39d353' : '#216e39'
                  ];
                  return (
                    <Box
                      key={level}
                      sx={{
                        width: 12,
                        height: 12,
                        backgroundColor: colors[level],
                        borderRadius: '2px'
                      }}
                    />
                  );
                })}
                <Typography variant="caption" color="text.secondary">多</Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>

        {/* 高频词统计卡片 */}
        <Card sx={(muiTheme) => ({
          transition: createTransitionString(ANIMATIONS.card),
          backgroundColor: muiTheme.palette.mode === 'dark'
            ? 'rgba(30, 41, 59, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 4
          }
        })}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <TagIcon sx={{ fontSize: 32, color: 'info.main', mr: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                高频词统计
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              笔记中最常出现的词汇
            </Typography>

            {topWords.length > 0 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {topWords.map((item, index) => {
                  const maxCount = topWords[0]?.count || 1;
                  const intensity = (item.count / maxCount);
                  const fontSize = 0.75 + (intensity * 0.5); // 0.75rem - 1.25rem
                  const opacity = 0.6 + (intensity * 0.4); // 0.6 - 1.0

                  return (
                    <Tooltip key={item.word} title={`出现 ${item.count} 次`} placement="top">
                      <Chip
                        label={item.word}
                        size="small"
                        sx={{
                          fontSize: `${fontSize}rem`,
                          opacity: opacity,
                          fontWeight: index < 3 ? 600 : 400,
                          bgcolor: index < 3 ? 'info.main' : 'default',
                          color: index < 3 ? 'white' : 'text.primary',
                          transition: 'transform 0.2s, box-shadow 0.2s',
                          '&:hover': {
                            transform: 'scale(1.1)',
                            boxShadow: 2
                          }
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                暂无数据
              </Typography>
            )}

            {/* 词频排行榜 */}
            {topWords.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  TOP 5 词频
                </Typography>
                <Stack spacing={0.5}>
                  {topWords.slice(0, 5).map((item, index) => (
                    <Box
                      key={item.word}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 600,
                            color: index < 3 ? 'info.main' : 'text.secondary',
                            minWidth: 16
                          }}
                        >
                          {index + 1}
                        </Typography>
                        <Typography variant="body2">{item.word}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={(item.count / topWords[0].count) * 100}
                          sx={{
                            width: 60,
                            height: 4,
                            borderRadius: 2,
                            bgcolor: 'grey.200',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: 'info.main',
                              borderRadius: 2
                            }
                          }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 24, textAlign: 'right' }}>
                          {item.count}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default Profile;
