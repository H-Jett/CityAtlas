// 编辑模式总控：在地图上点选取坐标、拖标记微调、填表单，改完导出 JSON 粘回仓库。
//
// 这是个纯前端编辑器，没有后端也没有保存按钮——所有改动先落在内存的 working 副本上，
// 最终产物是一份可以直接覆盖 data/cities/<id>.json 的文本。因为没有服务端兜底，
// 「别把用户辛苦录的东西弄丢」是这个模块最重要的需求，具体防线见 draft.js。

import { h, fill, esc, toast } from '../dom.js';
import { findCategory } from '../data/schema.js';
import { roundCoord } from '../geo/crs.js';
import { renderForm } from './form.js';

/** 深拷贝城市数据。用 structuredClone，坐标都是普通对象没有原型问题 */
function clone(city) {
  return structuredClone(city);
}

/** 生成一个不撞车的点位 id：<城市前缀>-<分类>-<三位序号> */
export function makePoiId(city, category) {
  const prefix = (city.id || 'city').slice(0, 2);
  const used = new Set(city.pois.map((p) => p.id));
  for (let n = 1; n < 1000; n++) {
    const id = `${prefix}-${category}-${String(n).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}-${category}-${Date.now()}`;
}

export function createEditor({
  el, mapView, markers, categories, onExit, onChange = null,
}) {
  let active = false;
  let working = null;
  let selectedId = null;
  let pickingFor = null; // 正在等地图点击给哪个点位取坐标
  let lastCategory = 'food';
  let unbindClick = null;

  const poiById = (id) => working?.pois.find((p) => p.id === id) ?? null;

  function notify() {
    onChange?.(working);
  }

  // ---------- 渲染 ----------

  function poiRow(poi) {
    const cat = findCategory(categories, poi.category);
    return h('li', { class: poi.id === selectedId ? 'on' : '' },
      h('button', { type: 'button', onclick: () => select(poi.id) },
        h('span.dot', { style: `--pin:${esc(cat.color)}` }, cat.emoji),
        h('span.name', null, poi.name || '（未命名）'),
        h('span.id', null, poi.id)));
  }

  function draw() {
    const selected = poiById(selectedId);
    fill(el,
      h('div.editor-bar', null,
        h('strong', null, '✏️ 编辑模式'),
        h('span.count', null, `${working.pois.length} 个点位`),
        h('div.spacer', null),
        h('button.btn.small', { type: 'button', onclick: exit }, '退出')),

      h('div.editor-body', null,
        h('div.tip', null, '在地图上点一下新增点位，拖动标记可以微调位置。'),
        h('button.btn.primary.block', { type: 'button', onclick: () => startNew() }, '＋ 新增点位'),

        selected
          ? h('div.form-wrap', null)
          : h('ul.poi-list', null, ...working.pois.map(poiRow))));

    if (selected) {
      renderForm(el.querySelector('.form-wrap'), {
        poi: selected,
        categories,
        datum: mapView.datum(),
        isNew: selected._new === true,
        onPatch: (patch) => patchPoi(selected.id, patch),
        onDelete: () => removePoi(selected.id),
        onClose: () => select(null),
        onPickOnMap: () => startPicking(selected.id),
      });
    }
  }

  // ---------- 操作 ----------

  function select(id) {
    selectedId = id;
    markers.setActive(id);
    draw();
    const poi = poiById(id);
    if (poi) mapView.focus(poi.coord, {});
  }

  function patchPoi(id, patch) {
    const poi = poiById(id);
    if (!poi) return;
    const oldId = poi.id;
    Object.assign(poi, patch);

    if (patch.id && patch.id !== oldId) {
      if (working.pois.filter((p) => p.id === patch.id).length > 1) {
        toast(`id「${patch.id}」和别的点位重了`, 'warn');
      }
      markers.remove(oldId);
      markers.add(poi);
      selectedId = poi.id;
    } else {
      markers.update(poi);
    }
    if (patch.category) lastCategory = patch.category;
    notify();
    // 坐标变了要重画表单里的坐标块（两种基准的值和差距都得跟着更新）
    if (patch.coord) draw();
  }

  function addPoi(coord) {
    const poi = {
      id: makePoiId(working, lastCategory),
      name: '',
      category: lastCategory,
      coord: roundCoord(coord),
      summary: '',
      tags: [],
      links: [],
      _new: true,
    };
    working.pois.push(poi);
    markers.add(poi);
    notify();
    select(poi.id);
    // 新增后焦点直接落到名称输入框，接着就能打字
    el.querySelector('#f-name')?.focus();
  }

  function removePoi(id) {
    const i = working.pois.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [removed] = working.pois.splice(i, 1);
    markers.remove(id);
    selectedId = null;
    notify();
    draw();
    toast(`已删除「${removed.name || removed.id}」`);
  }

  /** 进入取点状态：下一次地图点击给这个点位当坐标 */
  function startPicking(id) {
    pickingFor = id;
    el.classList.add('picking');
    toast('在地图上点一下，把标记放到那里');
  }

  function startNew() {
    pickingFor = '__new__';
    el.classList.add('picking');
    toast('在地图上点一下，新点位就放在那儿');
  }

  function onMapClick(coord) {
    if (!active) return;
    if (pickingFor === '__new__') {
      pickingFor = null;
      el.classList.remove('picking');
      addPoi(coord);
      return;
    }
    if (pickingFor) {
      const id = pickingFor;
      pickingFor = null;
      el.classList.remove('picking');
      patchPoi(id, { coord: roundCoord(coord) });
      return;
    }
    // 没在取点状态时，地图空白处点一下也直接新增——这是编辑模式最高频的动作
    addPoi(coord);
  }

  function onMarkerDrag(id, coord) {
    patchPoi(id, { coord: roundCoord(coord) });
    if (selectedId !== id) select(id);
  }

  // ---------- 生命周期 ----------

  function enter(city) {
    if (active) return working;
    active = true;
    working = clone(city);
    selectedId = null;
    el.classList.add('editing');

    markers.render(working.pois);
    markers.setDraggable(true, onMarkerDrag);
    unbindClick = mapView.onClick(onMapClick);
    draw();
    return working;
  }

  function exit() {
    if (!active) return;
    active = false;
    pickingFor = null;
    el.classList.remove('editing', 'picking');
    markers.setDraggable(false);
    unbindClick?.();
    unbindClick = null;
    onExit?.(working);
  }

  return {
    enter,
    exit,
    isActive: () => active,
    working: () => working,
    select,
    redraw: draw,
  };
}
