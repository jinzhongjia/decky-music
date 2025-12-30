/**
 * ErrorBoundary - 错误边界组件
 * 捕获子组件渲染错误，防止整个插件崩溃
 */

import { Component, type ReactNode, type ErrorInfo } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[QQMusic] 组件渲染错误:", error);
    console.error("[QQMusic] 错误堆栈:", errorInfo.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <PanelSection title="出错了">
          <PanelSectionRow>
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>😵</div>
              <div style={{ color: "#b0b0b0", marginBottom: "16px" }}>插件遇到了一个错误</div>
              {this.state.error && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "#808080",
                    background: "rgba(0,0,0,0.2)",
                    padding: "8px",
                    borderRadius: "4px",
                    marginBottom: "16px",
                    wordBreak: "break-word",
                    maxHeight: "80px",
                    overflow: "auto",
                  }}
                >
                  {this.state.error.message}
                </div>
              )}
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={this.handleRetry}>
              重试
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      );
    }

    return this.props.children;
  }
}
