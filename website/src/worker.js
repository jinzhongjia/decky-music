// Decky Music 官网 Worker:静态页面由 assets 直出,这里只处理 /api/*。
// /api/releases 代理 GitHub Releases,裁剪成前端需要的字段并在边缘缓存,
// 避免每个访客都直连 GitHub API。必须配 GITHUB_TOKEN:Workers 出口 IP 多租户共享,
// 匿名额度(60 次/小时/IP)常被别人耗尽而 403。

const REPO = "jinzhongjia/decky-music";
const CACHE_TTL = 3600; // 秒
const CN_MIRROR = "https://dl.nvimer.org/decky_music/decky-music-cn.zip";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/releases") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "method_not_allowed" }, 405);
      }
      return releases(request, env, ctx);
    }
    return json({ error: "not_found" }, 404);
  },
};

async function releases(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/api/releases", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  let body;
  try {
    body = await fetchReleases(env);
  } catch (err) {
    console.warn("releases upstream failed:", String(err));
    // 上游失败不缓存,前端会退回页面内置的版本信息
    return json({ error: "upstream_unavailable" }, 502, 0);
  }
  const res = json(body, 200, CACHE_TTL);
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function fetchReleases(env) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "decky-music-site",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=8`, { headers });
  if (!res.ok) throw new Error(`github ${res.status}`);
  const list = (await res.json()).filter((r) => !r.draft);
  const stable = list.find((r) => !r.prerelease) ?? list[0];
  if (!stable) throw new Error("no releases");

  return {
    latest: shape(stable),
    recent: list.slice(0, 6).map((r) => ({
      ...shape(r),
      notes: summarize(r.body ?? ""),
    })),
    cnMirror: CN_MIRROR,
  };
}

function shape(r) {
  return {
    tag: r.tag_name,
    name: r.name || r.tag_name,
    prerelease: r.prerelease,
    publishedAt: r.published_at,
    url: r.html_url,
    assets: (r.assets ?? []).map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
    })),
  };
}

// 只留发版说明「安装」小节之前的列表项,前端当纯文本渲染(不信任 Markdown/HTML)
function summarize(md) {
  const lines = md.split("\n").map((l) => l.trim());
  const stop = lines.findIndex((l) => /^#+\s*(安装|install)/i.test(l));
  return lines
    .slice(0, stop < 0 ? undefined : stop)
    .filter((l) => /^[-*] /.test(l))
    .map((l) =>
      l
        .slice(2)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[*`_]/g, "")
    )
    .slice(0, 3);
}

function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}
