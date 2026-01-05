# 播放器 Hook 重构计划

## 现状分析

### 当前文件结构

```
src/hooks/
├── playerAudio.ts      # 66 行 - Audio 实例管理
├── playerControls.ts   # 167 行 - 播放控制（togglePlay, seek, stop）
├── playerHooks.ts      # 220 行 - 各种 useEffect 副作用
├── playerLyric.ts      # 78 行 - 歌词获取和缓存
├── playerMethods.ts    # 211 行 - 方法工厂（创建各种播放方法）
├── playerNavigation.ts # 188 行 - 上/下一首、播放回调
├── playerPlayback.ts   # 189 行 - 核心播放逻辑
├── playerQueue.ts      # 196 行 - 队列操作（添加、删除、播放列表）
├── playerSettings.ts   # 186 行 - 设置持久化
├── playerShuffle.ts    # 118 行 - 随机播放逻辑
├── playerState.ts      # 109 行 - 全局状态和订阅
├── useSongQueue.ts     # 124 行 - 队列状态管理
└── usePlayer.ts        # 288 行 - 主 Hook，组合所有功能
```

**总计：12 个文件，约 2140 行代码**

### 核心问题

#### 1. 状态分散，难以追踪

```typescript
// playerAudio.ts
let globalAudio: HTMLAudioElement | null = null;
let globalEndedHandler: (() => void) | null = null;

// playerState.ts
let globalCurrentSong: SongInfo | null = null;
let globalPlayMode: PlayMode = "order";

// useSongQueue.ts
export let globalPlaylist: SongInfo[] = [];
export let globalCurrentIndex: number = -1;

// playerNavigation.ts
let onPlayNextCallback: (() => void) | null = null;

// playerShuffle.ts
let shuffleOrder: number[] = [];
let shuffleIndex: number = -1;
```

**问题**：状态分散在 6+ 个文件中，修改一处可能影响多处，难以调试。

#### 2. 循环依赖风险高

```
playerAudio.ts ←→ playerNavigation.ts
playerMethods.ts → playerNavigation.ts → playerPlayback.ts → playerState.ts
```

**问题**：我们刚刚修复的 bug 就是循环依赖导致的。

#### 3. 职责边界模糊

| 文件 | 问题 |
|------|------|
| `playerMethods.ts` vs `playerControls.ts` | 都是"方法"，区别不明显 |
| `playerNavigation.ts` vs `playerQueue.ts` | 都涉及队列操作 |
| `playerHooks.ts` vs `usePlayer.ts` | 都是 Hooks，分工不清 |

#### 4. usePlayer 被多处调用导致的问题

```typescript
// 每个调用都会创建独立的 state，但共享全局变量
useAppLogic.ts:       const player = usePlayer();
FullscreenPlayer.tsx: const player = usePlayer();
ProviderSettingsPage: const player = usePlayer();
```

**问题**：组件卸载时可能清理共享状态，影响其他组件。

---

## 重构目标

1. **统一状态管理**：使用 Zustand 替代分散的全局变量
2. **减少文件数量**：12 个 → 5-6 个
3. **消除循环依赖**：单向数据流
4. **明确职责边界**：每个模块只做一件事
5. **保持向后兼容**：usePlayer API 不变

---

## 分阶段实施

### Phase 1: 引入 Zustand 统一状态（低风险）

**目标**：将分散的全局变量统一到一个 store 中，不改变现有逻辑。

**预计工作量**：2-3 小时

#### 1.1 安装依赖

```bash
pnpm add zustand
```

#### 1.2 创建统一 Store

```typescript
// src/hooks/player/store.ts
import { create } from 'zustand';
import type { SongInfo, PlayMode } from '../../types';
import type { ParsedLyric } from '../../utils/lyricParser';

interface PlayerState {
  // 播放状态
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  
  // 队列状态
  playlist: SongInfo[];
  currentIndex: number;
  
  // 播放模式
  playMode: PlayMode;
  
  // 随机播放
  shuffleOrder: number[];
  shuffleIndex: number;
  
  // 歌词
  lyric: ParsedLyric | null;
  
  // 音量
  volume: number;
  
  // Provider
  currentProviderId: string;
}

interface PlayerActions {
  // 状态更新
  setCurrentSong: (song: SongInfo | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaylist: (playlist: SongInfo[]) => void;
  setCurrentIndex: (index: number) => void;
  setPlayMode: (mode: PlayMode) => void;
  setLyric: (lyric: ParsedLyric | null) => void;
  setVolume: (volume: number) => void;
  
  // 复合操作
  reset: () => void;
}

const initialState: PlayerState = {
  currentSong: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playlist: [],
  currentIndex: -1,
  playMode: 'order',
  shuffleOrder: [],
  shuffleIndex: -1,
  lyric: null,
  volume: 1,
  currentProviderId: '',
};

export const usePlayerStore = create<PlayerState & PlayerActions>((set) => ({
  ...initialState,
  
  setCurrentSong: (song) => set({ currentSong: song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration: duration }),
  setPlaylist: (playlist) => set({ playlist: playlist }),
  setCurrentIndex: (index) => set({ currentIndex: index }),
  setPlayMode: (mode) => set({ playMode: mode }),
  setLyric: (lyric) => set({ lyric: lyric }),
  setVolume: (volume) => set({ volume: volume }),
  
  reset: () => set(initialState),
}));
```

#### 1.3 迁移策略

**渐进式迁移**：保留旧的全局变量，同时同步到 Zustand store。

```typescript
// playerState.ts - 添加同步逻辑
import { usePlayerStore } from './player/store';

export function setGlobalCurrentSong(song: SongInfo | null): void {
  globalCurrentSong = song;
  usePlayerStore.getState().setCurrentSong(song); // 同步到 store
}
```

#### 1.4 验证

- [ ] 所有播放功能正常
- [ ] 状态同步正确
- [ ] 无性能退化

---

### Phase 2: 合并相关模块（中风险）

**目标**：减少文件数量，明确职责边界。

**预计工作量**：3-4 小时

#### 2.1 新的文件结构

```
src/hooks/player/
├── index.ts          # 导出 usePlayer
├── store.ts          # Zustand store（Phase 1 创建）
├── audio.ts          # Audio 实例 + ended 事件
├── queue.ts          # 队列管理 + 上/下一首
├── playback.ts       # 播放逻辑（合并 playerPlayback + playerControls）
├── shuffle.ts        # 随机播放
├── lyrics.ts         # 歌词
└── persistence.ts    # 设置持久化
```

**从 12 个文件减少到 8 个文件**

#### 2.2 模块合并映射

| 新模块 | 合并自 |
|--------|--------|
| `audio.ts` | `playerAudio.ts` |
| `queue.ts` | `useSongQueue.ts` + `playerNavigation.ts` + `playerQueue.ts` |
| `playback.ts` | `playerPlayback.ts` + `playerControls.ts` |
| `shuffle.ts` | `playerShuffle.ts` |
| `lyrics.ts` | `playerLyric.ts` |
| `persistence.ts` | `playerSettings.ts` |
| `index.ts` | `usePlayer.ts` + `playerMethods.ts` + `playerHooks.ts` + `playerState.ts` |

#### 2.3 合并原则

1. **相关功能放一起**：队列操作、上/下一首都与"播放列表"相关
2. **减少跨模块调用**：一个操作尽量在一个文件内完成
3. **单向依赖**：`index.ts` → 其他模块 → `store.ts`

---

### Phase 3: 重写核心逻辑（高风险）

**目标**：使用 Zustand 完全替代全局变量，简化数据流。

**预计工作量**：4-6 小时

#### 3.1 移除全局变量

```typescript
// 删除所有模块级的 let 变量
// 改为从 store 读取
const { playlist, currentIndex } = usePlayerStore.getState();
```

#### 3.2 简化 usePlayer

```typescript
// src/hooks/player/index.ts
export function usePlayer() {
  // 直接使用 store 的状态
  const state = usePlayerStore();
  
  // Actions 不需要 useCallback，因为 store 的 actions 是稳定的
  const actions = usePlayerActions();
  
  // 副作用
  useAudioSync();
  useSettingsPersistence();
  
  return { ...state, ...actions };
}
```

#### 3.3 Audio 事件处理

```typescript
// src/hooks/player/audio.ts
let audio: HTMLAudioElement | null = null;

export function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
  }
  return audio;
}

function handleEnded() {
  const { playMode, playlist } = usePlayerStore.getState();
  // 直接从 store 读取状态，无需回调
  if (shouldPlayNext(playMode, playlist)) {
    playNext();
  }
}
```

---

### Phase 4: 优化和清理（低风险）

**目标**：删除旧代码，优化性能。

**预计工作量**：1-2 小时

#### 4.1 删除旧文件

```bash
rm src/hooks/playerAudio.ts
rm src/hooks/playerControls.ts
rm src/hooks/playerHooks.ts
rm src/hooks/playerLyric.ts
rm src/hooks/playerMethods.ts
rm src/hooks/playerNavigation.ts
rm src/hooks/playerPlayback.ts
rm src/hooks/playerQueue.ts
rm src/hooks/playerSettings.ts
rm src/hooks/playerShuffle.ts
rm src/hooks/playerState.ts
rm src/hooks/useSongQueue.ts
rm src/hooks/usePlayer.ts
```

#### 4.2 更新导入路径

```typescript
// 旧
import { usePlayer } from './hooks/usePlayer';

// 新
import { usePlayer } from './hooks/player';
```

#### 4.3 性能优化

```typescript
// 使用 selector 避免不必要的重渲染
const currentSong = usePlayerStore((state) => state.currentSong);
const isPlaying = usePlayerStore((state) => state.isPlaying);
```

---

## 风险评估

| Phase | 风险 | 缓解措施 |
|-------|------|----------|
| 1 | 低 | 只添加代码，不修改现有逻辑 |
| 2 | 中 | 逐个文件迁移，每次提交可工作 |
| 3 | 高 | 需要完整测试，可能引入 bug |
| 4 | 低 | 只是清理，不改变行为 |

---

## 最终目标结构

```
src/hooks/player/
├── index.ts          # usePlayer Hook (约 100 行)
├── store.ts          # Zustand store (约 80 行)
├── audio.ts          # Audio 管理 (约 60 行)
├── queue.ts          # 队列 + 导航 (约 150 行)
├── playback.ts       # 播放逻辑 (约 120 行)
├── shuffle.ts        # 随机播放 (约 80 行)
├── lyrics.ts         # 歌词 (约 60 行)
└── persistence.ts    # 持久化 (约 100 行)
```

**总计：8 个文件，约 750 行代码（减少 65%）**

---

## 收益

1. **可维护性**：状态集中管理，易于调试
2. **可读性**：文件数量减少，职责清晰
3. **稳定性**：消除循环依赖，减少 bug
4. **性能**：Zustand selector 优化渲染
5. **可测试性**：Store 可独立测试

---

## 时间线建议

| 阶段 | 时间 | 里程碑 |
|------|------|--------|
| Phase 1 | Week 1 | Zustand 集成完成 |
| Phase 2 | Week 2 | 文件合并完成 |
| Phase 3 | Week 3 | 核心逻辑重写完成 |
| Phase 4 | Week 4 | 清理完成，发布新版本 |

**总计：约 4 周，可根据实际情况调整**
