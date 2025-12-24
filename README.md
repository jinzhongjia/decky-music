# Decky QQ Music 插件

[![Chat](https://img.shields.io/badge/chat-on%20discord-7289da.svg)](https://deckbrew.xyz/discord)

在 Steam Deck 上享受 QQ 音乐的 Decky Loader 插件。

## ✨ 功能特性

- 🔐 **扫码登录** - 支持 QQ 和微信扫码登录
- 📅 **每日推荐** - 个性化每日推荐歌曲
- 💡 **猜你喜欢** - 智能推荐，支持换一批
- 🔍 **歌曲搜索** - 支持关键词搜索，显示热门搜索
- 🎵 **音乐播放** - 在线播放歌曲，支持播放控制
- 📝 **歌词显示** - 获取歌词信息
- 💾 **登录状态保存** - 自动保存登录凭证，无需重复登录

## 📦 安装

### 前提条件

- Steam Deck 已安装 [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader)
- Node.js v16.14+ 和 pnpm v9

### 从 Release 安装（推荐）

1. 从 [Releases](https://github.com/your-username/decky-qqmusic/releases) 下载最新的 `decky-qqmusic.zip`
2. 将 zip 文件传输到 Steam Deck
3. 解压到 `~/homebrew/plugins/`
4. 重启 Decky Loader

### 从源码构建

> ⚠️ 注意：必须在 **Linux 环境** 下构建，因为 Python 依赖包含原生模块，Windows 构建的包在 Steam Deck 上无法运行。

**方法 1：使用 GitHub Actions（推荐）**

Fork 此仓库后，GitHub Actions 会自动构建。创建 tag 时会自动发布 Release。

**方法 2：在 Linux 下本地构建**

```bash
git clone https://github.com/your-username/decky-qqmusic.git
cd decky-qqmusic

# 运行构建脚本
chmod +x build.sh
./build.sh

# 输出文件: out/decky-qqmusic.zip
```

**方法 3：在 Steam Deck 上直接构建**

```bash
# 进入桌面模式
git clone https://github.com/your-username/decky-qqmusic.git
cd decky-qqmusic
./build.sh

# 安装
cp -r out/decky-qqmusic ~/homebrew/plugins/
sudo systemctl restart plugin_loader
```

## 🎮 使用方法

### 登录

1. 打开 Steam Deck 的游戏模式
2. 按下 `...` 按钮打开快速访问菜单
3. 切换到 Decky 插件标签页
4. 找到并打开 "QQ音乐" 插件
5. 选择 "QQ扫码登录" 或 "微信扫码登录"
6. 使用手机扫描二维码并确认登录

### 首页功能

- **每日推荐** - 登录后显示个性化推荐歌曲
- **猜你喜欢** - 显示推荐歌曲，可点击"换一批"刷新
- **搜索歌曲** - 进入搜索页面

### 播放控制

- 点击歌曲开始播放
- 底部播放条显示当前播放歌曲
- 支持播放/暂停、快进/快退

## 🛠️ 开发

### 项目结构

```
decky-qqmusic/
├── main.py                     # Python 后端主文件
├── py_modules/                 # Python 依赖
│   └── qqmusic_api/            # QQ音乐 API 库
├── src/
│   ├── index.tsx               # 前端入口
│   ├── api/
│   │   └── index.ts            # API 调用封装
│   ├── components/
│   │   ├── index.ts            # 组件导出
│   │   ├── LoginPage.tsx       # 登录页面
│   │   ├── HomePage.tsx        # 首页（推荐）
│   │   ├── SearchPage.tsx      # 搜索页面
│   │   ├── PlayerPage.tsx      # 全屏播放器
│   │   ├── PlayerBar.tsx       # 迷你播放条
│   │   ├── SongItem.tsx        # 歌曲列表项
│   │   └── SongList.tsx        # 歌曲列表
│   ├── hooks/
│   │   └── usePlayer.ts        # 播放器状态管理
│   ├── utils/
│   │   └── format.ts           # 格式化工具
│   └── types.d.ts              # TypeScript 类型定义
├── dist/                       # 构建输出
├── plugin.json                 # 插件配置
├── package.json                # 前端依赖配置
└── defaults/
    └── defaults.txt            # 默认配置
```

### API 接口

#### 登录相关

| 方法 | 说明 |
|------|------|
| `get_qr_code(login_type)` | 获取登录二维码 |
| `check_qr_status()` | 检查扫码状态 |
| `get_login_status()` | 获取登录状态 |
| `logout()` | 退出登录 |

#### 推荐相关

| 方法 | 说明 |
|------|------|
| `get_daily_recommend()` | 获取每日推荐 |
| `get_guess_like()` | 获取猜你喜欢 |
| `get_recommend_playlists()` | 获取推荐歌单 |
| `get_fav_songs(page, num)` | 获取收藏歌曲 |

#### 搜索相关

| 方法 | 说明 |
|------|------|
| `search_songs(keyword, page, num)` | 搜索歌曲 |
| `get_hot_search()` | 获取热门搜索 |

#### 播放相关

| 方法 | 说明 |
|------|------|
| `get_song_url(mid)` | 获取歌曲播放链接 |
| `get_song_lyric(mid)` | 获取歌词 |
| `get_song_info(mid)` | 获取歌曲详情 |

### 环境变量

插件使用以下 Decky 环境变量：

- `DECKY_PLUGIN_SETTINGS_DIR` - 存储用户凭证和配置
- `DECKY_PLUGIN_LOG_DIR` - 存储日志文件

### 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式（监听文件变化）
pnpm run watch

# 构建生产版本
pnpm run build
```

## 📋 待办事项

- [ ] 歌词同步滚动显示
- [ ] 播放列表管理
- [ ] 歌单/专辑浏览
- [ ] 音质选择
- [ ] 后台播放支持
- [ ] 桌面歌词

## ⚠️ 注意事项

- 部分歌曲可能需要 QQ 音乐 VIP 才能播放
- 请遵守 QQ 音乐的使用条款
- 本插件仅供学习交流使用

## 📄 许可证

BSD-3-Clause License

## 🙏 致谢

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) - Steam Deck 插件加载器
- [qqmusic-api-python](https://github.com/luren-dc/QQMusicApi) - QQ 音乐 API 库
- [decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template) - 插件模板
