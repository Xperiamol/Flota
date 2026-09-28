/**
 * 输入法（拼音等）组字时按回车是在确认候选词，不能当成「发送 / 提交」。
 * 同时兼容 React 合成事件和原生事件；Safari/旧 Chromium 组字期间 keyCode 为 229。
 */
export const isImeComposing = (event) => Boolean(
  event?.isComposing || event?.nativeEvent?.isComposing || event?.keyCode === 229
)
