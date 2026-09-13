// 地图标记层：按分类着色的水滴标记，选中态放大。
//
// 标记用 divIcon 画（一段 HTML + CSS 变量注入颜色），不用图片：分类颜色定义在
// categories.json 里，加一个分类不该还要配一套 PNG。副作用是标记能用 CSS 做过渡
// 动画，选中时放大很顺。
//
// 这一层还负责订阅 mapView 的基准变化。底图从高德切到 OSM 时，如果只换了瓦片没有
// 逐个 setLatLng，所有标记会整体偏 500 米——而且因为底图同时也变了，肉眼不容易
// 一眼看出来，是最阴险的一类 bug。

import { marker, divIcon, layerGroup } from '../vendor/leaflet/leaflet-src.esm.js';
import { toDisplay, fromDisplay, toLatLngArray, fromLatLng } from '../geo/crs.js';
import { findCategory } from '../data/schema.js';
import { esc } from '../dom.js';

/** 造一个分类色的水滴标记。active 时放大并压到最上层 */
export function makeIcon(cat, { active = false } = {}) {
  return divIcon({
    className: `pin-wrap${active ? ' active' : ''}`,
    html: `<span class="pin" style="--pin:${esc(cat.color)}" title="${esc(cat.label)}"><b>${esc(cat.emoji)}</b></span>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38], // 尖端落在坐标点上
    tooltipAnchor: [0, -34],
  });
}

export function createMarkerLayer(mapView, { categories = [], onSelect = null } = {}) {
  const group = layerGroup().addTo(mapView.map);
  const entries = new Map(); // poiId → { poi, marker, cat }
  let activeId = null;
  let draggable = false;
  let onDragEnd = null;

  // 底图基准一变，所有标记跟着换算。忘了这一步就是整体偏移 500 米
  const unsubscribe = mapView.onDatumChange(() => relocateAll());

  function place(poi) {
    return toLatLngArray(toDisplay(poi.coord, mapView.datum()));
  }

  function add(poi) {
    const cat = findCategory(categories, poi.category);
    const m = marker(place(poi), {
      icon: makeIcon(cat),
      draggable,
      keyboard: true,
      title: poi.name,
      riseOnHover: true,
      alt: `${cat.label}：${poi.name}`,
    });
    m.on('click', () => onSelect?.(poi.id));
    m.on('keypress', (e) => { if (e.originalEvent?.key === 'Enter') onSelect?.(poi.id); });
    m.on('dragend', () => {
      // 拖拽拿到的是显示坐标，转回 WGS-84 再交出去
      const coord = fromDisplay(fromLatLng(m.getLatLng()), mapView.datum());
      onDragEnd?.(poi.id, coord);
    });
    m.addTo(group);
    entries.set(poi.id, { poi, marker: m, cat });
  }

  /** 全量重绘。点位数量是几十级别，不做 diff */
  function render(pois) {
    group.clearLayers();
    entries.clear();
    for (const poi of pois) if (poi.coord) add(poi);
    if (activeId && entries.has(activeId)) setActive(activeId);
  }

  /** 筛选：用显示/隐藏而不是销毁重建，保留拖拽状态和动画 */
  function setVisible(idSet) {
    for (const [id, { marker: m }] of entries) {
      const show = !idSet || idSet.has(id);
      const el = m.getElement();
      if (el) el.classList.toggle('hidden', !show);
      // 隐藏的标记不该还能点到
      if (el) el.style.pointerEvents = show ? '' : 'none';
    }
  }

  function setActive(id) {
    if (activeId && entries.has(activeId)) {
      const { marker: m, cat } = entries.get(activeId);
      m.setIcon(makeIcon(cat));
    }
    activeId = id;
    if (id && entries.has(id)) {
      const { marker: m, cat } = entries.get(id);
      m.setIcon(makeIcon(cat, { active: true }));
      m.setZIndexOffset(1000);
    }
  }

  /** 基准变了：逐个换算位置 */
  function relocateAll() {
    for (const { poi, marker: m } of entries.values()) m.setLatLng(place(poi));
  }

  /** 单个点位的数据变了（编辑模式改坐标/改分类/改名） */
  function update(poi) {
    const entry = entries.get(poi.id);
    if (!entry) return add(poi);
    entry.poi = poi;
    entry.cat = findCategory(categories, poi.category);
    entry.marker.setLatLng(place(poi));
    entry.marker.setIcon(makeIcon(entry.cat, { active: poi.id === activeId }));
    entry.marker.options.title = poi.name;
  }

  function remove(poiId) {
    const entry = entries.get(poiId);
    if (!entry) return;
    group.removeLayer(entry.marker);
    entries.delete(poiId);
    if (activeId === poiId) activeId = null;
  }

  /** 编辑模式开关：允许拖动标记微调坐标 */
  function setDraggable(on, handler = null) {
    draggable = on;
    onDragEnd = handler;
    for (const { marker: m } of entries.values()) {
      if (on) m.dragging?.enable();
      else m.dragging?.disable();
      m.getElement()?.classList.toggle('draggable', on);
    }
  }

  return {
    render, setVisible, setActive, relocateAll, update, add, remove, setDraggable,
    getMarker: (id) => entries.get(id)?.marker,
    activeId: () => activeId,
    destroy() {
      unsubscribe();
      group.remove();
      entries.clear();
    },
  };
}
