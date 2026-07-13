// provider app 外壳(共享):首行 = Logo | L1 | 顶层页签 | R1 | 播放状态徽章;内容全宽。
// 遵循 specs/steam-deck-ui-rules.md「去常驻播放条」「顶栏分层」:
//  - 无底部 MiniPlayer;徽章纯展示(小封面 + EQ,不带歌名——CSS 视口仅 854px,
//    NCM 五页签下歌名跑马灯会把首行挤形变),不进焦点树;
//  - 根级 Focusable 接管 L1/R1 切页(onButtonDown)与 Start 盲操播放/暂停(onMenuButton),
//    无当前曲时 Start 不响应且不出提示;底部图例由系统渲染,只声明文案。
// 不用原生 Tabs:它把内容区也约束进头行中列(Logo/徽章占位后内容失去全宽)。

import { Focusable, GamepadButton } from "@decky/ui";
import { createContext, ReactNode, useContext, useState } from "react";
import { FaMusic } from "react-icons/fa";

import { t } from "../i18n";
import { openQueueOverlay } from "../overlays/QueueOverlay";
import { togglePlay, usePlayer } from "../player/usePlayer";
import { cancelInitialFocus, createPageFocusState, cyclePage, selectPage } from "./pageFocus";
import { theme } from "./theme";

export type AppTab = {
  id: string;
  title: string;
  content: ReactNode;
  focusTabFallback?: boolean;
};

type AppShellProps = {
  name: string; // provider 显示名(Logo 旁)
  accent: string; // 品牌色:只用于 Logo 与徽章 EQ 点缀(规则:品牌色不铺底)
  tabs: AppTab[];
};

// tab 循环选择(AppShell L1/R1 与 SecondaryTabs L2/R2 共用):id 定位 + 循环步进
export function useTabCycle<T extends { id: string }>(tabs: T[], initial?: string) {
  const [active, setActive] = useState(initial ?? tabs[0].id);
  const idx = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === active)
  );
  const cycle = (d: number) => setActive(tabs[(idx + d + tabs.length) % tabs.length].id);
  return { idx, cycle, setActive };
}

// 全局播放快捷键(Focusable 属性组):Start 盲操播放/暂停 + Y 队列浮层,无当前曲时
// 不响应且隐藏图例提示。shell 与独立路由页(歌单详情等)共用,保证快捷键处处一致。
export function usePlaybackShortcuts() {
  const { current } = usePlayer();
  return {
    onMenuButton: () => {
      if (current) togglePlay();
    },
    onMenuActionDescription: current ? t("playPause") : undefined,
    onOptionsButton: () => {
      if (current) openQueueOverlay();
    },
    onOptionsActionDescription: current ? t("queueTitle") : undefined,
  };
}

export function AppShell({ name, accent, tabs }: AppShellProps) {
  const [pageFocus, setPageFocus] = useState(() => createPageFocusState(tabs[0].id));
  const idx = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === pageFocus.activeId)
  );
  const shortcuts = usePlaybackShortcuts();

  return (
    <Focusable
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        gap: "0.75rem",
      }}
      onButtonDown={(evt) => {
        const detail = evt?.detail;
        if (!detail || detail.is_repeat) return;
        if (detail.button === GamepadButton.BUMPER_LEFT) {
          setPageFocus((state) => cyclePage(state, tabs, -1));
        } else if (detail.button === GamepadButton.BUMPER_RIGHT) {
          setPageFocus((state) => cyclePage(state, tabs, 1));
        } else {
          setPageFocus(cancelInitialFocus);
        }
      }}
      {...shortcuts}
    >
      <AppHeader
        name={name}
        accent={accent}
        tabs={tabs}
        activeId={tabs[idx].id}
        allowInitialFocus={pageFocus.allowInitialFocus}
        onSelect={(id) => setPageFocus((state) => selectPage(state, id))}
      />
      {/* 内容:全宽,页面自管滚动。页面主要控件仅在用户尚未移动焦点时取初始焦点。 */}
      <PageAutoFocusContext.Provider value={pageFocus.allowInitialFocus}>
        <div style={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
          {tabs[idx].content}
        </div>
      </PageAutoFocusContext.Provider>
    </Focusable>
  );
}

type AppHeaderProps = {
  name: string;
  accent: string;
  tabs: AppTab[];
  activeId: string;
  allowInitialFocus: boolean;
  onSelect: (id: string) => void;
};

// 首行:系统 chrome 在其上方,不绘制不聚焦。
function AppHeader({ name, accent, tabs, activeId, allowInitialFocus, onSelect }: AppHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
        <FaMusic style={{ color: accent }} />
        <span style={{ color: theme.text, fontWeight: 600, whiteSpace: "nowrap" }}>{name}</span>
      </div>
      <Chip>L1</Chip>
      <Focusable
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "0.5rem",
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <TabPill
              key={`${tab.id}:${active ? "active" : "inactive"}:${
                tab.focusTabFallback ? "fallback" : "content"
              }`}
              title={tab.title}
              active={active}
              autoFocus={active && !!tab.focusTabFallback && allowInitialFocus}
              onActivate={() => onSelect(tab.id)}
            />
          );
        })}
      </Focusable>
      <Chip>R1</Chip>
      <NowPlayingBadge accent={accent} />
    </div>
  );
}

// 页签胶囊:激活态浅底深字(对齐效果图),可聚焦可 A 激活(硬规则:交互元素全可聚焦)。
// 常规页面不由页签抢默认焦点；只有当前页面没有可执行控件时才显式作为 fallback。
function TabPill({
  title,
  active,
  autoFocus,
  onActivate,
}: {
  title: string;
  active: boolean;
  autoFocus: boolean;
  onActivate: () => void;
}) {
  return (
    <Focusable
      onActivate={onActivate}
      {...(autoFocus ? ({ autoFocus: true } as object) : {})}
      style={{
        padding: "0.25em 1em",
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: active ? "#e6e6e6" : "transparent",
        color: active ? "#0e0e10" : theme.textDim,
        fontWeight: active ? 600 : 400,
      }}
    >
      {title}
    </Focusable>
  );
}

const PageAutoFocusContext = createContext(true);

/** 当前页面的异步主要控件是否仍可取初始焦点。用户产生其他输入后即为 false。 */
export function usePageAutoFocus() {
  return useContext(PageAutoFocusContext);
}

// L1/R1、L2/R2 提示章(页面内提示,非系统图例;非交互)。
// 白底小章,字号/内边距压小一号,省首行宽度预算(纯灰字方案被否:太素)。
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        flexShrink: 0,
        background: "#fff",
        color: "#000",
        fontWeight: 700,
        fontSize: "0.65em",
        borderRadius: 3,
        padding: "0.1em 0.4em",
      }}
    >
      {children}
    </span>
  );
}

// 顶层页签行右侧状态徽章:小封面 + EQ 播放态。纯展示,不参与焦点。
// 不带歌名:歌名在正在播放页/队列浮层可见,首行宽度留给页签。
function NowPlayingBadge({ accent }: { accent: string }) {
  const { current, playing } = usePlayer();
  if (!current || !current.name) return null; // 无名(旧存档恢复占位)不显示,避免孤零零一个 EQ
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
      {current.cover && (
        <img
          src={current.cover}
          style={{ width: 24, height: 24, borderRadius: 2, objectFit: "cover", flexShrink: 0 }}
          alt=""
        />
      )}
      <EqBars playing={playing} color={accent} />
    </div>
  );
}

// 三根竖条 EQ:播放时动画,暂停时静止低条。keyframes 只注入本组件。
function EqBars({ playing, color }: { playing: boolean; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14, flexShrink: 0 }}>
      <style>{`@keyframes dmEq{0%{height:30%}50%{height:100%}100%{height:30%}}`}</style>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: "30%",
            background: color,
            animation: playing ? `dmEq 0.9s ease-in-out ${i * 0.2}s infinite` : "none",
          }}
        />
      ))}
    </div>
  );
}
