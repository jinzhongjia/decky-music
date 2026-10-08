import { readFileSync } from "node:fs";

import deckyPlugin from "@decky/rollup";

// 构建时从 package.json 读插件版本,以虚拟模块 `decky-music:version` 提供给 UI(QAM 页脚),
// 发版只改 package.json 一处。虚拟模块而非直接 import package.json:后者会把 TS 编译根扩到仓库根。
const { version } = JSON.parse(readFileSync("package.json", "utf-8"));
const VERSION_MODULE = "decky-music:version";
const RESOLVED = "\0" + VERSION_MODULE;

export default deckyPlugin({
  plugins: [
    {
      name: "decky-music-version",
      resolveId: (id) => (id === VERSION_MODULE ? RESOLVED : null),
      load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(version)};` : null),
    },
  ],
});
