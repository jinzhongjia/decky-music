// 二级 Tab(官方库范式,P5e):全宽 Tab 行(带计数徽章)+ 全宽内容区。
// L2/R2 循环切换(顶层已占 L1/R1);Tab 胶囊可聚焦可 A 激活,D-pad 向下进内容区。

import { Focusable, GamepadButton } from "@decky/ui";
import { ReactNode } from "react";

import { Chip, useTabCycle } from "./AppShell";
import { theme } from "./theme";

export type SecTab = { id: string; title: string; count?: number; content: ReactNode };

type SecondaryTabsProps = {
  tabs: SecTab[];
  initialFocus?: boolean;
};

export function SecondaryTabs({ tabs, initialFocus = false }: SecondaryTabsProps) {
  // 与顶层页签同一状态机;二级页签默认不抢初始焦点(L2/R2 切换或 A 选中后才抢)
  const { idx, allowInitialFocus, cycle, select } = useTabCycle(tabs, initialFocus);

  return (
    <Focusable
      onButtonDown={(evt) => {
        const detail = evt?.detail;
        if (!detail || detail.is_repeat) return;
        if (detail.button === GamepadButton.TRIGGER_LEFT) cycle(-1);
        else if (detail.button === GamepadButton.TRIGGER_RIGHT) cycle(1);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <SecondaryTabRow
        tabs={tabs}
        activeId={tabs[idx].id}
        autoFocusActive={allowInitialFocus}
        onSelect={select}
      />
      {/* key=当前 tab id:同类型内容组件(如两个 PlaylistGridView)切换时强制重挂,
          否则 React 复用实例、useEffect 不重跑,内容不刷新 */}
      <div key={tabs[idx].id} style={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
        {tabs[idx].content}
      </div>
    </Focusable>
  );
}

type SecondaryTabRowProps = {
  tabs: SecTab[];
  activeId: string;
  autoFocusActive: boolean;
  onSelect: (id: string) => void;
};

function SecondaryTabRow({ tabs, activeId, autoFocusActive, onSelect }: SecondaryTabRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
      <Chip>L2</Chip>
      <Focusable style={{ display: "flex", gap: "0.5rem", flexGrow: 1, minWidth: 0 }}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <SecondaryTabPill
              key={`${tab.id}:${active ? "active" : "inactive"}`}
              tab={tab}
              active={active}
              autoFocus={active && autoFocusActive}
              onActivate={() => onSelect(tab.id)}
            />
          );
        })}
      </Focusable>
      <Chip>R2</Chip>
    </div>
  );
}

function SecondaryTabPill({
  tab,
  active,
  autoFocus,
  onActivate,
}: {
  tab: SecTab;
  active: boolean;
  autoFocus: boolean;
  onActivate: () => void;
}) {
  return (
    <Focusable
      onActivate={onActivate}
      {...(autoFocus ? ({ autoFocus: true } as object) : {})}
      style={{
        padding: "0.2em 0.9em",
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: active ? "#e6e6e6" : "transparent",
        color: active ? "#0e0e10" : theme.textDim,
        fontWeight: active ? 600 : 400,
        fontSize: "0.9em",
      }}
    >
      {tab.title}
      {(tab.count ?? 0) > 0 && (
        <span style={{ opacity: 0.65, marginLeft: "0.4em", fontSize: "0.85em" }}>{tab.count}</span>
      )}
    </Focusable>
  );
}
