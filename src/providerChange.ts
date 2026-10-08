import type { Provider } from "./api";

// 当前音源变化的前端内通知:QAM 切源 / 清除数据成功后广播,已打开的大屏页据此换成对应 app。
// QAM 与大屏页同在 Decky 的共享 JS 上下文,模块级订阅即可,不经 bridge 往返。
type Listener = (provider: Provider) => void;

const listeners = new Set<Listener>();

export function announceProvider(provider: Provider): void {
  for (const listener of [...listeners]) {
    try {
      listener(provider);
    } catch (e) {
      // 单个订阅者出错不能挡住其他订阅者,也不能让 QAM 的切源流程抛出
      console.error("[decky-music] provider listener failed", e);
    }
  }
}

/** 订阅音源变化,返回退订函数(组件卸载时调用)。 */
export function onProviderChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
