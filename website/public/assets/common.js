// 全站共用:中英切换。偏好只是便利项,存储不可用时本次会话内照样生效
(function () {
  var btn = document.querySelector("[data-lang-toggle]");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var next = document.documentElement.lang === "en" ? "zh" : "en";
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem("lang", next);
    } catch (e) {}
    document.dispatchEvent(new CustomEvent("langchange"));
  });
})();
