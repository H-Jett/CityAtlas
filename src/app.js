// 入口：URL 是唯一的真相，界面只是它的投影。
//
// 所有交互都走 go(patch, mode)：改状态 → 同步 URL → applyState 把界面对齐过去。
// popstate 走同一条 applyState，所以前进后退和点击走的是同一套逻辑，不会分叉。
//
// 两个视图靠 hidden 切换，城市页的 DOM（尤其是地图容器）始终留在文档里不重建：
// Leaflet 实例重建一次就要重新拉一遍瓦片，而且容器在 hidden 状态下尺寸是 0，
// 重建时机稍有不慎就会得到一张灰图。

import { h, fill, toast, errorBlock, debounce } from './dom.js';
import { parseUrl, syncUrl, buildUrl } from './url.js';
import { renderHome } from './ui/home.js';
import { createPanel } from './ui/panel.js';
import { createFilters } from './ui/filters.js';
import { filterPois } from './ui/filter.js';
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
  filters: document.getElementById('filters'),
  poiSearch: document.getElementById('poi-search'),
};

let state = parseUrl(location.search);

// 已经反映到界面上的状态，用来跳过无谓的重算（重载城市、重画 chips 都不便宜）
const applied = { city: null, poi: null, cats: '', keyword: '', base: null };

const ctx = {
  categories: null,
  city: null,
  entry: null,
  mapView: null,
  markers: null,
  panel: null,
  filters: null,
};

const catsKey = (cats) => (cats === null ? '*' : [...cats].sort().join(','));

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

/** 唯一的状态入口：改状态 → 写 URL → 对齐界面 */
function go(patch, mode = 'push') {
  state = { ...state, ...patch };
  syncUrl(state, mode);
  applyState();
}

// ---------- 城市页 ----------

function renderBasemapSwitch(activeId) {
  fill(dom.basemapSwitch, ...BASEMAPS.map((b) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(b.id === activeId),
      title: `${b.label}底图（${b.datum === 'gcj02' ? '火星坐标 GCJ-02' : 'GPS 坐标 WGS-84'}）`,
      // 换底图是看图习惯，不该塞进浏览历史
      onclick: () => go({ base: b.id }, 'replace'),
    }, b.label)));
}

/** 重算可见集合 → 同步标记显隐 → 更新概览。返回可见点位 */
function applyFilter() {
  const visible = filterPois(ctx.city.pois, { cats: state.cats, keyword: state.keyword });
  ctx.markers.setVisible(new Set(visible.map((p) => p.id)));
  if (!state.poi) ctx.panel.showOverview(ctx.city, { visibleCount: visible.length });
  return visible;
}

function focusPoi(poi) {
  // 面板会盖住地图：桌面挡右边，窄屏挡下边，定位时让开对应的那块
  const wide = window.matchMedia('(min-width: 900px)').matches;
  ctx.mapView.focus(poi.coord, {
    padding: wide
      ? { topLeft: [40, 40], bottomRight: [dom.panel.offsetWidth + 40, 40] }
      : { topLeft: [20, 20], bottomRight: [0, ctx.panel.sheetHeight() + 30] },
  });
}

async function mountCity(cityId) {
  dom.cityName.textContent = '加载中…';
  ctx.categories ??= await loadCategories();

  const { city, entry } = await loadCity(cityId, ctx.categories);
  ctx.city = city;
  ctx.entry = entry;
  dom.cityName.textContent = entry.name ?? city.name;
  document.title = `${city.name} · 城市旅游攻略图鉴`;

  if (!ctx.mapView) {
    ctx.mapView = createMap(dom.map, {
      center: city.center,
      zoom: city.zoom,
      basemap: state.base,
      onBasemapFallback: (failed, next) => {
        toast(`${failed.label}的瓦片拉不动，已切到${next.label}`, 'warn', 4000);
        state = { ...state, base: next.id };
        syncUrl(state, 'replace');
        renderBasemapSwitch(next.id);
      },
    });
    ctx.markers = createMarkerLayer(ctx.mapView, {
      categories: ctx.categories,
      onSelect: (id) => go({ poi: id }),
    });
    ctx.panel = createPanel(dom.panel, {
      categories: ctx.categories,
      onSelect: (id) => go({ poi: id }),
      // 抽屉换档改变了地图可视区域，必须让 Leaflet 重新量一次
      onSnapChange: () => ctx.mapView.refreshSize(),
    });
    ctx.filters = createFilters(dom.filters, {
      categories: ctx.categories,
      onChange: (cats) => go({ cats }),
    });
    dom.poiSearch.addEventListener('input', debounce(() => {
      // 打字不该往历史里塞东西
      go({ keyword: dom.poiSearch.value.trim() }, 'replace');
    }, 180));
  }

  ctx.markers.render(city.pois);
  // 首次挂载也要画一次底图切换，别只在 applyState 里"基准变了才画"——
  // 第一次进来时 applied.base 和 state.base 恰好相等，那条分支不会触发
  renderBasemapSwitch(ctx.mapView.basemap().id);
  ctx.filters.setCity(city.pois, state.cats);
  dom.poiSearch.value = state.keyword;
  ctx.panel.showOverview(city);
  ctx.mapView.fitToPois(city.pois);
  ctx.mapView.refreshSize();
}

async function applyState() {
  if (!state.city) {
    showView('home');
    applied.city = null;
    await renderHome({ onOpen: (id) => go({ city: id, poi: null, cats: null, keyword: '' }) });
    return;
  }

  showView('city');

  if (applied.city !== state.city) {
    try {
      await mountCity(state.city);
    } catch (err) {
      console.error(err);
      dom.cityName.textContent = '出错了';
      fill(dom.panel, errorBlock(`没能打开「${state.city}」`, err));
      applied.city = state.city;
      return;
    }
    Object.assign(applied, {
      city: state.city, poi: null, cats: catsKey(state.cats),
      keyword: state.keyword, base: ctx.mapView.basemap().id,
    });
  }

  if (applied.base !== state.base) {
    renderBasemapSwitch(ctx.mapView.setBasemap(state.base).id);
    applied.base = state.base;
  }

  if (applied.cats !== catsKey(state.cats) || applied.keyword !== state.keyword) {
    ctx.filters.setCats(state.cats);
    if (dom.poiSearch.value.trim() !== state.keyword) dom.poiSearch.value = state.keyword;
    applied.cats = catsKey(state.cats);
    applied.keyword = state.keyword;
    const visible = applyFilter();
    // 选中的点位被筛掉了就退回概览，不然面板上显示的地方在地图上根本找不到
    if (state.poi && !visible.some((p) => p.id === state.poi)) {
      return go({ poi: null }, 'replace');
    }
  }

  if (applied.poi !== state.poi) {
    applied.poi = state.poi;
    if (!state.poi) {
      ctx.markers.setActive(null);
      applyFilter();
    } else {
      const poi = ctx.city.pois.find((p) => p.id === state.poi);
      if (!poi) {
        // 链接里的点位被删了或者 id 打错了：提示一声，降级成城市全景，不白屏
        toast(`这座城市没有 id 为「${state.poi}」的点位`, 'warn', 4000);
        return go({ poi: null }, 'replace');
      }
      ctx.markers.setActive(poi.id);
      ctx.panel.showPoi(poi, ctx.city);
      focusPoi(poi);
    }
  }
}

// ---------- 全局接线 ----------

window.addEventListener('popstate', () => {
  state = parseUrl(location.search);
  applyState();
});

document.getElementById('back-home').addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go({ city: null, poi: null });
});
// 返回按钮的 href 保持真实可用，中键/右键新开标签页照常
document.getElementById('back-home').href = buildUrl({});

window.addEventListener('unhandledrejection', (e) => {
  console.error('未捕获的异步错误', e.reason);
  toast(`出错了：${e.reason?.message ?? e.reason}`, 'err', 5000);
});

applyState();
