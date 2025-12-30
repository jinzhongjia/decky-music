# AGENTS.md

本文档为 AI 助手（如 LLM、Copilot 等）提供项目上下文和开发指导。

## 项目概述

**Decky QQ Music 插件** - 在 Steam Deck 上享受 QQ 音乐的 Decky Loader 插件。

### 技术栈

- **前端**: React 19 + TypeScript + Decky UI
- **后端**: Python 3 + asyncio + QQMusicApi
- **构建**: Rollup + Docker
- **包管理**: pnpm

### 核心功能

- 扫码登录（QQ/微信）
- 歌曲搜索
- 每日推荐/猜你喜欢
- 音乐播放（后台播放、播放列表、播放历史）
- 歌词显示
- 歌单管理

### 目标用户

Steam Deck 用户，希望在设备上使用 QQ 音乐服务。

本项目旨在提供流畅的音乐体验，集成到 Decky Loader 环境中，插件实现要轻量、高效、稳定、高性能！

---

## 项目架构

### 前端结构

```
src/
├── index.tsx                 # 插件主入口，定义路由和插件生命周期
├── api/index.ts              # API 调用封装（通过 callable 与 Python 后端通信）
├── components/               # React 组件
│   ├── LoginPage.tsx         # 登录页面（扫码）
│   ├── HomePage.tsx          # 首页（推荐、历史等）
│   ├── SearchPage.tsx        # 搜索页面
│   ├── PlayerPage.tsx        # 全屏播放器
│   ├── PlayerBar.tsx         # 迷你播放条
│   ├── PlaylistsPage.tsx     # 歌单列表
│   ├── PlaylistDetailPage.tsx# 歌单详情
│   ├── HistoryPage.tsx       # 播放历史
│   ├── SongItem.tsx          # 歌曲列表项
│   ├── SongList.tsx          # 歌曲列表
│   └── ...
├── hooks/
│   ├── usePlayer.ts          # 播放器状态管理（全局 Audio 单例）
│   ├── useDataManager.ts     # 数据预加载和缓存
│   ├── useDebounce.ts        # 防抖
│   ├── useMountedRef.ts      # 组件挂载状态 ref
│   └── useSearchHistory.ts  # 搜索历史
├── pages/
│   └── FullscreenPlayer.tsx  # 全屏播放器页面（Decky 路由）
├── patches/
│   └── menuPatch.tsx         # 左侧菜单补丁
├── utils/
│   ├── format.ts             # 格式化工具（时间、数字）
│   ├── lyricParser.ts        # 歌词解析（LRC 和 QRC）
│   └── styles.ts             # 样式工具
└── types.d.ts                # TypeScript 类型定义
```

### 后端结构

```
main.py                      # Python 后端主文件
py_modules/
└── qqmusic_api/             # QQ 音乐 API 库（第三方）
```

### 关键设计模式

#### 1. 前后端通信

前端通过 `@decky/api` 的 `callable` 函数与 Python 后端通信：

```typescript
// src/api/index.ts
export const getSongUrl = callable<[mid: string], SongUrlResponse>("get_song_url");
```

Python 端实现对应方法：

```python
# main.py
async def get_song_url(self, mid: str) -> dict[str, Any]:
    # 实现...
```

#### 2. 全局状态管理

**播放器状态**使用全局单例模式（`usePlayer.ts`）：

- 全局 `HTMLAudioElement` 实例，确保关闭面板后音乐继续播放
- 播放列表、播放历史、歌词等状态在模块级别保存
- 通过 `cleanupPlayer()` 在插件卸载时清理资源

**数据缓存**使用 `useDataManager`：

- 预加载每日推荐、猜你喜欢等数据
- 使用 Map 缓存 API 响应
- 提供清理缓存接口

#### 3. Decky 集成

- **插件注册**: 通过 `definePlugin()` 定义插件
- **路由注册**: 使用 `routerHook.addRoute()` 注册全屏路由
- **菜单补丁**: 通过 `menuPatch.tsx` 在左侧添加快捷入口

---

## 开发规范

### TypeScript 配置

- **严格模式**: `strict: true` 启用所有严格类型检查
- **目标**: ES2020
- **模块**: ESNext
- **JSX**: react-jsx（自动导入）

### ESLint 规则

重点规则：

```javascript
{
  '@typescript-eslint/no-unused-vars': 'warn',  // 未使用变量警告
  '@typescript-eslint/no-explicit-any': 'warn', // 禁止 any（警告级别）
  'react-hooks/rules-of-hooks': 'error',      // 强制 Hooks 规则
  'react-hooks/exhaustive-deps': 'warn',       // 依赖检查警告
  'no-console': 'off'                           // 允许 console
}
```

### Prettier 配置

```json
{
  "semi": true,                    // 分号
  "singleQuote": false,            // 双引号
  "tabWidth": 2,                   // 2 空格缩进
  "trailingComma": "es5",          // 尾随逗号
  "printWidth": 100,              // 行宽 100
  "arrowParens": "always"         // 箭头函数参数括号
}
```

### 代码风格指南

#### 1. 组件结构

```tsx
// 1. 导入（外部库 → 内部模块 → 类型）
import { useState } from "react";
import { PanelSection } from "@decky/ui";
import type { SongInfo } from "./types";

// 2. 组件定义（优先使用函数组件）
function MyComponent({ prop }: Props) {
  // 3. Hooks 调用
  const [state, setState] = useState();

  // 4. 事件处理函数
  const handleClick = () => {};

  // 5. 渲染
  return <div>...</div>;
}

export default MyComponent;
```

#### 2. 类型定义

- 组件 Props 使用 `interface` 定义
- 简单对象类型使用 `type`
- 避免 `any`，使用 `unknown` 或具体类型

```typescript
// ✅ 推荐
interface SongInfo {
  mid: string;
  name: string;
  singer: string;
}

// ❌ 避免
interface SongInfo {
  data: any;  // 不要用 any
}
```

#### 3. 错误处理

```typescript
// ✅ 推荐 - 具体错误类型
try {
  await apiCall();
} catch (e) {
  const error = e as Error;
  console.error("操作失败:", error.message);
  toaster.toast({ title: "错误", body: error.message });
}

// ❌ 避免
try {
  await apiCall();
} catch (e) {
  console.log(e);  // 日志不明确
}
```

#### 4. 异步处理

- API 调用使用 `async/await`
- 组件中使用 `useEffect` 处理副作用
- 注意内存泄漏：检查 `isMountedRef` 或使用 AbortController

```typescript
const mountedRef = useMountedRef();

useEffect(() => {
  async function loadData() {
    try {
      const result = await fetchData();
      if (!mountedRef.current) return;  // 防止卸载后更新
      setData(result);
    } catch (e) {
      console.error(e);
    }
  }

  loadData();
}, []);
```

#### 5. 全局变量

- 使用 `@ts-ignore` 注释 SteamClient 等全局对象
- 优先使用 ref 存储跨组件状态

```typescript
// SteamClient 是全局变量
// @ts-ignore
// eslint-disable-next-line no-undef
if (typeof SteamClient === 'undefined') return;
```

---

## 常见任务指南

### 数据持久化

- 前端设置统一走 Decky SettingsManager（参考 `main.py` 的 `get_frontend_settings/save_frontend_settings` 和前端 `usePlayer` 的调用），不要再使用 `localStorage`。
- 需要迁移旧 `localStorage` 数据时，可参考项目中已有的迁移按钮与逻辑。

### 添加新 API 接口

1. 在 `src/api/index.ts` 定义 callable：

```typescript
export const getSomething = callable<[param: string], ResponseType>("get_something");
```

2. 在 `src/types.d.ts` 定义响应类型（如果需要）

3. 在 `main.py` 实现对应方法：

```python
async def get_something(self, param: str) -> dict[str, Any]:
    try:
        result = await qqmusic_api.something(param)
        return {"success": True, "data": result}
    except Exception as e:
        decky.logger.error(f"操作失败: {e}")
        return {"success": False, "error": str(e)}
```

### 创建新页面组件

1. 创建组件文件 `src/pages/NewPage.tsx`：

```tsx
import { PanelSection, PanelSectionRow } from "@decky/ui";
import type { FC } from "react";

interface Props {
  onBack: () => void;
}

const NewPage: FC<Props> = ({ onBack }) => {
  return (
    <PanelSection title="新页面">
      {/* 内容 */}
    </PanelSection>
  );
};

export default NewPage;
```

2. 在 `src/index.tsx` 添加页面状态和路由：

```tsx
const [currentPage, setCurrentPage] = useState<PageType>('login');

// 在 renderPage switch 中添加 case
case 'new-page':
  return <NewPage onBack={() => setCurrentPage('home')} />;
```

3. 导入组件（如果在新文件）

### 修改播放器行为

播放器逻辑在 `src/hooks/usePlayer.ts`：

- `playSong()` - 播放单曲
- `playPlaylist()` - 播放列表
- `togglePlay()` - 播放/暂停
- `playNext()` / `playPrev()` - 下一首/上一首
- `seek()` - 进度跳转
- `stop()` - 停止播放

修改时注意：
- 保持全局状态一致性（`globalAudio`, `globalPlaylist` 等）
- 正确处理休眠控制（`inhibitSleep` / `uninhibitSleep`）
- 清理资源避免内存泄漏

### 添加新功能到首页

在 `src/components/HomePage.tsx` 中：

1. 定义 Props 接口：

```typescript
interface Props {
  onGoToNewFeature: () => void;
}
```

2. 添加按钮或入口：

```tsx
<PanelSectionRow>
  <ButtonItem
    layout="below"
    onClick={onGoToNewFeature}
  >
    新功能
  </ButtonItem>
</PanelSectionRow>
```

3. 在 `src/index.tsx` 传递回调：

```tsx
<HomePage
  onGoToNewFeature={() => setCurrentPage('new-feature')}
  // ...其他 props
/>
```

---

## 调试和测试

### 前端调试

由于开发环境在 Steam Deck 上，所以我们难以查看到浏览器控制台，无法获得 log，但是可以要求开发者提供 steamdeck 的照片

### 后端调试

日志通过 `decky.logger` 输出：

```python
decky.logger.info("信息")
decky.logger.warning("警告")
decky.logger.error("错误")
```

查看日志位置：`DECKY_PLUGIN_LOG_DIR`

### 常见问题

#### 1. API 调用失败

- 检查 Python 方法是否正确实现
- 查看后端日志
- 确认凭证是否有效（需要登录）

#### 2. 播放器状态不同步

- 检查是否正确更新全局状态
- 确认 `usePlayer` 的返回值正确传递给组件
- 查看控制台是否有 React 警告

#### 3. 组件卸载后报错

- 使用 `useMountedRef` 检查组件是否已卸载
- 清理事件监听器和定时器
- 使用 AbortController 取消异步请求

---

## 构建和部署

### 开发环境设置

可以参考 README.md 文件

### 部署到 Steam Deck

通过 Decky Loader 在 Steam Deck 上加载未打包的插件进行调试。

我们通过使用 rsync 工具将代码同步到 Steam Deck 上，默认开发者在 Steam Deck 开启 SSH 服务。

并且 steamdeck 使用 `sudo` 不需要密码

### Docker 构建（推荐）

使用 `mise` 工具：

```bash
# 构建
mise run build

# 构建并部署到 Steam Deck
mise run deploy

# 输出文件: out/QQMusic.zip 和 out/QQMusic/
```

### 发版流程

1. 更新版本号（`plugin.json` 和 `package.json`）
2. 提交代码：`git add . && git commit -m "release: v0.0.x"`
3. 打 tag：`git tag v0.0.x`
4. 推送：`git push && git push --tags`
5. GitHub Actions 会自动构建并创建 Release

---

## 外部依赖

### 前端依赖

- `@decky/api` - Decky 插件 API
- `@decky/ui` - Decky UI 组件库
- `react-icons` - 图标库

### 后端依赖

- `qqmusic_api` - QQ 音乐 API 库（来自 [L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi)）

### Decky Loader 相关

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) - 插件加载器
- [decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template) - 插件模板

---

## 许可证

BSD-3-Clause License
