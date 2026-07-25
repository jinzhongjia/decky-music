// 页签切换 + 初始焦点状态。纯状态机与 React/Valve 导航解耦，便于验证：
// 切到新页面时允许其主要控件取一次初始焦点；用户在等待异步内容时产生其他输入后取消，
// 防止迟到的卡片或列表把焦点从用户当前所在位置抢回去。
// 顶层页签（AppShell，L1/R1）与二级页签（SecondaryTabs，L2/R2）共用这一份，
// 差别只在初始的 allowInitialFocus：顶层进页面即允许，二级由调用方按场景决定。
// React 侧封装见 ui/AppShell 的 useTabCycle。

export type PageFocusState = {
  activeId: string;
  allowInitialFocus: boolean;
};

export function createPageFocusState(activeId: string, allowInitialFocus = true): PageFocusState {
  return { activeId, allowInitialFocus };
}

export function selectPage(state: PageFocusState, activeId: string): PageFocusState {
  if (activeId === state.activeId) return state;
  return { activeId, allowInitialFocus: true };
}

export function cyclePage(
  state: PageFocusState,
  tabs: readonly { id: string }[],
  delta: -1 | 1
): PageFocusState {
  if (tabs.length === 0) return state;
  const current = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === state.activeId)
  );
  const activeId = tabs[(current + delta + tabs.length) % tabs.length].id;
  return { activeId, allowInitialFocus: true };
}

export function cancelInitialFocus(state: PageFocusState): PageFocusState {
  return state.allowInitialFocus ? { ...state, allowInitialFocus: false } : state;
}
