import { useEffect } from 'react';
import { useError } from '../components/common/ErrorProvider';

/**
 * 插件通知监听器
 * 监听插件发出的通知事件，并显示在用户界面上
 */
export function PluginNotificationListener() {
  const { showError, showWarning, showSuccess, showInfo } = useError();

  useEffect(() => {
    const handlePluginNotification = ({ pluginId, payload }) => {
      const { title, body, type = 'info' } = payload || {};
      const message = title ? `${title}: ${body}` : body;

      switch (type) {
        case 'error':
          showError(new Error(body), title || '插件错误');
          break;
        case 'warning':
          showWarning(message);
          break;
        case 'success':
          showSuccess(message);
          break;
        case 'info':
        default:
          showInfo(message);
          break;
      }
    };

    // 监听插件通知事件
    const unsubscribe = window.electronAPI?.pluginStore?.onNotification?.(handlePluginNotification);

    return () => {
      unsubscribe?.();
    };
  }, [showError, showWarning, showSuccess, showInfo]);

  return null;
}
