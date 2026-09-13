// 点位编辑表单。字段表驱动，加字段只改 FIELDS。
//
// 坐标那一块是重点：录入时人拿到的坐标五花八门——从高德坐标拾取器复制的是 GCJ-02、
// 百度的是 BD-09、从 GPS 轨迹或 OSM 抄的才是 WGS-84。不给一个"这是哪种坐标"的入口，
// 就一定会有人把 GCJ-02 当 WGS-84 粘进来，然后整条数据偏 500 米还看不出哪错了。
// 表单同时显示存储值和当前底图上的值以及两者距离，对不上就说明有环节漏转了。

import { h, fill, esc, toast } from '../dom.js';
import { toDisplay, fromDisplay, roundCoord, DATUMS } from '../geo/crs.js';
import { haversine, formatDistance } from '../geo/distance.js';

const FIELDS = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '鹤鸣茶社' },
  { key: 'category', label: '分类', type: 'select', required: true },
  { key: 'summary', label: '一句话', type: 'text', placeholder: '人民公园里的百年露天茶馆' },
  { key: 'why', label: '推荐理由', type: 'textarea', placeholder: '为什么值得专门跑一趟' },
  { key: 'desc', label: '详细介绍', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags', placeholder: '露天, 本地人多', hint: '逗号分隔' },
  { key: 'price', label: '人均', type: 'text', placeholder: '¥30' },
  { key: 'hours', label: '营业时间', type: 'text', placeholder: '09:00–18:00' },
  { key: 'duration', label: '建议时长', type: 'text', placeholder: '2h' },
  { key: 'bestTime', label: '什么时候去', type: 'text', placeholder: '下午' },
  { key: 'address', label: '地址', type: 'text' },
];

const DATUM_LABELS = {
  wgs84: 'WGS-84（GPS / OSM）',
  gcj02: 'GCJ-02（高德 / 腾讯）',
  bd09: 'BD-09（百度）',
};

/** 解析用户粘贴的坐标串。支持 "30.66, 104.05"、"104.05,30.66"、空格分隔等 */
export function parsePastedCoord(text, { latFirst = true } = {}) {
  const nums = String(text).match(/-?\d+(\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const a = Number(nums[0]);
  const b = Number(nums[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  // 大多数地图工具复制出来是"纬度,经度"，但也有反过来的。
  // 中国境内纬度不超过 54、经度不小于 72，靠这个能自动认出来，认不出才用 latFirst
  if (Math.abs(a) > 90) return { lng: a, lat: b };
  if (Math.abs(b) > 90) return { lng: b, lat: a };
  if (a > 54 && b < 54) return { lng: a, lat: b };
  return latFirst ? { lng: b, lat: a } : { lng: a, lat: b };
}

function field(spec, poi, categories, onPatch) {
  const value = poi[spec.key] ?? '';
  const common = {
    id: `f-${spec.key}`,
    placeholder: spec.placeholder ?? '',
    oninput: (e) => onPatch({ [spec.key]: e.target.value }),
  };

  let input;
  if (spec.type === 'select') {
    input = h('select', {
      id: common.id,
      onchange: (e) => onPatch({ category: e.target.value }),
    }, ...categories.map((c) =>
      h('option', { value: c.id, selected: c.id === value }, `${c.emoji} ${c.label}`)));
  } else if (spec.type === 'textarea') {
    input = h('textarea', { ...common, rows: 3 });
    input.value = value;
  } else if (spec.type === 'tags') {
    input = h('input', {
      ...common,
      type: 'text',
      oninput: (e) => onPatch({
        tags: e.target.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      }),
    });
    input.value = Array.isArray(value) ? value.join(', ') : value;
  } else {
    input = h('input', { ...common, type: 'text' });
    input.value = value;
  }

  return h('div.field', null,
    h('label', { for: common.id },
      spec.label,
      spec.required && h('span.req', null, '*'),
      spec.hint && h('span.hint', null, spec.hint)),
    input);
}

/** 坐标区：显示两种基准的值、差距，并提供粘贴外部坐标的入口 */
function coordBlock(poi, { datum, onPatch, onPickOnMap }) {
  const shown = toDisplay(poi.coord, datum);
  const shift = haversine(poi.coord, shown);
  let pasteDatum = datum === 'wgs84' ? 'gcj02' : datum;
  let pasteText = '';

  const applyPaste = () => {
    const parsed = parsePastedCoord(pasteText);
    if (!parsed) return toast('看不懂这串坐标，试试「30.6597, 104.0548」这样的格式', 'warn', 4000);
    const wgs = roundCoord(fromDisplay(parsed, pasteDatum));
    onPatch({ coord: wgs });
    toast(`已按 ${DATUM_LABELS[pasteDatum]} 换算并写入`);
  };

  return h('div.coord-block', null,
    h('div.row', null,
      h('span.k', null, '存储坐标'),
      h('code', null, `${poi.coord.lat.toFixed(6)}, ${poi.coord.lng.toFixed(6)}`),
      h('span.badge', null, 'WGS-84')),
    h('div.row', null,
      h('span.k', null, '当前底图'),
      h('code', null, `${shown.lat.toFixed(6)}, ${shown.lng.toFixed(6)}`),
      h('span.badge', null, datum === 'gcj02' ? 'GCJ-02' : datum.toUpperCase())),
    // 两者差多少：切到高德底图应该是几百米，切到 OSM 应该是 0。
    // 如果 OSM 下不是 0，说明某处多转了一次
    h('div.row.shift', null,
      h('span.k', null, '两者相差'),
      h('strong', null, formatDistance(shift)),
      h('span.note', null, datum === 'wgs84' ? '（同基准，应为 0）' : '（正常，火星坐标偏移）')),

    h('div.pick-row', null,
      h('button.btn.small', { type: 'button', onclick: onPickOnMap }, '🎯 在地图上点选'),
      h('span.note', null, '或直接拖动地图上的标记')),

    h('div.paste-row', null,
      h('select', {
        'aria-label': '粘贴坐标的基准',
        onchange: (e) => { pasteDatum = e.target.value; },
      }, ...DATUMS.map((d) =>
        h('option', { value: d, selected: d === pasteDatum }, DATUM_LABELS[d]))),
      h('input', {
        type: 'text',
        placeholder: '粘贴坐标，如 30.6597, 104.0548',
        oninput: (e) => { pasteText = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') applyPaste(); },
      }),
      h('button.btn.small', { type: 'button', onclick: applyPaste }, '换算并填入')));
}

/**
 * 渲染表单。onPatch 收到的是字段增量，由调用方合并进 working 数据。
 */
export function renderForm(container, {
  poi, categories, datum, onPatch, onDelete, onClose, onPickOnMap, isNew = false,
}) {
  fill(container,
    h('div.form-head', null,
      h('strong', null, isNew ? '新增点位' : '编辑点位'),
      h('div.spacer', null),
      h('button.icon-btn', { type: 'button', title: '收起表单', onclick: onClose }, '×')),

    h('div.form-body', null,
      ...FIELDS.map((spec) => field(spec, poi, categories, onPatch)),

      h('div.field', null,
        h('label', { for: 'f-id' }, 'id', h('span.hint', null, '会出现在分享链接里')),
        (() => {
          const input = h('input', {
            id: 'f-id', type: 'text',
            oninput: (e) => onPatch({ id: e.target.value.trim() }),
          });
          input.value = poi.id;
          return input;
        })()),

      coordBlock(poi, { datum, onPatch, onPickOnMap }),

      h('div.form-actions', null,
        h('button.btn.danger', { type: 'button', onclick: onDelete }, '删除这个点位'))));
}
