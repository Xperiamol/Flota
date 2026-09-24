/**
 * 时区处理工具类
 * 统一处理时间转换、比较和格式化，解决时区相关问题
 */
// 全天待办以纯日期 "YYYY-MM-DD" 存储，不是 UTC 时间戳：需按本地日期理解，且没有时刻可显示
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (value) => typeof value === 'string' && DATE_ONLY_RE.test(value.trim());
const parseLocalDateOnly = (value) => {
  const [y, m, d] = value.trim().split('-').map(Number);
  return new Date(y, m - 1, d);
};

class TimeZoneUtils {
  /**
   * 将本地时间字符串转换为UTC ISO字符串（用于数据库存储）
   * @param {string} localDateTimeString - 本地时间字符串，格式如 '2024-01-15T14:30:00'
   * @returns {string} UTC ISO字符串
   */
  static localToUTC(localDateTimeString) {
    if (!localDateTimeString) return null;
    
    try {
      // 创建本地时间的Date对象
      const localDate = new Date(localDateTimeString);
      
      // 检查日期是否有效
      if (isNaN(localDate.getTime())) {
        console.warn('无效的日期时间字符串:', localDateTimeString);
        return null;
      }
      
      // 返回UTC ISO字符串
      return localDate.toISOString();
    } catch (error) {
      console.error('本地时间转UTC时出错:', error, localDateTimeString);
      return null;
    }
  }

  /**
   * 将UTC ISO字符串转换为本地时间字符串（用于前端显示）
   * @param {string} utcISOString - UTC ISO字符串
   * @returns {string} 本地时间字符串，格式如 '2024-01-15T14:30:00'
   */
  static utcToLocal(utcISOString) {
    if (!utcISOString) return '';
    
    try {
      const utcDate = new Date(utcISOString);
      
      // 检查日期是否有效
      if (isNaN(utcDate.getTime())) {
        console.warn('无效的UTC ISO字符串:', utcISOString);
        return '';
      }
      
      // 获取本地时间的年月日时分秒
      const year = utcDate.getFullYear();
      const month = String(utcDate.getMonth() + 1).padStart(2, '0');
      const day = String(utcDate.getDate()).padStart(2, '0');
      const hours = String(utcDate.getHours()).padStart(2, '0');
      const minutes = String(utcDate.getMinutes()).padStart(2, '0');
      const seconds = String(utcDate.getSeconds()).padStart(2, '0');
      
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    } catch (error) {
      console.error('UTC转本地时间时出错:', error, utcISOString);
      return '';
    }
  }

  /**
   * 获取当前本地时间的UTC ISO字符串
   * @returns {string} 当前时间的UTC ISO字符串
   */
  static nowUTC() {
    return new Date().toISOString();
  }

  /**
   * 获取今天开始时间的UTC ISO字符串（00:00:00）
   * @returns {string} 今天开始时间的UTC ISO字符串
   */
  static todayStartUTC() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return todayStart.toISOString();
  }

  /**
   * 获取今天结束时间的UTC ISO字符串（23:59:59.999）
   * @returns {string} 今天结束时间的UTC ISO字符串
   */
  static todayEndUTC() {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return todayEnd.toISOString();
  }

  /**
   * 获取指定分钟后的UTC ISO字符串
   * @param {number} minutes - 分钟数
   * @returns {string} 指定分钟后的UTC ISO字符串
   */
  static addMinutesUTC(minutes) {
    const now = new Date();
    const future = new Date(now.getTime() + minutes * 60 * 1000);
    return future.toISOString();
  }

  /**
   * 比较两个时间字符串（都应该是UTC ISO格式）
   * @param {string} time1 - 时间1（UTC ISO字符串）
   * @param {string} time2 - 时间2（UTC ISO字符串）
   * @returns {number} -1: time1 < time2, 0: time1 = time2, 1: time1 > time2
   */
  static compareUTC(time1, time2) {
    if (!time1 || !time2) {
      if (!time1 && !time2) return 0;
      return !time1 ? -1 : 1;
    }
    
    try {
      const date1 = new Date(time1);
      const date2 = new Date(time2);
      
      if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
        console.warn('比较时间时发现无效日期:', { time1, time2 });
        return 0;
      }
      
      if (date1.getTime() < date2.getTime()) return -1;
      if (date1.getTime() > date2.getTime()) return 1;
      return 0;
    } catch (error) {
      console.error('比较时间时出错:', error, { time1, time2 });
      return 0;
    }
  }

  /**
   * 检查时间是否已过期（与当前时间比较）
   * @param {string} utcISOString - UTC ISO时间字符串
   * @returns {boolean} 是否已过期
   */
  static isOverdue(utcISOString) {
    if (!utcISOString) return false;
    if (isDateOnly(utcISOString)) {
      // 全天待办要过完当天才算逾期
      const endOfDay = parseLocalDateOnly(utcISOString);
      endOfDay.setDate(endOfDay.getDate() + 1);
      return endOfDay <= new Date();
    }
    return this.compareUTC(utcISOString, this.nowUTC()) < 0;
  }

  /**
   * 检查时间是否是今天
   * @param {string} utcISOString - UTC ISO时间字符串
   * @returns {boolean} 是否是今天
   */
  static isToday(utcISOString) {
    if (!utcISOString) return false;
    
    try {
      const date = isDateOnly(utcISOString) ? parseLocalDateOnly(utcISOString) : new Date(utcISOString);
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
   * 检查时间是否在指定分钟内到期
   * @param {string} utcISOString - UTC ISO时间字符串
   * @param {number} minutes - 分钟数
   * @returns {boolean} 是否在指定分钟内到期
   */
  static isDueSoon(utcISOString, minutes = 60) {
    if (!utcISOString) return false;
    
    const now = this.nowUTC();
    const soonTime = this.addMinutesUTC(minutes);
    
    return this.compareUTC(utcISOString, now) > 0 && 
           this.compareUTC(utcISOString, soonTime) <= 0;
  }

  /**
   * 格式化时间显示（用于通知等）
   * @param {string} utcISOString - UTC ISO时间字符串
   * @returns {string} 格式化后的时间字符串
   */
  static formatForDisplay(utcISOString) {
    if (!utcISOString) return '';
    
    try {
      const allDay = isDateOnly(utcISOString);
      const date = allDay ? parseLocalDateOnly(utcISOString) : new Date(utcISOString);
      const now = new Date();
      // 全天待办只显示日期，不显示时刻
      const withTime = (label) => (allDay ? label : `${label} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
      
      // 检查是否是今天
      if (this.isToday(utcISOString)) {
        return withTime('今天');
      }
      
      // 检查是否是明天
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (date.getFullYear() === tomorrow.getFullYear() &&
          date.getMonth() === tomorrow.getMonth() &&
          date.getDate() === tomorrow.getDate()) {
        return withTime('明天');
      }
      
      // 检查是否是昨天
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.getFullYear() === yesterday.getFullYear() &&
          date.getMonth() === yesterday.getMonth() &&
          date.getDate() === yesterday.getDate()) {
        return withTime('昨天');
      }
      
      // 其他日期
      if (allDay) return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('格式化时间显示时出错:', error, utcISOString);
      return '';
    }
  }

  /**
   * 从前端日期时间输入创建UTC ISO字符串
   * @param {string} dateString - 日期字符串，格式如 '2024-01-15'
   * @param {string} timeString - 时间字符串，格式如 '14:30' 或空字符串
   * @returns {string} UTC ISO字符串
   */
  static fromDateTimeInput(dateString, timeString = '') {
    if (!dateString) return null;
    
    try {
      // 如果没有时间，默认为 00:00:00
      const time = timeString || '00:00';
      const localDateTime = `${dateString}T${time}:00`;
      
      return this.localToUTC(localDateTime);
    } catch (error) {
      console.error('从日期时间输入创建UTC时间时出错:', error, { dateString, timeString });
      return null;
    }
  }

  /**
   * 将UTC ISO字符串转换为前端日期时间输入格式
   * @param {string} utcISOString - UTC ISO字符串
   * @returns {Object} { date: '2024-01-15', time: '14:30' }
   */
  static toDateTimeInput(utcISOString) {
    if (!utcISOString) return { date: '', time: '' };
    
    try {
      const localDateTime = this.utcToLocal(utcISOString);
      if (!localDateTime) return { date: '', time: '' };
      
      const [datePart, timePart] = localDateTime.split('T');
      const time = timePart ? timePart.substring(0, 5) : ''; // 只取 HH:mm 部分
      
      return {
        date: datePart || '',
        time: time || ''
      };
    } catch (error) {
      console.error('转换为日期时间输入格式时出错:', error, utcISOString);
      return { date: '', time: '' };
    }
  }

  /**
   * 调试用：打印时间信息
   * @param {string} label - 标签
   * @param {string} utcISOString - UTC ISO字符串
   */
  static debug(label, utcISOString) {
    if (!utcISOString) {
      console.log(`[TimeZone Debug] ${label}: null/empty`);
      return;
    }
    
    try {
      const utcDate = new Date(utcISOString);
      const localDateTime = this.utcToLocal(utcISOString);
      
      console.log(`[TimeZone Debug] ${label}:`);
      console.log(`  - UTC ISO: ${utcISOString}`);
      console.log(`  - UTC Date: ${utcDate.toUTCString()}`);
      console.log(`  - Local Date: ${utcDate.toString()}`);
      console.log(`  - Local DateTime: ${localDateTime}`);
      console.log(`  - Is Today: ${this.isToday(utcISOString)}`);
      console.log(`  - Is Overdue: ${this.isOverdue(utcISOString)}`);
      console.log(`  - Display: ${this.formatForDisplay(utcISOString)}`);
    } catch (error) {
      console.error(`[TimeZone Debug] ${label} - Error:`, error);
    }
  }
}

module.exports = TimeZoneUtils;