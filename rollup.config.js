import { readFileSync } from "node:fs";

import deckyPlugin from "@decky/rollup";

// 构建时从 package.json 读插件版本,以虚拟模块 `decky-music:version` 提供给 UI(QAM 页脚),
// 发版只改 package.json 一处。虚拟模块而非直接 import package.json:后者会把 TS 编译根扩到仓库根。
const { version } = JSON.parse(readFileSync("package.json", "utf-8"));
const VERSION_MODULE = "decky-music:version";
const RESOLVED = "\0" + VERSION_MODULE;

const config = deckyPlugin({
  plugins: [
    {
      name: "decky-music-version",
      resolveId: (id) => (id === VERSION_MODULE ? RESOLVED : null),
      load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(version)};` : null),
    },
  ],
});

// 体积:不随包发 sourcemap。模板默认的 sourcemap 内嵌全部源码(含整份 react-icons/fa,约 1.7MB),
// 占插件 zip 的八成以上;运行时只有打开 DevTools 才会去请求它。bundle 本身未压缩,可直接阅读。
// deckyPlugin 合并时以模板默认值为准,传参覆盖不了,只能改返回的配置。
config.output.sourcemap = false;

export default config;
