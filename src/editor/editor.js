// 编辑模式总控：在地图上点选取坐标、拖标记微调、填表单，改完导出 JSON 粘回仓库。
//
// 这是个纯前端编辑器，没有后端也没有"保存"按钮——所有改动落在内存的 working 副本上，
// 自动存进 localStorage 草稿，最终产物是一份可以直接覆盖 data/cities/<id>.json 的文本。
// 因为没有服务端兜底，「别把用户辛苦录的东西弄丢」是这个模块最重要的需求：
//   1. 进来时草稿和线上版对不上就弹窗让用户选，绝不默默覆盖；
//   2. 删除是软删除，划线显示可一键恢复，导出时才真剔除；
//   3. 每次写草稿前把上一版挪到 .prev 槽，配合"回到上一次自动保存"能捞回来；
//   4. localStorage 写失败必须出声，不能静默 catch；
//   5. 撤销栈 + 离开页面前的拦截。

import { h, fill, esc, toast, modal, debounce } from '../dom.js';
import { findCategory } from '../data/schema.js';
import { roundCoord } from '../geo/crs.js';
import { renderForm } from './form.js';
import {
  hashCity, loadDraft, loadPrev, saveDraft, discardDraft, reconcile,
  diffCities, diffCount, describeDiff, softDelete, restoreDeleted,
} from './draft.js';

const UNDO_LIMIT = 50;

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
  el, mapView, markers, categories, onExit, onExport = null,
}) {
  let active = false;
  let published = null; // 线上那份，只读
  let working = null;
  let baseHash = '';
  let selectedId = null;
  let pickingFor = null;
  let lastCategory = 'food';
  let unbindClick = null;
  let undoStack = [];
  let storageBroken = false;

  const poiById = (id) => working?.pois.find((p) => p.id === id) ?? null;
  const livePois = () => working.pois.filter((p) => !p._deleted);
  const currentDiff = () => diffCities(published, working);

  // ---------- 草稿 ----------

  const persist = debounce(() => {
    if (!active) return;
    const res = saveDraft(working.id, { baseHash, city: working });
    if (res.ok) {
      storageBroken = false;
      return;
    }
    // 静默失败的后果是用户以为存住了，其实一个字没存，所以必须出声——
    // 而且只在状态从好变坏时提醒一次，不然每敲一个字弹一条
    if (!storageBroken) {
      storageBroken = true;
      toast('草稿存不进浏览器了（无痕模式或存储已满），改完记得马上导出', 'err', 6000);
      console.error('[editor] 草稿保存失败', res.error);
    }
  }, 500);

  function touch() {
    persist();
    drawBar();
  }

  function pushUndo() {
    undoStack.push(clone(working));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return toast('没有可撤销的改动了');
    working = prev;
    markers.render(livePois());
    if (selectedId && !poiById(selectedId)) selectedId = null;
    draw();
    persist();
    toast('已撤销');
  }

  // ---------- 渲染 ----------

  function poiRow(poi) {
    const cat = findCategory(categories, poi.category);
    const deleted = poi._deleted === true;
    return h('li', { class: [poi.id === selectedId ? 'on' : '', deleted ? 'deleted' : ''].filter(Boolean).join(' ') },
      h('button', {
        type: 'button',
        onclick: () => (deleted ? undelete(poi.id) : select(poi.id)),
        title: deleted ? '点一下恢复' : '',
      },
        h('span.dot', { style: `--pin:${esc(cat.color)}` }, cat.emoji),
        h('span.name', null, poi.name || '（未命名）'),
        deleted ? h('span.id', null, '已删除 · 点此恢复') : h('span.id', null, poi.id)));
  }

  function drawBar() {
    const bar = el.querySelector('.editor-bar');
    if (!bar) return;
    const diff = currentDiff();
    const n = diffCount(diff);
    fill(bar,
      h('strong', null, '✏️ 编辑'),
      h('span.count', { class: n ? 'dirty' : '' }, n ? describeDiff(diff) : `${livePois().length} 个点位`),
      h('div.spacer', null),
      h('button.icon-btn', { type: 'button', title: '撤销（Ctrl+Z）', onclick: undo }, '↶'),
      h('button.btn.small.primary', {
        type: 'button',
        title: '导出 JSON',
        onclick: () => (onExport
          ? onExport(working, published)
          : toast('导出功能还没接上', 'warn')),
      }, '导出'),
      h('button.btn.small', { type: 'button', onclick: () => exit() }, '退出'));
  }

  function draw() {
    const selected = poiById(selectedId);
    fill(el,
      h('div.editor-bar', null),
      h('div.editor-body', null,
        h('div.tip', null, '在地图上点一下新增点位，拖动标记微调位置。改动会自动存在本机浏览器里，最后用「导出」拿到 JSON。'),
        h('button.btn.primary.block', { type: 'button', onclick: () => startNew() }, '＋ 新增点位'),
        selected
          ? h('div.form-wrap', null)
          : h('ul.poi-list', null, ...working.pois.map(poiRow))));
    drawBar();

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
    // 连续打字不该每个字符一个撤销点：只有坐标、分类、id 这类离散改动才压栈
    if (patch.coord || patch.category || patch.id) pushUndo();

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
    touch();
    if (patch.coord) draw(); // 坐标块要跟着更新两种基准的值和差距
  }

  function addPoi(coord) {
    pushUndo();
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
    touch();
    select(poi.id);
    el.querySelector('#f-name')?.focus();
  }

  /** 软删除：打标记、从地图上撤下来，但留在列表里可以点回来 */
  function removePoi(id) {
    const poi = poiById(id);
    if (!poi) return;
    pushUndo();
    softDelete(working, id);
    markers.remove(id);
    selectedId = null;
    touch();
    draw();
    toast(`已删除「${poi.name || poi.id}」，在列表里可以点回来`, '', 4000);
  }

  function undelete(id) {
    pushUndo();
    restoreDeleted(working, id);
    const poi = poiById(id);
    if (poi) markers.add(poi);
    touch();
    select(id);
    toast('已恢复');
  }

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
    const target = pickingFor;
    pickingFor = null;
    el.classList.remove('picking');
    if (target && target !== '__new__') return patchPoi(target, { coord: roundCoord(coord) });
    // 没在取点状态时，地图空白处点一下也直接新增——这是编辑模式最高频的动作
    addPoi(coord);
  }

  function onMarkerDrag(id, coord) {
    patchPoi(id, { coord: roundCoord(coord) });
    if (selectedId !== id) select(id);
  }

  const onKeyDown = (e) => {
    if (!active) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      // 在输入框里打字时让浏览器自己处理撤销
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      undo();
    }
  };

  // ---------- 进入时的草稿对账 ----------

  async function resolveStart(city) {
    const draft = loadDraft(city.id);
    const { status } = reconcile(city, draft);
    if (status === 'none') return clone(city);

    const diff = diffCities(city, draft.city);
    const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString('zh-CN') : '不知道什么时候';

    if (status === 'clean') {
      const pick = await modal({
        title: '发现上次没导出的草稿',
        body: `保存于 ${esc(when)}，相对线上数据：${esc(describeDiff(diff))}。`,
        actions: [
          { id: 'draft', label: '接着改草稿', kind: 'primary' },
          { id: 'fresh', label: '丢弃草稿，用线上版' },
        ],
      });
      if (pick === 'fresh') {
        discardDraft(city.id);
        toast('已丢弃草稿（还留了一份在 .prev 里）', '', 4000);
        return clone(city);
      }
      return clone(draft.city);
    }

    // stale：线上数据在草稿之后变过。直接覆盖等于替用户丢掉别人的改动
    const pick = await modal({
      title: '⚠️ 草稿基于旧版本',
      body: `草稿保存于 ${esc(when)}，但仓库里的数据在那之后变过（别人提交了，或者你在另一台机器上改的）。`
        + `<br><br>草稿相对<strong>当前</strong>线上数据：${esc(describeDiff(diff))}。`
        + `<br><br>继续用草稿导出的话，线上那些改动会被覆盖掉。`,
      actions: [
        { id: 'draft', label: '仍然用草稿', kind: 'danger' },
        { id: 'fresh', label: '丢弃草稿，用线上版', kind: 'primary' },
      ],
      dismissible: false,
    });
    if (pick === 'draft') return clone(draft.city);
    discardDraft(city.id);
    return clone(city);
  }

  // ---------- 生命周期 ----------

  async function enter(city) {
    if (active) return working;
    published = clone(city);
    baseHash = hashCity(city);
    working = await resolveStart(city);
    active = true;
    selectedId = null;
    undoStack = [];

    el.classList.add('editing');
    markers.render(livePois());
    markers.setDraggable(true, onMarkerDrag);
    unbindClick = mapView.onClick(onMapClick);
    document.addEventListener('keydown', onKeyDown);
    draw();

    const n = diffCount(currentDiff());
    if (n) toast(`草稿已载入：${describeDiff(currentDiff())}`, '', 4000);
    return working;
  }

  function exit() {
    if (!active) return;
    persist.flush();
    active = false;
    pickingFor = null;
    el.classList.remove('editing', 'picking');
    markers.setDraggable(false);
    unbindClick?.();
    unbindClick = null;
    document.removeEventListener('keydown', onKeyDown);

    const n = diffCount(currentDiff());
    if (n) toast(`还有${describeDiff(currentDiff())}没导出，草稿已存在本机，随时回来接着改`, 'warn', 5000);
    onExit?.(working);
  }

  // 离开页面时拦一下，仅当真有改动
  window.addEventListener('beforeunload', (e) => {
    if (!active || !diffCount(currentDiff())) return;
    persist.flush();
    e.preventDefault();
    e.returnValue = '';
  });

  return {
    enter,
    exit,
    isActive: () => active,
    working: () => working,
    published: () => published,
    diff: currentDiff,
    select,
    undo,
    redraw: draw,
    /** 给"回到上一次自动保存"用 */
    hasPrevDraft: (cityId) => !!loadPrev(cityId),
  };
}
