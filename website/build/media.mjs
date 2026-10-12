// 媒体流水线:把 docs/ui-design 下的实机截图 / 实机渲染图转成网页用的 WebP。
// 产物缓存在 .cache/media(按源文件 mtime 判断是否需要重做),再复制进 dist/media。
// 依赖本机 libvips 的 `vips` 命令;源图是 Git LFS 文件,需先 `git lfs pull`。

import { execFileSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const SCENES = [
  ["01-home", "首页推荐", "Home"],
  ["02-home-toplists", "排行榜", "Charts"],
  ["03-toplist-detail", "榜单详情", "Chart detail"],
  ["04-search-hot", "热搜", "Trending searches"],
  ["05-search-songs", "搜索歌曲", "Song search"],
  ["06-search-playlists", "搜索歌单", "Playlist search"],
  ["07-playlist-detail", "歌单详情", "Playlist detail"],
  ["08-search-albums", "搜索专辑", "Album search"],
  ["09-album-detail", "专辑详情", "Album detail"],
  ["10-search-artists", "搜索歌手", "Artist search"],
  ["11-artist-detail", "歌手详情", "Artist detail"],
  ["12-my-fav", "我喜欢的歌曲", "Liked songs"],
  ["13-my-rank", "听歌排行", "Listening rank"],
  ["14-my-created", "自建歌单", "My playlists"],
  ["15-my-favlists", "收藏歌单", "Saved playlists"],
  ["16-fm-entry", "私人 FM 入口", "Personal FM"],
  ["17-radio-immersive", "沉浸电台", "Immersive radio"],
  ["18-nowplaying", "正在播放 · 歌词", "Now playing · lyrics"],
  ["19-queue-normal", "播放队列", "Play queue"],
  ["20-queue-radio", "电台队列", "Radio queue"],
  ["21-invalid-request-error", "错误降级提示", "Graceful error state"],
];

export const RENDERS = [
  ["qq", "05-nowplaying", "QQ 音乐 · 正在播放", "QQ Music · Now playing"],
  ["ncm", "04-radio", "网易云 · 私人 FM", "NetEase · Personal FM"],
  ["qq", "01-home", "QQ 音乐 · 推荐", "QQ Music · For you"],
  ["ncm", "05-nowplaying", "网易云 · 逐字歌词", "NetEase · Word-synced lyrics"],
  ["qq", "02-search", "QQ 音乐 · 搜索", "QQ Music · Search"],
  ["ncm", "01-home", "网易云 · 发现", "NetEase · Discover"],
  ["qq", "03-my-music", "QQ 音乐 · 我的音乐", "QQ Music · My music"],
  ["ncm", "02-search", "网易云 · 搜索", "NetEase · Search"],
  ["qq", "04-radio", "QQ 音乐 · 智能电台", "QQ Music · Smart radio"],
  ["ncm", "03-my-music", "网易云 · 我的", "NetEase · My music"],
];

const ASSETS = "docs/ui-design/assets";

// 截图存在才进画廊:QQ 侧没有 13/16 场景,两端数量本就不同
export function screenshotsOf(root, provider) {
  return SCENES.filter(([id]) =>
    existsSync(join(root, ASSETS, "device-screenshots", provider, `${id}.png`))
  );
}

export function buildMedia(root, cacheDir, outDir) {
  const jobs = [];
  for (const p of ["qq", "ncm"]) {
    for (const [id] of screenshotsOf(root, p)) {
      const src = join(root, ASSETS, "device-screenshots", p, `${id}.png`);
      jobs.push([src, `shots/${p}/${id}.webp`, 1280, 82]);
      jobs.push([src, `shots/${p}/${id}.thumb.webp`, 400, 76]);
    }
  }
  for (const [p, id] of RENDERS) {
    const src = join(root, ASSETS, "device-renders", p, `${id}.png`);
    jobs.push([src, `renders/${p}-${id}.webp`, 1600, 78]);
    jobs.push([src, `renders/${p}-${id}.thumb.webp`, 240, 72]);
  }
  // 页面背景:极小图 + CSS 模糊,几 KB 就能铺满
  jobs.push([join(root, ASSETS, "device-renders", "qq", "05-nowplaying.png"), "bg.webp", 160, 60]);

  let made = 0;
  for (const [src, rel, width, q] of jobs) {
    if (convert(src, join(cacheDir, rel), width, q)) made++;
  }
  mkdirSync(outDir, { recursive: true });
  cpSync(cacheDir, outDir, { recursive: true });
  return { total: jobs.length, made };
}

function convert(src, dest, width, q) {
  assertRealPng(src);
  if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) {
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync("vips", ["thumbnail", src, `${dest}[Q=${q},strip]`, String(width)], {
    stdio: ["ignore", "ignore", "pipe"],
  }); // 本机 libvips 缺可选模块时的告警不刷屏,失败时仍随异常抛出
  return true;
}

function assertRealPng(src) {
  const head = Buffer.alloc(4);
  const fd = openSync(src, "r");
  readSync(fd, head, 0, 4, 0);
  closeSync(fd);
  if (head.toString("latin1", 1, 4) !== "PNG") {
    throw new Error(`${src} 不是 PNG(Git LFS 指针?先运行 git lfs pull)`);
  }
}
