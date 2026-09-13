// 入口：按 URL 决定渲染首页还是城市页，并在两者之间切换。
//
// 只有一个 HTML 文件，两个视图靠 hidden 切换。城市页的 DOM（尤其是地图容器）
// 始终留在文档里不重建——Leaflet 实例重建一次就要重新拉一遍瓦片，而且容器尺寸
// 在 hidden 状态下是 0，重建时机稍有不慎就会得到一张灰图。

import { toast } from './dom.js';
import { renderHome } from './ui/home.js';

const views = {
  home: document.getElementById('view-home'),
  city: document.getElementById('view-city'),
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function navigate(search, { replace = false } = {}) {
  const url = search ? `${location.pathname}?${search}` : location.pathname;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  route();
}

async function route() {
  const params = new URLSearchParams(location.search);
  const cityId = params.get('city');

  if (!cityId) {
    showView('home');
    await renderHome({ onOpen: (id) => navigate(`city=${encodeURIComponent(id)}`) });
    return;
  }

  showView('city');
  document.getElementById('city-name').textContent = cityId;
  // 地图、筛选、详情面板在后续步骤接上
}

window.addEventListener('popstate', route);

// 顶栏的「返回」用 SPA 跳转，不走整页刷新
document.getElementById('back-home').addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate('');
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('未捕获的异步错误', e.reason);
  toast(`出错了：${e.reason?.message ?? e.reason}`, 'err', 5000);
});

route();
