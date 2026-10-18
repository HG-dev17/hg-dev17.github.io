// 导航栏自适应断点：只有真正挤不下（菜单会压到标题 / 搜索按钮）时才切到三条杠侧边栏
(function () {
  var nav, menu, title, search;
  var cachedMenuWidth = 0;

  function measure() {
    if (!menu) return;

    var rect = menu.getBoundingClientRect();
    if (getComputedStyle(menu).display !== "none" && rect.width > 0) {
      cachedMenuWidth = rect.width;
      return;
    }

    // 菜单被隐藏时临时量一次宽度（用 important 才能覆盖自定义 CSS 里的 display:none !important）
    menu.style.setProperty("display", "block", "important");
    menu.style.setProperty("visibility", "hidden", "important");
    cachedMenuWidth = menu.getBoundingClientRect().width;
    menu.style.removeProperty("display");
    menu.style.removeProperty("visibility");
  }

  function fit() {
    if (!nav || !menu || !title || !search) return;
    if (window.innerWidth <= 768) return; // 手机端交给主题处理
    if (!cachedMenuWidth) return;

    var gap = 14;
    var titleRight = title.getBoundingClientRect().right;
    var rightReserve = window.innerWidth - search.getBoundingClientRect().left;
    // 菜单水平居中：左边不能压到标题，右边不能压到搜索按钮
    var needLeft = 2 * (titleRight + gap) + cachedMenuWidth;
    var needRight = cachedMenuWidth + 2 * (rightReserve + gap);
    var threshold = Math.max(needLeft, needRight);

    nav.classList.toggle("hide-menu", window.innerWidth < threshold);
  }

  function refresh() {
    nav = document.getElementById("nav");
    menu = document.querySelector("#nav .menus_items");
    title = document.querySelector("#blog-info a");
    search = document.getElementById("search-button");
    if (!nav || !menu || !title || !search) return;
    measure();
    fit();
  }

  function schedule() {
    // 用 timer 而非 rAF：后台/隐藏标签页里 rAF 不会触发
    setTimeout(refresh, 0);
    requestAnimationFrame(function () {
      requestAnimationFrame(refresh);
    });
  }

  document.addEventListener("DOMContentLoaded", schedule);
  if (document.readyState !== "loading") schedule();
  window.addEventListener("load", schedule);
  document.addEventListener("pjax:complete", function () {
    setTimeout(schedule, 80);
  });
  window.addEventListener("resize", function () {
    setTimeout(fit, 0);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      setTimeout(schedule, 50);
    });
  }
})();
