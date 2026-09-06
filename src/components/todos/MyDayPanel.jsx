import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Chip
} from '@mui/material';
import {
  Today as TodayIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon
} from '../common/AppIcons';
import { format, isToday } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import TodoList from './TodoList';
import { fetchTodos } from '../../api/todoAPI';
import { isTodoCompletedOnDate, isTodoInDateInstance } from '../../utils/todoDisplayUtils';
import { compactGlassPanelSx } from '../../styles/commonStyles';

const MyDayPanel = ({
  selectedDate,
  onTodoSelect,
  refreshToken = 0,
  onTodoUpdated,
  showCompleted = false,
  onMultiSelectChange,
  onMultiSelectRefChange
}) => {
  const [todayTodos, setTodayTodos] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
    urgent: 0
  });

  // 获取指定日期的Todo
  const loadTodos = async (date = null) => {
    try {
      const allTodos = await fetchTodos({ includeCompleted: true });
      // 过滤出指定日期或今日的任务，使用与CalendarView相同的过滤逻辑
      const targetDate = date || new Date();

      const filteredTodos = allTodos.filter(todo => {
        const inDateInstance = isTodoInDateInstance(todo, targetDate);

        if (!showCompleted) {
          return inDateInstance && !isTodoCompletedOnDate(todo, targetDate);
        }

        return inDateInstance;
      });
      
      // 按优先级排序：重要且紧急 > 重要不紧急 > 不重要紧急 > 不重要不紧急
      const sortedTodos = filteredTodos.sort((a, b) => {
        const getPriority = (todo) => {
          if (todo.is_important && todo.is_urgent) return 4;
          if (todo.is_important) return 3;
          if (todo.is_urgent) return 2;
          return 1;
        };
        return getPriority(b) - getPriority(a);
      });
      
      // 计算统计信息
      const total = sortedTodos.length;
      const completed = sortedTodos.filter(todo => isTodoCompletedOnDate(todo, targetDate)).length;
      const pending = total - completed;
      const urgent = sortedTodos.filter(todo => todo.is_urgent && !isTodoCompletedOnDate(todo, targetDate)).length;
      
      setTodayTodos(sortedTodos);
      setStats({ total, completed, pending, urgent });
    } catch (error) {
      console.error('获取Todo失败:', error);
    }
  };

  useEffect(() => {
    loadTodos(selectedDate);
    
    // 每分钟刷新一次数据
    const interval = setInterval(() => loadTodos(selectedDate), 60000);
    
    return () => clearInterval(interval);
  }, [selectedDate, refreshToken, showCompleted]);

  const targetDate = selectedDate || new Date();
  const formattedDate = format(targetDate, 'MM月dd日', { locale: zhCN });
  const headerText = `${formattedDate}${isToday(targetDate) ? ' - 今天' : ''}`;

  return (
    <Box sx={(theme) => ({ ...compactGlassPanelSx(theme), p: 0 })}>
      {/* 头部信息 */}
      <Box 
        sx={{ 
          px: 1.25,
          pt: 1,
          pb: 0.875,
          borderBottom: 1, 
          borderColor: 'divider'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 750, lineHeight: 1.3 }}>
            {headerText}
          </Typography>
        </Box>
        
        {/* 统计信息 */}
        <Box sx={{ display: 'flex', gap: 0.625, flexWrap: 'wrap' }}>
          <Chip
            icon={<TodayIcon />}
            label={`总计 ${stats.total}`}
            size="small"
            color="default"
            variant="outlined"
            sx={{ height: 24, borderRadius: '8px', fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 15 } }}
          />
          <Chip
            icon={<CheckCircleIcon />}
            label={`已完成 ${stats.completed}`}
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 24, borderRadius: '8px', fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 15 } }}
          />
          <Chip
            icon={<ScheduleIcon />}
            label={`待办 ${stats.pending}`}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ height: 24, borderRadius: '8px', fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 15 } }}
          />
          {stats.urgent > 0 && (
            <Chip
              icon={<WarningIcon />}
              label={`紧急 ${stats.urgent}`}
              size="small"
              color="error"
              variant="outlined"
              sx={{ height: 24, borderRadius: '8px', fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 15 } }}
            />
          )}
        </Box>
      </Box>

      {/* 任务列表 */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <TodoList
          externalTodos={todayTodos}
          isExternalData={true}
          showCompleted={showCompleted}
          onTodoSelect={onTodoSelect}
          viewMode="list"
          sortBy="createdAt"
          onTodoUpdated={onTodoUpdated}
          onMultiSelectChange={onMultiSelectChange}
          onMultiSelectRefChange={onMultiSelectRefChange}
        />
      </Box>
    </Box>
  );
};

export default MyDayPanel;
