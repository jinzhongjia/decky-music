import { definePlugin, routerHook } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaMusic } from "react-icons/fa";

import { Boundary } from "./Boundary";
import { Page, ROUTE } from "./Page";
import { QAM } from "./QAM";

// 入口:只做接线。QAM 面板见 QAM.tsx,大屏页见 Page.tsx。
export default definePlugin(() => {
  // 路由只在插件加载时注册一次(在事件处理里 addRoute 会重挂载 QAM 面板、复位 state)。
  // 大屏入口按钮仍按 provider 选择显隐,故“未选 provider 不进大屏”的体验不变。
  routerHook.addRoute(ROUTE, () => (
    <Boundary>
      <Page />
    </Boundary>
  ));
  return {
    name: "Decky Music",
    titleView: <div className={staticClasses.Title}>{"Decky Music"}</div>,
    icon: <FaMusic />,
    content: (
      <Boundary>
        <QAM />
      </Boundary>
    ),
    onDismount() {
      routerHook.removeRoute(ROUTE);
    },
  };
});
