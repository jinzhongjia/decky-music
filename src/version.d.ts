// 由 rollup.config.js 的虚拟模块在构建时提供(取自 package.json 的 version)。
declare module "decky-music:version" {
  const version: string;
  export default version;
}
