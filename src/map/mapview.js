// Leaflet 实例的生命周期封装。外部拿到的是 MapView，尽量别直接碰里面的 map。
//
// 这一层负责三件容易出事的事：
//   1. 底图切换时把「地图这套经纬度是什么基准」的变化广播出去（marker 要跟着换算）；
//   2. 容器尺寸变化后调 invalidateSize（不调就是灰块、瓦片错位、点击坐标整体偏移）；
//   3. 瓦片源挂掉时自动换一个，而不是让用户对着一片空白猜。

import {
  map as createLeafletMap, tileLayer, latLngBounds, control,
} from '../vendor/leaflet/leaflet-src.esm.js';
import { toDisplay, fromDisplay, toLatLngArray, fromLatLng } from '../geo/crs.js';
import { findBasemap, fallbackFor, DEFAULT_BASEMAP } from './basemaps.js';

/** 连续这么多张瓦片拉不出来就认为这个源挂了 */
const TILE_ERROR_LIMIT = 8;

export function createMap(el, {
  center,
  zoom = 12,
  basemap = DEFAULT_BASEMAP,
  country = 'cn',
  onClick = null,
  onBasemapFallback = null,
} = {}) {
  let base = findBasemap(basemap);
  let fallbackUsed = false;

  const map = createLeafletMap(el, {
    center: toLatLngArray(toDisplay(center, base.datum)),
    zoom,
    zoomControl: false,
    attributionControl: true,
    // 地图是这个页面的主体，滚轮缩放比页面滚动更符合预期
    scrollWheelZoom: true,
    worldCopyJump: true,
  });

  let layer = makeLayer(base);
  layer.addTo(map);

  // 默认的缩放控件在左上角，会和顶栏挤在一起，挪到右下
  control.zoom({ position: 'bottomright', zoomInTitle: '放大', zoomOutTitle: '缩小' }).addTo(map);

  const datumListeners = new Set();
  const clickListeners = new Set();
  if (onClick) clickListeners.add(onClick);

  function makeLayer(spec) {
    const tiles = tileLayer(spec.url, {
      subdomains: spec.subdomains,
      maxZoom: spec.maxZoom,
      attribution: spec.attribution,
      // 放大超过瓦片上限时拉伸低层级瓦片，总比空白强
      maxNativeZoom: spec.maxZoom,
      crossOrigin: true,
    });
    let errors = 0;
    tiles.on('tileerror', () => {
      errors++;
      if (errors < TILE_ERROR_LIMIT || fallbackUsed) return;
      // 只自动回退一次：来回跳的体验比看不到图还糟
      fallbackUsed = true;
      const next = fallbackFor(spec.id, country);
      if (!next) return;
      console.warn(`[map] ${spec.label} 瓦片连续失败 ${errors} 次，回退到 ${next.label}`);
      setBasemap(next.id);
      onBasemapFallback?.(spec, next);
    });
    tiles.on('load', () => { errors = 0; });
    return tiles;
  }

  map.on('click', (e) => {
    // 地图给的是显示坐标（当前底图的基准），一律转回 WGS-84 再往外发，
    // 外面的代码不需要知道现在挂的是哪家瓦片
    const coord = fromDisplay(fromLatLng(e.latlng), base.datum);
    for (const fn of clickListeners) fn(coord, e);
  });

  /**
   * 换底图。三步缺一不可，最常见的半截 bug 是只做了第一步：
   * 换瓦片 → 按新基准重算中心 → 广播基准变化让 marker 逐个换算。
   */
  function setBasemap(id) {
    const next = findBasemap(id);
    if (next.id === base.id) return base;

    // 先用旧基准把当前中心还原成真实坐标，再用新基准算回去
    const trueCenter = fromDisplay(fromLatLng(map.getCenter()), base.datum);
    const prev = base;
    base = next;

    map.removeLayer(layer);
    layer = makeLayer(next);
    layer.addTo(map);
    map.setView(toLatLngArray(toDisplay(trueCenter, next.datum)), map.getZoom(), { animate: false });

    if (prev.datum !== next.datum) {
      for (const fn of datumListeners) fn(next.datum);
    }
    return base;
  }

  /** 定位到某个存储坐标（WGS-84）。padding 用来避开右侧面板/底部抽屉 */
  function focus(coord, { zoom: z = null, padding = null, animate = true } = {}) {
    const ll = toLatLngArray(toDisplay(coord, base.datum));
    if (z !== null && z !== map.getZoom()) {
      map.setView(ll, z, { animate });
    } else if (padding) {
      // panInside 只在必要时移动，比 setView 更少打断用户当前的视野
      map.panInside(ll, { paddingTopLeft: padding.topLeft ?? [0, 0], paddingBottomRight: padding.bottomRight ?? [0, 0], animate });
    } else {
      map.panTo(ll, { animate });
    }
  }

  /** 把一组点位装进视野 */
  function fitToPois(pois, { padding = [40, 40], maxZoom = 16 } = {}) {
    const coords = pois.map((p) => p.coord).filter(Boolean);
    if (!coords.length) return;
    if (coords.length === 1) {
      map.setView(toLatLngArray(toDisplay(coords[0], base.datum)), Math.min(maxZoom, 15), { animate: false });
      return;
    }
    const bounds = latLngBounds(coords.map((c) => toLatLngArray(toDisplay(c, base.datum))));
    map.fitBounds(bounds, { padding, maxZoom, animate: false });
  }

  // 容器尺寸变化：抽屉换档、面板开合、移动端地址栏收缩都会触发。
  // rAF 去抖，避免拖动抽屉时每帧都算一遍。
  let pending = 0;
  function refreshSize() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }
  const ro = new ResizeObserver(refreshSize);
  ro.observe(el);
  window.addEventListener('orientationchange', refreshSize);

  return {
    map,
    datum: () => base.datum,
    basemap: () => base,
    /** 换城市时要跟着换：决定瓦片挂了往哪个源回退 */
    setCountry(next) { country = next; },
    setBasemap,
    focus,
    fitToPois,
    refreshSize,
    getCenter: () => fromDisplay(fromLatLng(map.getCenter()), base.datum),
    getZoom: () => map.getZoom(),
    /** 订阅坐标基准变化（marker 层靠它跟着换算），返回退订函数 */
    onDatumChange(fn) {
      datumListeners.add(fn);
      return () => datumListeners.delete(fn);
    },
    onClick(fn) {
      clickListeners.add(fn);
      return () => clickListeners.delete(fn);
    },
    destroy() {
      ro.disconnect();
      window.removeEventListener('orientationchange', refreshSize);
      map.remove();
    },
  };
}
