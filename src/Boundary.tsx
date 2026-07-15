import { Component, ReactNode } from "react";

import { t } from "./i18n";

// 自套 ErrorBoundary(纵深防御):子树渲染出错时显示降级 UI,不拖垮宿主 Steam UI。
// 只抓渲染期/生命周期异常(子树任意后代抛的 error 都会冒到最近的边界);
// 异步/事件回调抓不到,由 guard() 各自 try/catch。
export class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error }; // 把子组件抛上来的错误接住,渲染时展示
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[decky-music] render error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "1rem" }}>
          <div>{t("unavailable")}</div>
          <div
            style={{ opacity: 0.6, fontSize: "0.8em", marginTop: "0.5rem", whiteSpace: "pre-wrap" }}
          >
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
