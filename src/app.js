// 入口：按 URL 决定渲染首页还是城市页，并在两者之间切换。
//
// 只有一个 HTML 文件，两个视图靠 hidden 切换。城市页的 DOM（尤其是地图容器）
// 始终留在文档里不重建——Leaflet 实例重建一次就要重新拉一遍瓦片，而且容器尺寸
// 在 hidden 状态下是 0，重建时机稍有不慎就会得到一张灰图。

import { h, fill, toast, errorBlock } from './dom.js';
import { renderHome } from './ui/home.js';
import { createPanel } from './ui/panel.js';
import { loadCategories, loadCity } from './data/loader.js';
import { createMap } from './map/mapview.js';
import { createMarkerLayer } from './map/markers.js';
import { BASEMAPS, DEFAULT_BASEMAP, findBasemap } from './map/basemaps.js';

const views = {
  home: document.getElementById('view-home'),
  city: document.getElementById('view-city'),
};

const dom = {
  cityName: document.getElementById('city-name'),
  basemapSwitch: document.getElementById('basemap-switch'),
  panel: document.getElementById('panel'),
  map: document.getElementById('map'),
};

// 城市页是有状态的：地图实例和标记层跨路由复用，切城市只换数据不重建地图
const ctx = {
  categories: null,
  cityId: null,
  city: null,
  mapView: null,
  markers: null,
  panel: null,
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function navigate(search, { replace = false } = {}) {
  const url = search ? `${location.pathname}?${search}` : location.pathname;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  route();
}

function renderBasemapSwitch(activeId) {
  fill(dom.basemapSwitch, ...BASEMAPS.map((b) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(b.id === activeId),
      title: `${b.label}底图（${b.datum === 'gcj02' ? '火星坐标' : 'GPS 坐标'}）`,
      onclick: () => {
        const next = ctx.mapView.setBasemap(b.id);
        renderBasemapSwitch(next.id);
        const params = new URLSearchParams(location.search);
        // 换底图只是看图习惯，不该塞进浏览历史
        if (next.id === DEFAULT_BASEMAP) params.delete('base'); else params.set('base', next.id);
        history.replaceState({}, '', `${location.pathname}?${params}`);
      },
    }, b.label)));
}

function selectPoi(poiId, { pan = true } = {}) {
  const poi = ctx.city.pois.find((p) => p.id === poiId);
  if (!poi) return;
  ctx.markers.setActive(poiId);
  ctx.panel.showPoi(poi, ctx.city);

  if (pan) {
    // 面板会盖住地图：桌面挡右边，窄屏挡下边，定位时让开对应的那块
    const wide = window.matchMedia('(min-width: 900px)').matches;
    ctx.mapView.focus(poi.coord, {
      padding: wide
        ? { bottomRight: [dom.panel.offsetWidth + 40, 40], topLeft: [40, 40] }
        : { bottomRight: [0, ctx.panel.sheetHeight() + 30], topLeft: [20, 20] },
    });
  }

  const params = new URLSearchParams(location.search);
  params.set('poi', poiId);
  history.replaceState({}, '', `${location.pathname}?${params}`);
}

async function showCity(cityId, params) {
  showView('city');
  dom.cityName.textContent = '加载中…';

  ctx.categories ??= await loadCategories();

  if (ctx.cityId !== cityId) {
    let loaded;
    try {
      loaded = await loadCity(cityId, ctx.categories);
    } catch (err) {
      console.error(err);
      dom.cityName.textContent = '出错了';
      fill(dom.panel, errorBlock(`没能打开「${cityId}」`, err));
      return;
    }
    ctx.cityId = cityId;
    ctx.city = loaded.city;
    dom.cityName.textContent = loaded.entry.name ?? loaded.city.name;
    document.title = `${loaded.city.name} · 城市旅游攻略图鉴`;

    const baseId = findBasemap(params.get('base') ?? DEFAULT_BASEMAP).id;
    if (!ctx.mapView) {
      ctx.mapView = createMap(dom.map, {
        center: ctx.city.center,
        zoom: ctx.city.zoom,
        basemap: baseId,
        onBasemapFallback: (failed, next) =>
          toast(`${failed.label}的瓦片拉不动，已切到${next.label}`, 'warn', 4000),
      });
      ctx.markers = createMarkerLayer(ctx.mapView, {
        categories: ctx.categories,
        onSelect: (id) => selectPoi(id),
      });
      ctx.panel = createPanel(dom.panel, {
        categories: ctx.categories,
        onSelect: (id) => selectPoi(id),
        // 抽屉换档会改变地图可视区域，必须让 Leaflet 重新量一次
        onSnapChange: () => ctx.mapView.refreshSize(),
      });
    } else {
      ctx.mapView.setBasemap(baseId);
    }
    renderBasemapSwitch(ctx.mapView.basemap().id);
    ctx.markers.render(ctx.city.pois);
    ctx.panel.showOverview(ctx.city);
    ctx.mapView.fitToPois(ctx.city.pois);
    // 从首页切过来时容器刚从 hidden 变可见，尺寸要重新量一次
    ctx.mapView.refreshSize();
  }

  const poiId = params.get('poi');
  if (poiId) {
    if (ctx.city.pois.some((p) => p.id === poiId)) {
      selectPoi(poiId);
    } else {
      // 链接里的点位已经被删了或者 id 打错了：提示一下，降级成城市全景，不白屏
      toast(`这座城市没有 id 为「${poiId}」的点位`, 'warn', 4000);
      ctx.panel.showOverview(ctx.city);
    }
  }
}

async function route() {
  const params = new URLSearchParams(location.search);
  const cityId = params.get('city');

  if (!cityId) {
    showView('home');
    await renderHome({ onOpen: (id) => navigate(`city=${encodeURIComponent(id)}`) });
    return;
  }
  await showCity(cityId, params);
}

window.addEventListener('popstate', route);

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
