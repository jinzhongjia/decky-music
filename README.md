# Decky QQ Music 插件

在 Steam Deck 上享受 QQ 音乐的 Decky Loader 插件。

<p align="center">
  <img src="https://private-user-images.githubusercontent.com/41784264/530347979-ad03569b-7bfc-4aa0-9847-7d82fa666288.jpg?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NjY3NDk5OTIsIm5iZiI6MTc2Njc0OTY5MiwicGF0aCI6Ii80MTc4NDI2NC81MzAzNDc5NzktYWQwMzU2OWItN2JmYy00YWEwLTk4NDctN2Q4MmZhNjY2Mjg4LmpwZz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTEyMjYlMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUxMjI2VDExNDgxMlomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTdkYjQ4NTk2MjI1MGMwMWZjNWU0NDg1NmFmZGMwNTJmOGQxZDdjMzc1OTNiYTM0ZjUzYmUyNjVlOGMzMDNlYjUmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.0G9e0l-pCcOgQ6XZhyy_mFNuUU7a96VgcfLhGbpOMbU" width="600" />
</p>


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

1. 从 [Releases](https://github.com/jinzhongjia/decky-qqmusic/releases) 下载最新的 `QQMusic.zip`
2. 将 zip 文件传输到 Steam Deck
3. 解压到 `~/homebrew/plugins/`
4. 重启 Decky Loader

### 从源码构建

> ⚠️ 注意：使用 Docker 构建，确保已安装 Docker。

**方法 1：使用 GitHub Actions（推荐）**

Fork 此仓库后，GitHub Actions 会自动构建。创建 tag 时会自动发布 Release。

**方法 2：本地构建**

需要安装 [mise](https://mise.jdx.dev/) 和 Docker。

```bash
git clone https://github.com/your-username/decky-qqmusic.git
cd decky-qqmusic

# 构建
mise run build

# 输出文件: out/QQMusic.zip 和 out/QQMusic/
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
- 支持使用 x 控制暂停/播放
- 支持使用 L1/R1 切换上一首/下一首
- 全屏播放器支持显示歌词

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

### 部署到 Steam Deck

使用 mise 可以快速构建并部署到 Steam Deck。

**0. 开启 Steam Deck SSH 服务**（在 Steam Deck 上执行，只需一次）

```bash
# 设置 deck 用户密码（首次需要）
passwd

# 启动并设置开机自启
sudo systemctl enable --now sshd
```

**1. 配置 SSH 免密登录**

Linux / WSL:
```bash
ssh-copy-id deck@<STEAM_DECK_IP>
```

Windows PowerShell:
```powershell
type $env:USERPROFILE\.ssh\id_rsa.pub | ssh deck@<STEAM_DECK_IP> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

**2. Steam Deck 权限配置**（在 Steam Deck 上执行，只需一次）

```bash
# 修改插件目录权限，允许 deck 用户读写
sudo chown -R deck:deck /home/deck/homebrew/plugins

# 配置 sudo 免密码（用于远程重启服务）
echo "%wheel ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/wheel
```

**3. 修改配置**

编辑 `.mise.toml` 中的 `DECK_HOST`：
```toml
DECK_HOST = "deck@<STEAM_DECK_IP>"
```

**4. 部署命令**

```bash
# 仅同步（已构建过）
mise run deploy

# 构建并部署
mise run dev
```

## 🚀 发版流程

1. 更新版本号（`plugin.json` 和 `package.json`）
2. 提交代码：`git add . && git commit -m "release: v0.0.x"`
3. 打 tag：`git tag v0.0.x`
4. 推送：`git push && git push --tags`
5. GitHub Actions 会自动构建并创建 Release

## 📋 待办事项

- [ ] 音质选择
- [ ] 悬浮歌词

## ⚠️ 注意事项

- 部分歌曲可能需要 QQ 音乐 VIP 才能播放
- 请遵守 QQ 音乐的使用条款
- 本插件仅供学习交流使用

## 📄 许可证

BSD-3-Clause License

## 🙏 致谢

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) - Steam Deck 插件加载器
- [QQMusicApi](https://github.com/L-1124/QQMusicApi) - QQ 音乐 API 库 (使用 commit: 3ccc5daaf0b3d35a4b7375824b213c07687fa992)
- [decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template) - 插件模板
