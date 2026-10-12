// 商店页交互:媒体轮播、截图标签与灯箱、复制安装链接、最新版本信息
(function () {
  "use strict";

  var $ = function (s, r) {
    return (r || document).querySelector(s);
  };
  var $$ = function (s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s));
  };
  var isEn = function () {
    return document.documentElement.lang === "en";
  };
  var t = function (zh, en) {
    return isEn() ? en : zh;
  };

  var REPO = "https://github.com/jinzhongjia/decky-music";
  var urls = {
    std: REPO + "/releases/latest/download/Decky.Music.zip",
    cn: "https://dl.nvimer.org/decky_music/decky-music-cn.zip",
    full: REPO + "/releases/latest/download/Decky.Music.full.zip",
  };

  // ---------- 媒体轮播 ----------
  function carousel() {
    var viewer = $("#viewer");
    var strip = $("#strip");
    if (!viewer || !strip) return;
    var slides = $$(".slide", viewer);
    var thumbs = $$(".thumb", strip);
    var cur = 0;
    var timer = null;

    function show(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        s.classList.toggle("is-on", k === cur);
      });
      thumbs.forEach(function (b, k) {
        b.classList.toggle("is-on", k === cur);
      });
      // 只滚动缩略图条本身,不能用 scrollIntoView(会把整页拉过去)
      var th = thumbs[cur];
      strip.scrollTo({
        left: th.offsetLeft - strip.clientWidth / 2 + th.clientWidth / 2,
        behavior: "smooth",
      });
    }
    function play() {
      stop();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      timer = setInterval(function () {
        if (!document.hidden) show(cur + 1);
      }, 6000);
    }
    function stop() {
      clearInterval(timer);
    }

    thumbs.forEach(function (b, k) {
      b.addEventListener("click", function () {
        show(k);
        play();
      });
    });
    $(".prev", viewer).addEventListener("click", function () {
      show(cur - 1);
      play();
    });
    $(".next", viewer).addEventListener("click", function () {
      show(cur + 1);
      play();
    });
    viewer.addEventListener("mouseenter", stop);
    viewer.addEventListener("mouseleave", play);
    viewer.addEventListener("click", function (e) {
      if (e.target.closest(".nav")) return;
      openBox(
        slides.map(function (s) {
          return { src: $("img", s).src, cap: $("figcaption", s) };
        }),
        cur
      );
    });
    play();
  }

  // ---------- 截图标签 ----------
  function tabs() {
    $$(".tabs [data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".tabs [data-tab]").forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        $$(".gallery[data-panel]").forEach(function (g) {
          g.hidden = g.dataset.panel !== btn.dataset.tab;
        });
      });
    });
  }

  // ---------- 灯箱 ----------
  var box = { items: [], i: 0 };
  function openBox(items, i) {
    box.items = items;
    var lb = $("#lightbox");
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    renderBox(i);
    $(".lb-close", lb).focus();
  }
  function renderBox(i) {
    box.i = (i + box.items.length) % box.items.length;
    var it = box.items[box.i];
    var lb = $("#lightbox");
    $("img", lb).src = it.src;
    var cap = $("figcaption", lb);
    cap.textContent = "";
    if (it.cap) cap.appendChild(it.cap.cloneNode(true));
    $$(".lb-nav", lb).forEach(function (b) {
      b.hidden = box.items.length < 2;
    });
  }
  function closeBox() {
    $("#lightbox").hidden = true;
    document.body.style.overflow = "";
  }
  function lightbox() {
    var lb = $("#lightbox");
    if (!lb) return;
    $(".lb-close", lb).addEventListener("click", closeBox);
    $(".lb-nav.prev", lb).addEventListener("click", function () {
      renderBox(box.i - 1);
    });
    $(".lb-nav.next", lb).addEventListener("click", function () {
      renderBox(box.i + 1);
    });
    lb.addEventListener("click", function (e) {
      if (e.target === lb) closeBox();
    });
    document.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") closeBox();
      if (e.key === "ArrowLeft") renderBox(box.i - 1);
      if (e.key === "ArrowRight") renderBox(box.i + 1);
    });

    $$(".gallery").forEach(function (g) {
      g.addEventListener("click", function (e) {
        var a = e.target.closest(".shot");
        if (!a) return;
        e.preventDefault();
        var shots = $$(".shot", g);
        openBox(
          shots.map(function (s) {
            return { src: s.getAttribute("href"), cap: $("span", s) };
          }),
          shots.indexOf(a)
        );
      });
    });
    $$(".feat img[data-full]").forEach(function (img) {
      img.addEventListener("click", function () {
        openBox([{ src: img.dataset.full, cap: $("h3", img.parentNode) }], 0);
      });
    });
  }

  // ---------- 复制安装链接 ----------
  var toastTimer;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 3600);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (ok, fail) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try {
        done = document.execCommand("copy");
      } catch (e) {}
      ta.remove();
      done ? ok() : fail();
    });
  }
  function copyButtons() {
    $$("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var url = urls[btn.dataset.copy];
        copyText(url).then(
          function () {
            toast(
              t(
                "已复制！粘贴到 Decky 设置 › Manual Plugin Install 即可安装",
                "Copied! Paste it into Decky settings › Manual Plugin Install"
              )
            );
          },
          function () {
            window.prompt(t("复制这个安装链接：", "Copy this install URL:"), url);
          }
        );
      });
    });
  }

  // ---------- 最新版本(Worker 代理 GitHub,失败时保留页面内置信息) ----------
  var MB = function (bytes) {
    return (bytes / 1e6).toFixed(1) + " MB";
  };
  var day = function (iso) {
    return iso ? iso.slice(0, 10) : "";
  };

  function applyRelease(data) {
    var rel = data.latest;
    var assets = {};
    rel.assets.forEach(function (a) {
      assets[a.name] = a;
    });

    $$('[data-rel="tag"]').forEach(function (el) {
      el.textContent = rel.tag;
    });
    $$('[data-rel="tag-link"]').forEach(function (el) {
      el.textContent = rel.tag;
      el.href = rel.url;
    });
    $$('[data-rel="date"]').forEach(function (el) {
      el.textContent = day(rel.publishedAt);
    });
    $$("[data-asset]").forEach(function (el) {
      var a = assets[el.dataset.asset];
      if (a) el.textContent = MB(a.size);
    });
    $$("[data-asset-size]").forEach(function (el) {
      var a = assets[el.dataset.assetSize];
      if (a) el.textContent = "≈ " + MB(a.size);
    });

    // 固定版本的直链比 latest 重定向少一跳,也避免发版瞬间 latest 指向不一致
    if (assets["Decky.Music.zip"]) urls.std = assets["Decky.Music.zip"].url;
    if (assets["Decky.Music.full.zip"]) urls.full = assets["Decky.Music.full.zip"].url;
    if (data.cnMirror) urls.cn = data.cnMirror;
    $$("[data-dl]").forEach(function (a) {
      a.href = urls[a.dataset.dl];
    });

    var parts = ["Decky.Music.zip", "player-linux-x64", "provider-linux-x64"];
    if (
      parts.every(function (n) {
        return assets[n];
      })
    ) {
      var total = parts.reduce(function (s, n) {
        return s + assets[n].size;
      }, 0);
      var el = $("[data-total-download]");
      if (el) el.innerHTML = "≈ " + (total / 1e6).toFixed(1) + " <small>MB</small>";
    }

    renderNews(data.recent || []);
  }

  // 发版说明当纯文本处理,全部走 textContent
  function renderNews(list) {
    var box = $("#news-list");
    if (!box || !list.length) return;
    box.textContent = "";
    list.slice(0, 6).forEach(function (r) {
      var card = document.createElement("article");
      card.className = "ev";
      var tag = document.createElement("div");
      tag.className = "ev-tag" + (r.prerelease ? " pre" : "");
      tag.textContent = r.prerelease ? r.tag + " · pre-release" : r.tag;
      var time = document.createElement("time");
      time.dateTime = r.publishedAt || "";
      time.textContent = day(r.publishedAt);
      var h = document.createElement("h4");
      h.textContent = r.name && r.name !== r.tag ? r.name : "Decky Music " + r.tag;
      card.append(tag, time, h);
      if (r.notes && r.notes.length) {
        var ul = document.createElement("ul");
        r.notes.forEach(function (n) {
          var li = document.createElement("li");
          li.textContent = n;
          ul.appendChild(li);
        });
        card.appendChild(ul);
      }
      var a = document.createElement("a");
      a.href = r.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = t("查看发布说明 ›", "Release notes ›");
      a.className = "ev-link";
      card.appendChild(a);
      box.appendChild(card);
    });
  }

  var lastRelease = null;
  function loadRelease() {
    if (!window.fetch) return;
    fetch("/api/releases", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && data.latest) {
          lastRelease = data;
          applyRelease(data);
        }
      })
      .catch(function () {});
  }
  // 卡片里的「查看发布说明」是 JS 生成的文案,切换语言时重绘
  document.addEventListener("langchange", function () {
    if (lastRelease) renderNews(lastRelease.recent || []);
  });

  carousel();
  tabs();
  lightbox();
  copyButtons();
  loadRelease();
})();
