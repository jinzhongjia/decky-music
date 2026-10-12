// 网站构建入口:public/ → dist/,展开 partials,生成画廊与文档页,处理媒体。
// 用法:node build/build.mjs   (产物在 website/dist,供 wrangler 作为静态资源上传)

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDocs } from "./docs.mjs";
import { buildMedia, RENDERS, screenshotsOf } from "./media.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(site, "..");
const dist = join(site, "dist");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const vars = { version: pkg.version, year: String(new Date().getFullYear()) };

const partial = (name) => readFileSync(join(site, "partials", `${name}.html`), "utf8");

// `<!-- @include x -->` 展开 partials/x.html;`{{var}}` 替换构建期变量
function expand(html) {
  return html
    .replace(/<!-- @include ([\w-]+) -->/g, (_, n) => expand(partial(n)))
    .replace(/<!-- @hero -->/g, heroHtml)
    .replace(/<!-- @gallery (qq|ncm) -->/g, (_, p) => galleryHtml(p))
    .replace(/\{\{(version|year)\}\}/g, (_, k) => vars[k]);
}

const bi = (zh, en) => `<span class="zh">${zh}</span><span class="en">${en}</span>`;

function heroHtml() {
  const slides = RENDERS.map(
    ([p, id, zh, en], i) =>
      `<figure class="slide${i ? "" : " is-on"}" data-i="${i}"><img src="/media/renders/${p}-${id}.webp" alt="${zh}" width="1600" height="900"${i ? ' loading="lazy"' : ' fetchpriority="high"'}><figcaption>${bi(zh, en)}</figcaption></figure>`
  ).join("");
  const thumbs = RENDERS.map(
    ([p, id, zh], i) =>
      `<button class="thumb${i ? "" : " is-on"}" data-i="${i}" aria-label="${zh}"><img src="/media/renders/${p}-${id}.thumb.webp" alt="" width="240" height="135" loading="lazy"></button>`
  ).join("");
  return `<div class="viewer" id="viewer">${slides}<button class="nav prev" aria-label="Previous">‹</button><button class="nav next" aria-label="Next">›</button></div><div class="strip" id="strip">${thumbs}</div>`;
}

function galleryHtml(p) {
  return screenshotsOf(root, p)
    .map(
      ([id, zh, en]) =>
        `<a class="shot" href="/media/shots/${p}/${id}.webp" data-zh="${zh}" data-en="${en}"><img src="/media/shots/${p}/${id}.thumb.webp" alt="${zh}" width="400" height="250" loading="lazy"><span>${bi(zh, en)}</span></a>`
    )
    .join("");
}

rmSync(dist, { recursive: true, force: true });
cpSync(join(site, "public"), dist, { recursive: true });

for (const f of readdirSync(dist).filter((f) => f.endsWith(".html"))) {
  const file = join(dist, f);
  writeFileSync(file, expand(readFileSync(file, "utf8")));
}

const docs = buildDocs(root, join(dist, "docs"), expand(partial("docs-page")));
const media = buildMedia(root, join(site, ".cache", "media"), join(dist, "media"));

console.log(`docs: ${docs} pages · media: ${media.total} files (${media.made} regenerated)`);
console.log(`→ ${dist}`);
