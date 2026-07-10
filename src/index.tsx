import { definePlugin, routerHook } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaMusic } from "react-icons/fa";

import { Boundary } from "./Boundary";
import { Page, ROUTE } from "./Page";
import { QAM } from "./QAM";
import { RADIO_ROUTE, RadioPage } from "./screens/Immersive";
import { DETAIL_ROUTE, PlaylistDetailPage } from "./screens/PlaylistDetail";
import { disableMenuInjection, enableMenuInjection } from "./steamMenu";

export default definePlugin(() => {
  routerHook.addRoute(ROUTE, () => (
    <Boundary>
      <Page />
    </Boundary>
  ));
  // 歌单详情独立路由:B = 原生返回上一路由(回 /music,焦点系统级恢复)
  routerHook.addRoute(DETAIL_ROUTE, () => (
    <Boundary>
      <PlaylistDetailPage />
    </Boundary>
  ));
  // QQ 智能电台沉浸页(猜你喜欢/雷达推荐共用)
  routerHook.addRoute(RADIO_ROUTE, () => (
    <Boundary>
      <RadioPage />
    </Boundary>
  ));
  enableMenuInjection(); // 左侧 Steam 菜单注入「音乐」入口(可选增强,失败不影响 QAM/账号页入口)
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
      disableMenuInjection();
      routerHook.removeRoute(ROUTE);
      routerHook.removeRoute(DETAIL_ROUTE);
      routerHook.removeRoute(RADIO_ROUTE);
    },
  };
});
