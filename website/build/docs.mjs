// 文档流水线:把仓库里的 Markdown 原样渲染成站内文档页,文档以仓库为唯一事实源。
// 站内互链改写成 /docs/<slug>,其余相对链接指向 GitHub 上的源文件。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { Marked, Renderer } from "marked";

const REPO_URL = "https://github.com/jinzhongjia/decky-music";

// group 决定侧栏分组;README 片段拼成「快速开始」作为 /docs/ 首页正文
export const DOCS = [
  {
    slug: "",
    src: "README.md",
    group: "start",
    zh: "快速开始",
    en: "Getting started",
    sections: ["本地开发", "目录", "贡献"],
  },
  {
    slug: "contributing",
    src: "AGENTS.md",
    group: "start",
    zh: "开发约定",
    en: "Contributor rules",
  },
  {
    slug: "design",
    src: "docs/design/architecture.md",
    group: "arch",
    zh: "总体架构",
    en: "Architecture",
  },
  {
    slug: "protocol",
    src: "docs/design/protocol.md",
    group: "arch",
    zh: "通信协议",
    en: "Protocol",
  },
  {
    slug: "tech-stack",
    src: "docs/design/tech-stack.md",
    group: "arch",
    zh: "技术选型与分发",
    en: "Tech stack & distribution",
  },
  {
    slug: "performance",
    src: "docs/design/performance.md",
    group: "arch",
    zh: "性能设计",
    en: "Performance design",
  },
  {
    slug: "queue",
    src: "docs/design/queue.md",
    group: "arch",
    zh: "播放队列语义",
    en: "Queue semantics",
  },
  {
    slug: "provider-apis",
    src: "docs/design/provider-apis.md",
    group: "arch",
    zh: "音源 API 能力对照",
    en: "Provider API matrix",
  },
  {
    slug: "steam-menu",
    src: "docs/design/steam-menu-inject.md",
    group: "ui",
    zh: "左侧菜单注入",
    en: "Steam menu injection",
  },
  {
    slug: "ui-rules",
    src: "docs/design/ui-rules.md",
    group: "ui",
    zh: "大屏 UI 规则",
    en: "Big-picture UI rules",
  },
  {
    slug: "ui-qq",
    src: "docs/design/ui-qq.md",
    group: "ui",
    zh: "QQ 音乐页面",
    en: "QQ Music pages",
  },
  {
    slug: "ui-ncm",
    src: "docs/design/ui-ncm.md",
    group: "ui",
    zh: "网易云页面",
    en: "NetEase pages",
  },
  {
    slug: "plugin-guide",
    src: "docs/design/plugin-dev-guide.md",
    group: "guide",
    zh: "Decky 插件开发指南（英文）",
    en: "Decky plugin dev guide",
  },
  {
    slug: "plan-non-deck",
    src: "docs/plan/non-deck-validation.md",
    group: "plan",
    zh: "非 Deck 设备验收",
    en: "Non-Deck validation",
  },
  {
    slug: "plan-backlog",
    src: "docs/plan/backlog.md",
    group: "plan",
    zh: "待办",
    en: "Backlog",
  },
  {
    slug: "record-playback",
    src: "docs/record/playback.md",
    group: "record",
    zh: "播放记录",
    en: "Playback records",
  },
  {
    slug: "record-provider",
    src: "docs/record/provider.md",
    group: "record",
    zh: "Provider 记录",
    en: "Provider records",
  },
  {
    slug: "record-account",
    src: "docs/record/account-library.md",
    group: "record",
    zh: "账号与资产记录",
    en: "Account & library records",
  },
  {
    slug: "record-ui",
    src: "docs/record/ui.md",
    group: "record",
    zh: "UI 记录",
    en: "UI records",
  },
  {
    slug: "record-performance",
    src: "docs/record/performance.md",
    group: "record",
    zh: "性能与体积记录",
    en: "Performance & size records",
  },
  {
    slug: "record-device",
    src: "docs/record/device-compat.md",
    group: "record",
    zh: "设备兼容记录",
    en: "Device compatibility records",
  },
  {
    slug: "record-review",
    src: "docs/record/review-fixes.md",
    group: "record",
    zh: "审查修复记录",
    en: "Review fix records",
  },
  {
    slug: "record-screenshots",
    src: "docs/record/ui-screenshots.md",
    group: "record",
    zh: "UI 截图记录",
    en: "UI screenshot records",
  },
];

const GROUPS = [
  ["start", "入门", "Start here"],
  ["arch", "架构", "Architecture"],
  ["ui", "界面", "UI"],
  ["guide", "指南", "Guides"],
  ["plan", "计划", "Plans"],
  ["record", "记录", "Records"],
];

export const docHref = (d) => (d.slug ? `/docs/${d.slug}` : "/docs/");

export function buildDocs(root, outDir, template) {
  for (const doc of DOCS) {
    let md = readFileSync(join(root, doc.src), "utf8");
    if (doc.sections) md = pickSections(md, doc.sections);
    const { html, toc } = render(md, doc.src);
    const page = fill(template, {
      title: `${doc.zh} · Decky Music`,
      heading: `<span class="zh">${doc.zh}</span><span class="en">${doc.en}</span>`,
      sidebar: sidebar(doc),
      toc: toc.length ? tocHtml(toc) : "",
      content: html,
      source: `${REPO_URL}/blob/main/${doc.src}`,
    });
    const file = doc.slug ? join(outDir, `${doc.slug}.html`) : join(outDir, "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page);
  }
  return DOCS.length;
}

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

// 只截取 README 中指定的二级标题小节,保持其原有顺序
function pickSections(md, names) {
  const parts = md.split(/^(?=## )/m);
  return parts.filter((p) => names.some((n) => p.startsWith(`## ${n}`))).join("\n");
}

function sidebar(current) {
  return GROUPS.map(([g, zh, en]) => {
    const items = DOCS.filter((d) => d.group === g)
      .map((d) => {
        const on = d === current ? ' aria-current="page"' : "";
        return `<li><a href="${docHref(d)}"${on}><span class="zh">${d.zh}</span><span class="en">${d.en}</span></a></li>`;
      })
      .join("");
    return `<h4><span class="zh">${zh}</span><span class="en">${en}</span></h4><ul>${items}</ul>`;
  }).join("");
}

function tocHtml(toc) {
  const items = toc
    .map((t) => `<li class="lv${t.depth}"><a href="#${t.id}">${t.text}</a></li>`)
    .join("");
  return `<h4><span class="zh">本页目录</span><span class="en">On this page</span></h4><ul>${items}</ul>`;
}

// GitHub 风格锚点:保留字母(含中文)、数字、连字符,空格变连字符
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

function render(md, srcPath) {
  const toc = [];
  const seen = new Map();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(text) || "section";
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth === 2 || depth === 3)
          toc.push({ depth, id, text: inner.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const target = rewrite(href, srcPath);
        const ext = /^https?:/.test(target) ? ' target="_blank" rel="noopener"' : "";
        const t = title ? ` title="${title}"` : "";
        return `<a href="${target}"${t}${ext}>${inner}</a>`;
      },
      image({ href, text }) {
        return `<img src="${rewrite(href, srcPath, "raw")}" alt="${text}" loading="lazy">`;
      },
      code({ text, lang }) {
        if (lang !== "mermaid") return false;
        return `<pre class="mermaid">${text.replace(/</g, "&lt;")}</pre>\n`;
      },
      table(token) {
        // 宽表放进可横向滚动的容器,避免撑破移动端页面
        return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>`;
      },
    },
  });
  return { html: marked.parse(md), toc };
}

function rewrite(href, srcPath, kind = "blob") {
  if (!href || /^([a-z]+:|#|\/\/)/i.test(href)) return href;
  const [path, hash = ""] = href.split("#");
  const repoPath = posix.normalize(posix.join(posix.dirname(srcPath), path));
  const doc = DOCS.find((d) => d.src === repoPath && !d.sections);
  if (doc) return docHref(doc) + (hash ? `#${hash}` : "");
  return `${REPO_URL}/${kind}/main/${repoPath}${hash ? `#${hash}` : ""}`;
}
