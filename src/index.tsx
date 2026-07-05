import { definePlugin, routerHook } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaMusic } from "react-icons/fa";

import { Boundary } from "./Boundary";
import { Page, ROUTE } from "./Page";
import { QAM } from "./QAM";

export default definePlugin(() => {
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
