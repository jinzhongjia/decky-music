// 文档页:移动端目录开关、本页目录高亮、mermaid 图按需加载
(function () {
  "use strict";

  var btn = document.querySelector(".docs-menu");
  var side = document.getElementById("docs-side");
  if (btn && side) {
    btn.addEventListener("click", function () {
      var open = side.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    });
  }

  var links = Array.prototype.slice.call(document.querySelectorAll(".docs-toc a"));
  if (links.length && "IntersectionObserver" in window) {
    var byId = {};
    links.forEach(function (a) {
      byId[decodeURIComponent(a.hash.slice(1))] = a;
    });
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (a) {
            a.classList.remove("on");
          });
          var a = byId[e.target.id];
          if (a) a.classList.add("on");
        });
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );
    document.querySelectorAll(".md h2[id], .md h3[id]").forEach(function (h) {
      io.observe(h);
    });
  }

  // 只有含 mermaid 的页面才去拉库;加载失败时保留源码文本,不影响阅读
  if (document.querySelector("pre.mermaid")) {
    import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")
      .then(function (m) {
        m.default.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        return m.default.run({ querySelector: "pre.mermaid" });
      })
      .catch(function () {});
  }
})();
