import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Chip,
  CircularProgress
} from '@mui/material';
import {
  Today as TodayIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import { format, isToday } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import TodoList from './TodoList';
import { fetchTodos } from '../api/todoAPI';
import { isTodoCompleted } from '../utils/todoDisplayUtils';

const MyDayPanel = ({ selectedDate, onTodoSelect, refreshToken = 0, onTodoUpdated }) => {
  const [todayTodos, setTodayTodos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
    urgent: 0
  });

  // 获取指定日期的Todo
  const loadTodos = async (date = null) => {
    setLoading(true);
    try {
      const allTodos = await fetchTodos({ includeCompleted: true });
      // 过滤出指定日期或今日的任务，使用与CalendarView相同的过滤逻辑
      const targetDate = date || new Date();
      const filteredTodos = allTodos.filter(todo => {
        if (!todo.due_date) return false;
        
        const todoDate = new Date(todo.due_date);
        return todoDate.toDateString() === targetDate.toDateString();
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
      const completed = sortedTodos.filter(todo => isTodoCompleted(todo)).length;
      const pending = total - completed;
      const urgent = sortedTodos.filter(todo => todo.is_urgent && !isTodoCompleted(todo)).length;
      
      setTodayTodos(sortedTodos);
      setStats({ total, completed, pending, urgent });
    } catch (error) {
      console.error('获取Todo失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTodos(selectedDate);
    
    // 每分钟刷新一次数据
    const interval = setInterval(() => loadTodos(selectedDate), 60000);
    
    return () => clearInterval(interval);
  }, [selectedDate, refreshToken]);

  const targetDate = selectedDate || new Date();
  const formattedDate = format(targetDate, 'MM月dd日', { locale: zhCN });
  const headerText = `${formattedDate}${isToday(targetDate) ? ' - 今天' : ''}`;

  return (
    <Box sx={(theme) => ({ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      backgroundColor: theme.palette.mode === 'dark'
        ? 'rgba(30, 41, 59, 0.85)'
        : 'rgba(255, 255, 255, 0.85)',
      backdropFilter: 'blur(12px) saturate(150%)',
      WebkitBackdropFilter: 'blur(12px) saturate(150%)'
    })}>
      {/* 头部信息 */}
      <Box 
        sx={{ 
          p: 2, 
          borderBottom: 1, 
          borderColor: 'divider'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {headerText}
          </Typography>
        </Box>
        
        {/* 统计信息 */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            icon={<TodayIcon />}
            label={`总计 ${stats.total}`}
            size="small"
            color="default"
            variant="outlined"
          />
          <Chip
            icon={<CheckCircleIcon />}
            label={`已完成 ${stats.completed}`}
            size="small"
            color="success"
            variant="outlined"
          />
          <Chip
            icon={<ScheduleIcon />}
            label={`待办 ${stats.pending}`}
            size="small"
            color="primary"
            variant="outlined"
          />
          {stats.urgent > 0 && (
            <Chip
              icon={<WarningIcon />}
              label={`紧急 ${stats.urgent}`}
              size="small"
              color="error"
              variant="outlined"
            />
          )}
        </Box>
      </Box>

      {/* 任务列表 */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <TodoList
          externalTodos={todayTodos}
          isExternalData={true}
          showCompleted={false}
          onTodoSelect={onTodoSelect}
          viewMode="list"
          sortBy="createdAt"
          onTodoUpdated={onTodoUpdated}
        />
      </Box>
    </Box>
  );
};

export default MyDayPanel;