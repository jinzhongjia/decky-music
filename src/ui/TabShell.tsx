// 顶部页签外壳(共享):用 @decky/ui 原生 Tabs —— 自带居中页签栏 + L1/R1 切页 + 每页脚注图例。
// QQ / NCM 各自传自己的页签集(两套产品),这里只统一「受控 activeTab」这点样板。

import { Tabs } from "@decky/ui";
import { ReactNode, useState } from "react";

export type AppTab = { id: string; title: string; content: ReactNode };

export function TabShell({ tabs, initial }: { tabs: AppTab[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0].id);
  return <Tabs tabs={tabs} activeTab={active} onShowTab={setActive} autoFocusContents />;
}
