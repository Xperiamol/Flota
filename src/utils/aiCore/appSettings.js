import definitions from '../../../electron/services/aichat/settingsCatalog.json'
import { useStore } from '../../store/useStore'
import { usePrefsStore } from '../../store/usePrefsStore'

export const getAppSettingsSnapshot = () => Object.fromEntries(definitions.filter(item => item.store !== 'database').map(item => [
  item.key, (item.store === 'prefs' ? usePrefsStore : useStore).getState()[item.key],
]))

export const applyAISettings = async changes => {
  const database = Object.fromEntries(changes.filter(change => definitions.find(item => item.key === change.key)?.store !== 'prefs').map(change => [change.key, change.value]))
  if (Object.keys(database).length) {
    const result = await window.electronAPI.settings.setMultiple(database)
    if (!result?.success) throw new Error(result?.error || '保存设置失败')
  }
  for (const { key, value } of changes) {
    const setting = definitions.find(item => item.key === key)
    if (setting?.store === 'prefs') usePrefsStore.getState().setPref(key, value)
    else if (setting?.store === 'app') useStore.getState()[`set${key[0].toUpperCase()}${key.slice(1)}`](value)
  }
  window.dispatchEvent(new Event('flota:settings-updated'))
}
