import { useState, useEffect, useMemo } from 'react';
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
} from '../common/AppIcons';
import { heroCardSx, createSoftGlassCardSx } from '../../styles/commonStyles';
import { useStore } from '../../store/useStore';
import { fetchTodoStats } from '../../api/todoAPI';
import { fetchActivityHeatmap } from '../../api/noteAPI';
import { fetchInstalledPlugins } from '../../api/pluginAPI';
import { useTranslation } from '../../utils/i18n';
import TimeZoneUtils from '../../utils/timeZoneUtils';
import { useError } from '../common/ErrorProvider';
import UsageWaveCard from '../common/UsageWaveCard';
import { EASING } from '../../utils/animationConfig';

const PROFILE_EASING = EASING.standard;
const PROFILE_TRANSITION = `background-color 180ms ${PROFILE_EASING}, border-color 180ms ${PROFILE_EASING}, box-shadow 180ms ${PROFILE_EASING}, color 180ms ${PROFILE_EASING}, filter 180ms ${PROFILE_EASING}`;
const DEFAULT_TODO_STATS = {
  total: 0,
  completed: 0,
  pending: 0,
  overdue: 0,
  dueToday: 0,
  completedOnTime: 0,
  completedWithDueDate: 0,
  onTimeRate: 0,
  todayCompleted: 0,
  todayWorkload: 0,
  todayCompletionRate: null,
  totalFocusTime: 0,
  todayFocusTime: 0,
  weekFocusTime: 0,
  monthFocusTime: 0,
};
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很',
  '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '这个', '那个',
  '可以', '因为', '所以', '如果', '然后', '已经', '已有', '复制', '链接', '广告', '联系'
]);

const formatLocalDateKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const getHeatmapColors = (isDark) => [
  isDark ? '#1a1a1a' : '#ebedf0',
  isDark ? '#0e4429' : '#9be9a8',
  isDark ? '#006d32' : '#40c463',
  isDark ? '#26a641' : '#30a14e',
  isDark ? '#39d353' : '#216e39',
];

const DashboardCardHeader = ({ title, icon: Icon, color = 'text.primary', mb = 2 }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb }}>
    {Icon ? (
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: '999px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'action.hover',
          color,
          flexShrink: 0,
        }}
      >
        <Icon sx={{ fontSize: 17 }} />
      </Box>
    ) : null}
    <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.02rem', letterSpacing: '-0.01em' }}>
      {title}
    </Typography>
  </Box>
);

const Profile = () => {
  const { t } = useTranslation();
  const { showError } = useError();
  const { notes, userAvatar, theme, primaryColor, setCurrentView, setSettingsTabValue, setTodoNavigationRequest, userName, christmasMode } = useStore();
  const [todoStats, setTodoStats] = useState(null);
  const [activityCounts, setActivityCounts] = useState(null);
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

        const todoStatsResult = await fetchTodoStats();

        if (todoStatsResult && typeof todoStatsResult === 'object') {
          setTodoStats(todoStatsResult);
        } else {
          console.error('[Profile] 待办统计数据格式错误:', todoStatsResult);
          setTodoStats(DEFAULT_TODO_STATS);
        }

        const pluginsResult = await fetchInstalledPlugins();
        if (Array.isArray(pluginsResult)) {
          setInstalledPlugins(pluginsResult);
        }

        // 加载基于变更日志的真实活动数据（精确到每天的编辑次数）
        const heatmapResult = await fetchActivityHeatmap(90);
        if (heatmapResult?.success && heatmapResult.data) {
          setActivityCounts(heatmapResult.data);
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
  const todoStatsDisplay = useMemo(() => ({ ...DEFAULT_TODO_STATS, ...(todoStats || {}) }), [todoStats]);

  const todayCompletionRate = Number.isFinite(todoStatsDisplay.todayCompletionRate)
    ? todoStatsDisplay.todayCompletionRate
    : null;
  const todayCompletionLabel = todayCompletionRate == null ? '--' : `${todayCompletionRate}%`;
  const todayCompletionValueLabel = todoStatsDisplay.todayWorkload > 0
    ? `${todoStatsDisplay.todayCompleted || 0} / ${todoStatsDisplay.todayWorkload || 0}`
    : '今日暂无任务';
  const todayCompletionMetaLabel = todoStatsDisplay.todayWorkload > 0
    ? `今日负载 ${todoStatsDisplay.todayWorkload || 0}`
    : '待有今日任务后开始计算';
  const onTimeRateLabel = todoStatsDisplay.completedWithDueDate > 0
    ? `${todoStatsDisplay.onTimeRate || 0}%`
    : '--';

  // 处理编辑资料按钮点击
  const handleEditProfile = () => {
    setSettingsTabValue(1);
    setCurrentView('settings');
  };

  const handleTodoFilterNavigation = (filterBy) => {
    setTodoNavigationRequest({
      filterBy,
      viewMode: 'focus',
      showCompleted: false,
    });
    setCurrentView('todo');
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

  // 卡片样式抽到 commonStyles，这里只绑定主题主色
  const profileHeroSx = heroCardSx;
  const profileCardSx = useMemo(() => createSoftGlassCardSx(primaryColor), [primaryColor]);
  const clickableCardSx = useMemo(() => ({
    ...profileCardSx,
    cursor: 'pointer',
    transition: `${PROFILE_TRANSITION}, transform 180ms ${PROFILE_EASING}`,
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: theme === 'dark'
        ? '0 18px 36px rgba(0,0,0,0.28)'
        : '0 18px 36px rgba(15,23,42,0.12)',
    },
    '&:active': {
      transform: 'translateY(0)',
    }
  }), [profileCardSx, theme]);

  // 计算笔记活动热力图数据（过去90天）
  // 优先使用后端变更日志的真实活动次数（精确到每天的编辑频次）；
  // 后端数据不可用时，回退到基于 created_at/updated_at 时间戳的近似估算。
  const getHeatmapData = () => {
    const days = 90;
    const today = new Date();
    const heatmapData = [];

    // 日期 -> 当天活动次数
    const dateCountMap = {};

    if (activityCounts) {
      // 后端已按本地日期分组，直接使用
      Object.assign(dateCountMap, activityCounts);
    } else {
      // 兜底：基于笔记时间戳（每条笔记每天最多计 1 次创建 + 1 次更新）
      notes.forEach(note => {
        if (note.is_deleted) return;
        if (note.created_at) {
          const key = formatLocalDateKey(new Date(note.created_at));
          dateCountMap[key] = (dateCountMap[key] || 0) + 1;
        }
        if (note.updated_at && note.updated_at !== note.created_at) {
          const key = formatLocalDateKey(new Date(note.updated_at));
          dateCountMap[key] = (dateCountMap[key] || 0) + 1;
        }
      });
    }

    // 生成过去90天的数据
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = formatLocalDateKey(date);
      const totalCount = dateCountMap[dateKey] || 0;
      heatmapData.push({
        date: dateKey,
        count: totalCount,
        level: totalCount === 0 ? 0 : totalCount <= 2 ? 1 : totalCount <= 5 ? 2 : totalCount <= 8 ? 3 : 4
      });
    }

    return heatmapData;
  };

  // 计算高频词统计
  const getTopWords = () => {
    const wordMap = {};
    notes.forEach(note => {
      if (!note.is_deleted && note.content) {
        // 简单的中文分词（匹配2-4个连续的中文字符）
        const matches = note.content.match(/[\u4e00-\u9fa5]{2,4}/g);
        if (matches) {
          matches.forEach(word => {
            if (!STOP_WORDS.has(word) && word.length >= 2) {
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

  const heatmapData = useMemo(() => getHeatmapData(), [notes, activityCounts]);
  const topWords = useMemo(() => getTopWords(), [notes]);
  const weeks = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < heatmapData.length; i += 7) {
      chunks.push(heatmapData.slice(i, i + 7));
    }
    return chunks;
  }, [heatmapData]);
  const heatmapColors = useMemo(() => getHeatmapColors(theme === 'dark'), [theme]);

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
      <Box sx={profileHeroSx}>
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
              transition: PROFILE_TRANSITION,
              filter: avatarHover ? 'brightness(1.06)' : 'brightness(1)',
              boxShadow: avatarHover
                ? '0 0 0 3px rgba(255,255,255,0.12), 0 12px 28px rgba(15,23,42,0.18)'
                : '0 0 0 0 rgba(255,255,255,0), 0 4px 14px rgba(15,23,42,0.10)',
              '&:hover': {
                filter: 'brightness(1.06)'
              },
              '&:active': {
                filter: 'brightness(0.96)'
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
        >
          {t('profile.editProfile')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          columnCount: {
            xs: 1,
            sm: 2,
            md: 3,
            lg: 4,
          },
          columnGap: 3,
          '& > *': {
            breakInside: 'avoid',
            marginBottom: 3,
          }
        }}
      >
        <Card sx={profileCardSx}>
          <CardContent>
            <DashboardCardHeader title="待办事项" icon={CheckCircleIcon} color="success.main" mb={1.25} />
            <UsageWaveCard
              title="今日完成率"
              accentColor={primaryColor}
              valueLabel={todayCompletionValueLabel}
              metaLabel={todayCompletionMetaLabel}
              percent={todayCompletionRate}
              percentLabel={todayCompletionLabel}
              compact
              segments={[
                { label: '今日到期', value: todoStatsDisplay.dueToday || 0 },
                { label: '已逾期', value: todoStatsDisplay.overdue || 0 },
              ]}
            />
            <Box sx={{ mt: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography variant="caption" color="text.secondary">按时完成率</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {onTimeRateLabel}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={todoStatsDisplay.completedWithDueDate > 0 ? todoStatsDisplay.onTimeRate || 0 : 0}
                sx={{
                  height: 7,
                  borderRadius: 999,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: 'info.main',
                    borderRadius: 999,
                  }
                }}
              />
            </Box>
          </CardContent>
        </Card>

        <Card sx={clickableCardSx} onClick={() => handleTodoFilterNavigation('today')}>
          <CardContent>
            <DashboardCardHeader title="今日待办" icon={TodayIcon} color="info.main" />
            <Typography variant="h3" sx={{ mb: 1.25, fontWeight: 600, color: 'info.main' }}>
              {todoStatsDisplay.dueToday}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              今日到期待处理
            </Typography>
            <Chip
              label={todoStatsDisplay.dueToday > 0 ? '点击查看今日筛选' : '点击查看今日列表'}
              size="small"
              color={todoStatsDisplay.dueToday > 0 ? 'info' : 'success'}
              variant={todoStatsDisplay.dueToday > 0 ? 'filled' : 'outlined'}
              sx={{ width: '100%' }}
            />
          </CardContent>
        </Card>

        <Card sx={clickableCardSx} onClick={() => handleTodoFilterNavigation('overdue')}>
          <CardContent>
            <DashboardCardHeader title="逾期待办" icon={WarningIcon} color="error.main" />
            <Typography variant="h3" sx={{ mb: 1.25, fontWeight: 600, color: 'error.main' }}>
              {todoStatsDisplay.overdue}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              仍需补处理的任务
            </Typography>
            <Chip
              label={todoStatsDisplay.overdue > 0 ? '点击查看逾期筛选' : '点击查看逾期列表'}
              size="small"
              color={todoStatsDisplay.overdue > 0 ? 'error' : 'success'}
              variant={todoStatsDisplay.overdue > 0 ? 'filled' : 'outlined'}
              sx={{ width: '100%' }}
            />
          </CardContent>
        </Card>

        <Card sx={profileCardSx}>
          <CardContent>
            <DashboardCardHeader title="笔记概览" icon={NotesIcon} color={primaryColor} />
            <Typography variant="h3" sx={{ mb: 1.25, fontWeight: 600, color: primaryColor }}>
              {noteStats.active}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              当前可见笔记
            </Typography>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">总笔记数</Typography>
                <Chip label={noteStats.total} size="small" variant="outlined" />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">置顶笔记</Typography>
                <Chip label={noteStats.pinned} size="small" color="primary" variant={noteStats.pinned > 0 ? 'filled' : 'outlined'} />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">已删除</Typography>
                <Chip label={noteStats.deleted} size="small" color="error" variant={noteStats.deleted > 0 ? 'filled' : 'outlined'} />
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card sx={profileCardSx}>
          <CardContent>
            <DashboardCardHeader title="专注时长" icon={TrendingUpIcon} color="primary.main" />
            <Typography variant="h3" sx={{ mb: 1.25, fontWeight: 600, color: 'primary.main' }}>
              {TimeZoneUtils.formatSeconds(todoStatsDisplay.todayFocusTime || 0)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              今日专注
            </Typography>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">本周</Typography>
                <Chip label={TimeZoneUtils.formatSeconds(todoStatsDisplay.weekFocusTime || 0)} size="small" color="info" variant={(todoStatsDisplay.weekFocusTime || 0) > 0 ? 'filled' : 'outlined'} />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">本月</Typography>
                <Chip label={TimeZoneUtils.formatSeconds(todoStatsDisplay.monthFocusTime || 0)} size="small" color="secondary" variant={(todoStatsDisplay.monthFocusTime || 0) > 0 ? 'filled' : 'outlined'} />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">累计</Typography>
                <Chip label={TimeZoneUtils.formatSeconds(todoStatsDisplay.totalFocusTime || 0)} size="small" variant="outlined" />
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card sx={profileCardSx}>
          <CardContent>
            <DashboardCardHeader title="笔记活动热力图" icon={CalendarMonthIcon} color={primaryColor} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              过去 90 天的笔记创建与更新
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, overflowX: 'auto', overflowY: 'hidden', pb: 1 }}>
                {weeks.map((week, weekIndex) => (
                  <Box key={weekIndex} sx={{ display: 'flex', gap: 0.5 }}>
                    {week.map((day, dayIndex) => (
                      <Tooltip
                        key={dayIndex}
                        title={
                          <Box>
                            <Typography variant="caption" display="block">{day.date}</Typography>
                            <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>
                              {day.count} 次活动
                            </Typography>
                          </Box>
                        }
                        placement="top"
                      >
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            backgroundColor: heatmapColors[day.level],
                            borderRadius: '2px',
                            cursor: 'pointer',
                            border: '1px solid transparent',
                            transition: PROFILE_TRANSITION,
                            '&:hover': {
                              filter: 'brightness(1.12)',
                              borderColor: theme === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.18)',
                              boxShadow: theme === 'dark'
                                ? '0 0 0 2px rgba(255,255,255,0.06)'
                                : '0 0 0 2px rgba(15,23,42,0.05)'
                            }
                          }}
                        />
                      </Tooltip>
                    ))}
                  </Box>
                ))}
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, pt: 0.25 }}>
                <Typography variant="caption" color="text.secondary">少</Typography>
                {heatmapColors.map((color, level) => (
                  <Box
                    key={level}
                    sx={{
                      width: 12,
                      height: 12,
                      backgroundColor: color,
                      borderRadius: '2px'
                    }}
                  />
                ))}
                <Typography variant="caption" color="text.secondary">多</Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>

        <Card sx={profileCardSx}>
          <CardContent>
            <DashboardCardHeader title="高频词" icon={TagIcon} color="info.main" />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              最近笔记里最常出现的主题词
            </Typography>
            {topWords.length > 0 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {topWords.slice(0, 10).map((item, index) => (
                  <Tooltip key={item.word} title={`出现 ${item.count} 次`} placement="top">
                    <Chip
                      label={`${item.word} ${item.count}`}
                      size="small"
                      variant={index < 3 ? 'filled' : 'outlined'}
                      color={index < 3 ? 'info' : 'default'}
                      sx={{
                        fontWeight: index < 3 ? 600 : 500,
                        transition: PROFILE_TRANSITION,
                        '&:hover': {
                          boxShadow: theme === 'dark'
                            ? '0 6px 18px rgba(0,0,0,0.22)'
                            : '0 6px 18px rgba(15,23,42,0.10)'
                        }
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                暂无可提炼的高频词
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card sx={profileCardSx}>
          <CardContent>
            <DashboardCardHeader title="插件" icon={ExtensionIcon} color={primaryColor} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              已安装 {installedPlugins.length} 个扩展
            </Typography>
            {installedPlugins.length > 0 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {installedPlugins.slice(0, 4).map((plugin) => (
                  <Chip
                    key={plugin.id}
                    label={plugin.manifest?.name || plugin.id}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.72rem' }}
                  />
                ))}
                {installedPlugins.length > 4 ? (
                  <Chip
                    label={`+${installedPlugins.length - 4}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                ) : null}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无已安装插件
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default Profile;
