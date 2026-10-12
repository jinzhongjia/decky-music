# Decky Music 官网

Steam 商店页风格的项目网站，部署在 Cloudflare Workers（静态资源 + 一个很小的 Worker）。

- 首页 `/`：介绍、媒体轮播、安装入口（标准 / CN 镜像 / full）、实机截图、性能、架构、系统需求、更新日志
- 文档 `/docs/*`：构建时直接渲染仓库里的 Markdown（`README.md` 的开发章节、`AGENTS.md`、`docs/*.md`、UI 规格）
- `/api/releases`：Worker 代理 GitHub Releases，裁剪字段后在边缘缓存 10 分钟；失败时页面保留构建期内置的版本信息

## 目录

| 路径 | 说明 |
| :--- | :--- |
| `public/` | 页面骨架与静态资源（CSS / JS / 品牌图 / `_headers`） |
| `partials/` | 构建期展开的片段：`<!-- @include x -->` |
| `build/build.mjs` | 构建入口：`public/` → `dist/`，展开片段、生成画廊与文档页 |
| `build/media.mjs` | 实机截图 / 渲染图 PNG → WebP（libvips，带 `.cache/` 增量缓存）；截图场景表也在这里 |
| `build/docs.mjs` | Markdown → 文档页；文档列表与侧栏分组在 `DOCS` |
| `src/worker.js` | 只处理 `/api/*` 的 Worker |

## 本地开发

前置：Node、pnpm、本机 `vips` 命令（libvips），以及已拉取的 Git LFS 图片（`git lfs pull`）。

```bash
cd website
pnpm install
pnpm build          # 产物在 dist/
pnpm dev            # 构建 + wrangler dev（http://localhost:8787）
```

`?lang=en` / `?lang=zh` 可强制语言（会记住偏好）。

## 部署

```bash
cd website
pnpm deploy         # 构建 + wrangler deploy（首次会要求 wrangler login）
```

必需：`wrangler secret put GITHUB_TOKEN`（fine-grained，Public repositories 只读、不勾任何权限）。Workers 出口 IP 多租户共享，匿名访问 GitHub API 会 403，版本信息就只能退回页面内置值。
绑定自定义域名在 Cloudflare 控制台的 Worker › Settings › Domains & Routes 中配置。

## 内容更新

- 新截图：放进 `docs/ui-design/assets/device-screenshots/<provider>/` 后在 `build/media.mjs` 的 `SCENES` 加一行。
- 性能数字：在 `partials/store-perf.html`，数据来源为 `docs/ROADMAP.md` 的真机 / 本地实测记录；改数字时同步改出处。
- 版本号、发布日期、包体大小、更新日志由 `/api/releases` 实时填充，发版后无需改网站。
