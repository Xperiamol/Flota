/**
 * 前端时区处理工具类
 * 与后端TimeZoneUtils配合，处理前端的时区转换
 */
// 全天待办以纯日期 "YYYY-MM-DD" 存储（后端 has_time=0）。它不是 UTC 时间戳：
// new Date('2026-09-27') 会按 UTC 零点解析，在东八区变成 08:00，在西半球还会错到前一天。
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (value) => typeof value === 'string' && DATE_ONLY_RE.test(value.trim());
const parseLocalDateOnly = (value) => {
  const [y, m, d] = value.trim().split('-').map(Number);
  return new Date(y, m - 1, d);
};
// 统一的解析入口：纯日期按本地日期，其余按时间戳
const toDate = (value) => (isDateOnly(value) ? parseLocalDateOnly(value) : new Date(value));

class TimeZoneUtils {
  static isDateOnly(value) {
    return isDateOnly(value);
  }

  /**
   * 将本地日期时间转换为UTC ISO字符串（发送给后端）
   * @param {string} dateString - 日期字符串，格式如 '2024-01-15'
   * @param {string} timeString - 时间字符串，格式如 '14:30' 或空字符串
   * @returns {string|null} UTC ISO字符串
   */
  static toUTC(dateString, timeString = '') {
    if (!dateString) return null;
    
    // 没填时间 = 全天待办：保持纯日期，不能转成"零点"时间戳（否则后端会把它判为定时待办）
    if (!timeString && isDateOnly(dateString)) return dateString.trim();

    try {
      const time = timeString || '00:00';
      const localDateTime = `${dateString}T${time}:00`;
      
      // 创建本地时间的Date对象
      const localDate = new Date(localDateTime);
      
      // 检查日期是否有效
      if (isNaN(localDate.getTime())) {
        console.warn('无效的日期时间:', { dateString, timeString });
        return null;
      }
      
      // 返回UTC ISO字符串
      return localDate.toISOString();
    } catch (error) {
      console.error('转换为UTC时出错:', error, { dateString, timeString });
      return null;
    }
  }

  /**
   * 将UTC ISO字符串转换为本地日期时间（从后端接收）
   * @param {string} utcISOString - UTC ISO字符串
   * @returns {Object} { date: '2024-01-15', time: '14:30' }
   */
  static fromUTC(utcISOString) {
    if (!utcISOString) return { date: '', time: '' };
    if (isDateOnly(utcISOString)) return { date: utcISOString.trim(), time: '' };
    
    try {
      const utcDate = new Date(utcISOString);
      
      // 检查日期是否有效
      if (isNaN(utcDate.getTime())) {
        console.warn('无效的UTC ISO字符串:', utcISOString);
        return { date: '', time: '' };
      }
      
      // 获取本地时间的年月日时分秒
      const year = utcDate.getFullYear();
      const month = String(utcDate.getMonth() + 1).padStart(2, '0');
      const day = String(utcDate.getDate()).padStart(2, '0');
      const hours = String(utcDate.getHours()).padStart(2, '0');
      const minutes = String(utcDate.getMinutes()).padStart(2, '0');
      
      const date = `${year}-${month}-${day}`;
      const time = `${hours}:${minutes}`;
      
      return { date, time };
    } catch (error) {
      console.error('从UTC转换时出错:', error, utcISOString);
      return { date: '', time: '' };
    }
  }

  /**
   * 检查UTC时间是否已过期
   * @param {string} utcISOString - UTC ISO时间字符串
   * @returns {boolean} 是否已过期
   */
  static isOverdue(utcISOString) {
    if (!utcISOString) return false;
    
    try {
      const now = new Date();
      if (isDateOnly(utcISOString)) {
        // 全天待办当天之内都不算逾期
        const endOfDay = parseLocalDateOnly(utcISOString);
        endOfDay.setDate(endOfDay.getDate() + 1);
        return endOfDay <= now;
      }
      const dueDate = new Date(utcISOString);
      return dueDate < now;
    } catch (error) {
      console.error('检查是否过期时出错:', error, utcISOString);
      return false;
    }
  }

  /**
   * 检查UTC时间是否是今天
   * @param {string} utcISOString - UTC ISO时间字符串
   * @returns {boolean} 是否是今天
   */
  static isToday(utcISOString) {
    if (!utcISOString) return false;
    
    try {
      const date = toDate(utcISOString);
      const now = new Date();
      
      return date.getFullYear() === now.getFullYear() &&
             date.getMonth() === now.getMonth() &&
             date.getDate() === now.getDate();
    } catch (error) {
      console.error('检查是否今天时出错:', error, utcISOString);
      return false;
    }
  }

  /**
   * 格式化UTC时间为显示字符串
   * @param {string} utcISOString - UTC ISO时间字符串
   * @param {Object} options - 格式化选项
   * @returns {string} 格式化后的时间字符串
   */
  static formatForDisplay(utcISOString, options = {}) {
    if (!utcISOString) return '';
    
    try {
      const date = toDate(utcISOString);
      const now = new Date();
      
      const { shortFormat = false } = options;
      // 全天待办没有时刻可显示
      const showTime = (options.showTime ?? true) && !isDateOnly(utcISOString);
      
      // 检查是否是今天
      if (this.isToday(utcISOString)) {
        if (showTime) {
          return `今天 ${date.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`;
        } else {
          return '今天';
        }
      }
      
      // 检查是否是明天
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (date.getFullYear() === tomorrow.getFullYear() &&
          date.getMonth() === tomorrow.getMonth() &&
          date.getDate() === tomorrow.getDate()) {
        if (showTime) {
          return `明天 ${date.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`;
        } else {
          return '明天';
        }
      }
      
      // 检查是否是昨天
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.getFullYear() === yesterday.getFullYear() &&
          date.getMonth() === yesterday.getMonth() &&
          date.getDate() === yesterday.getDate()) {
        if (showTime) {
          return `昨天 ${date.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`;
        } else {
          return '昨天';
        }
      }
      
      // 其他日期
      if (shortFormat) {
        if (showTime) {
          return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        } else {
          return date.toLocaleDateString('zh-CN', {
            month: '2-digit',
            day: '2-digit'
          });
        }
      } else {
        if (showTime) {
          return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        } else {
          return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        }
      }
    } catch (error) {
      console.error('格式化时间显示时出错:', error, utcISOString);
      return '';
    }
  }

  /**
   * 检查时间字符串是否包含时间部分（不是00:00:00）
   * @param {string} utcISOString - UTC ISO时间字符串
   * @returns {boolean} 是否包含有效时间
   */
  static hasTime(utcISOString) {
    if (!utcISOString) return false;
    
    if (isDateOnly(utcISOString)) return false;
    try {
      const date = new Date(utcISOString);
      return date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;
    } catch (error) {
      console.error('检查是否有时间时出错:', error, utcISOString);
      return false;
    }
  }

  /**
   * 获取今天的日期字符串（本地时区）
   * @returns {string} 格式如 '2024-01-15'
   */
  static getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 格式化秒数为时分秒格式
   * @param {number} seconds - 秒数
   * @returns {string} 格式化后的时间字符串，如 "01:23:45" 或 "12:34"
   */
  static formatSeconds(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    const hh = hrs > 0 ? `${String(hrs).padStart(2, '0')}:` : '';
    return `${hh}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
}

export default TimeZoneUtils;