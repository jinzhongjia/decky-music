// provider app 外壳(共享):首行 = Logo | L1 | 顶层页签 | R1 | 播放状态徽章;内容全宽。
// 遵循 specs/steam-deck-ui-rules.md「去常驻播放条」「顶栏分层」:
//  - 无底部 MiniPlayer;徽章纯展示(小封面 + 跑马灯 + EQ),不进焦点树;
//  - 根级 Focusable 接管 L1/R1 切页(onButtonDown)与 Start 盲操播放/暂停(onMenuButton),
//    无当前曲时 Start 不响应且不出提示;底部图例由系统渲染,只声明文案。
// 不用原生 Tabs:它把内容区也约束进头行中列(Logo/徽章占位后内容失去全宽)。

import { Focusable, GamepadButton, Marquee } from "@decky/ui";
import { ReactNode, useState } from "react";
import { FaMusic } from "react-icons/fa";

import { t } from "../i18n";
import { openQueueOverlay } from "../overlays/QueueOverlay";
import { togglePlay, usePlayer } from "../player/usePlayer";
import { theme } from "./theme";

export type AppTab = { id: string; title: string; content: ReactNode };

export function AppShell({
  name,
  accent,
  tabs,
  initial,
}: {
  name: string; // provider 显示名(Logo 旁)
  accent: string; // 品牌色:只用于 Logo 与徽章 EQ 点缀(规则:品牌色不铺底)
  tabs: AppTab[];
  initial?: string;
}) {
  const [active, setActive] = useState(initial ?? tabs[0].id);
  const { current } = usePlayer();
  const idx = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === active)
  );
  const cycle = (d: number) => setActive(tabs[(idx + d + tabs.length) % tabs.length].id);

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
        if (detail.button === GamepadButton.BUMPER_LEFT) cycle(-1);
        else if (detail.button === GamepadButton.BUMPER_RIGHT) cycle(1);
      }}
      onMenuButton={() => {
        if (current) togglePlay();
      }}
      onMenuActionDescription={current ? t("playPause") : undefined}
      onOptionsButton={() => {
        if (current) openQueueOverlay(); // Y:队列浮层;队列空(无当前曲)不开也不提示
      }}
      onOptionsActionDescription={current ? t("queueTitle") : undefined}
    >
      {/* 首行:系统 chrome 在其上方,不绘制不聚焦 */}
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
          {tabs.map((tab) => (
            <TabPill
              key={tab.id}
              title={tab.title}
              active={tab.id === tabs[idx].id}
              onActivate={() => setActive(tab.id)}
            />
          ))}
        </Focusable>
        <Chip>R1</Chip>
        <NowPlayingBadge accent={accent} />
      </div>
      {/* 内容:全宽,页面自管滚动 */}
      <div style={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
        {tabs[idx].content}
      </div>
    </Focusable>
  );
}

// 页签胶囊:激活态浅底深字(对齐效果图),可聚焦可 A 激活(硬规则:交互元素全可聚焦)
function TabPill({
  title,
  active,
  onActivate,
}: {
  title: string;
  active: boolean;
  onActivate: () => void;
}) {
  return (
    <Focusable
      onActivate={onActivate}
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

// L1/R1 提示章(页面内提示,非系统图例;非交互)
function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        flexShrink: 0,
        background: "#fff",
        color: "#000",
        fontWeight: 700,
        fontSize: "0.8em",
        borderRadius: 4,
        padding: "0.15em 0.5em",
      }}
    >
      {children}
    </span>
  );
}

// 顶层页签行右侧状态徽章:小封面 + 歌名跑马灯 + EQ 播放态。纯展示,不参与焦点。
function NowPlayingBadge({ accent }: { accent: string }) {
  const { current, playing } = usePlayer();
  if (!current || !current.name) return null; // 无名(旧存档恢复占位)不显示,避免孤零零一个 "-"
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        flexShrink: 0,
        maxWidth: 240,
      }}
    >
      {current.cover && (
        <img
          src={current.cover}
          style={{ width: 24, height: 24, borderRadius: 2, objectFit: "cover", flexShrink: 0 }}
          alt=""
        />
      )}
      <Marquee play style={{ maxWidth: 160 }}>
        <span style={{ color: theme.textDim, fontSize: "0.85em", whiteSpace: "nowrap" }}>
          {current.name} - {current.singer}
        </span>
      </Marquee>
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
