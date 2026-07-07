// QQ 音乐 app(内容区)。目前只有可填的「搜索」;推荐/我的音乐/智能电台/正在播放 待内容接口,
// 见 docs/ui-design/specs/qq-ui.md。届时在此加页面 + 导航,与 NCMApp 各自演进。

import { Search } from "../../screens/Search";

export function QQApp() {
  return <Search />;
}
