import { Component, ReactNode } from "react";

// 自套 ErrorBoundary(纵深防御):子树渲染出错时显示降级 UI,不拖垮宿主 Steam UI。
// 注意:只抓渲染期/生命周期异常;异步/事件回调需各自 try/catch。
export class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div style={{ padding: "1rem" }}>暂时不可用,请重试。</div>;
    }
    return this.props.children;
  }
}
