# patches - Steam 客户端菜单 Patch

## 目录介绍

通过 Monkey Patch 方式将"音乐"菜单项注入到 Steam Deck 的主导航菜单中，实现全屏播放器的快捷入口。

## 结构说明

```
patches/
├── index.ts         # 统一导出入口
└── menuPatch.tsx    # 菜单注入逻辑
```

## 业务逻辑

### 工作原理

1. 通过 `@decky/ui` 的 `getReactRoot` 和 `findInReactTree` 定位 Steam 客户端的 `MainNavMenuContainer` React 节点
2. 使用 `afterPatch` 拦截菜单渲染，在现有菜单项列表中插入自定义的"音乐"项
3. 新菜单项的路由路径为 `/decky-music`，由 `routerHook.addRoute` 注册的 `FullscreenPlayer` 组件响应

### menuManager

全局菜单管理器，提供生命周期控制：

- `enable()`：启用菜单注入，若 React 树尚未就绪则自动重试（每 1 秒）
- `disable()`：手动禁用菜单项
- `cleanup()`：插件卸载时清理（恢复原始组件、取消重试）
- `isEnabled()`：检查是否已启用

### 兼容性处理

自动检测菜单项组件是使用 `icon` prop 还是 `children` 传入图标，通过 `MenuItemWrapper` 适配两种模式。

## 对外暴露的接口

| 导出 | 类型 | 说明 |
|---|---|---|
| `ROUTE_PATH` | 常量 | 全屏播放器路由路径 `"/decky-music"` |
| `menuManager` | 对象 | 菜单生命周期管理器 |
| `patchMenu` | 函数 | 向后兼容的注入函数（等同于 `menuManager.enable()`） |

## 依赖关系

- **依赖** `@decky/ui`（`afterPatch`、`findInReactTree`、`getReactRoot`）、`react-icons`（`FaMusic` 图标）
- **被依赖** `src/index.tsx`（插件入口调用 `menuManager.enable()` 注册菜单、`menuManager.cleanup()` 卸载清理，使用 `ROUTE_PATH` 注册路由）
