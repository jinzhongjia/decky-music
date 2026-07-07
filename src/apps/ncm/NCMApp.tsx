// 网易云音乐 app(内容区)。目前只有可填的「搜索」;发现/私人FM/我的/正在播放+热评 待内容接口,
// 见 docs/ui-design/specs/ncm-ui.md。届时在此加页面 + 导航,与 QQApp 各自演进。

import { Search } from "../../screens/Search";

export function NCMApp() {
  return <Search />;
}
