// 详情面板：桌面是右侧固定栏，窄屏变成底部抽屉（三档吸附）。
//
// 渲染策略是「有才画」：城市 JSON 里除了 id/name/category/coord 之外全是可选字段，
// 缺了就整块不出现，而不是留一行"暂无"。这样各城市的数据可以丰俭由人，先把点位
// 钉上地图，细节以后慢慢补。

import { h, fill, esc, toast } from '../dom.js';
import { findCategory } from '../data/schema.js';
import { haversine, formatDistance } from '../geo/distance.js';

/** 窄屏抽屉的三档高度（占视口比例） */
const SNAPS = { peek: 0.24, half: 0.55, full: 0.92 };
const SNAP_ORDER = ['peek', 'half', 'full'];

const META_FIELDS = [
  ['price', '人均'],
  ['hours', '营业时间'],
  ['duration', '建议时长'],
  ['bestTime', '什么时候去'],
  ['address', '地址'],
];

function metaRow(poi) {
  const rows = META_FIELDS
    .filter(([key]) => poi[key])
    .map(([key, label]) => h('div.meta-item', null,
      h('dt', null, label), h('dd', null, poi[key])));
  return rows.length ? h('dl.meta-grid', null, ...rows) : null;
}

function linkList(poi) {
  if (!poi.links?.length) return null;
  return h('div.links', null, ...poi.links
    .filter((l) => l?.url)
    .map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label ?? l.url)));
}

export function createPanel(el, { categories = [], onSelect = null, onSnapChange = null } = {}) {
  let snap = 'peek';
  let currentCity = null;

  function isNarrow() {
    return !window.matchMedia('(min-width: 900px)').matches;
  }

  function setSnap(next, { silent = false } = {}) {
    if (!SNAPS[next]) return;
    snap = next;
    el.dataset.snap = next;
    el.style.setProperty('--sheet-h', `${Math.round(SNAPS[next] * 100)}dvh`);
    if (!silent) onSnapChange?.(next);
  }

  /** 抽屉把手：拖动改高度，松手吸附到最近一档；点一下则在档位间轮换 */
  function sheetHandle() {
    let startY = 0;
    let startH = 0;
    let moved = false;

    const onMove = (e) => {
      const dy = startY - e.clientY;
      const height = Math.min(window.innerHeight * 0.95, Math.max(80, startH + dy));
      moved = moved || Math.abs(dy) > 4;
      el.style.setProperty('--sheet-h', `${height}px`);
    };
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      if (!moved) {
        // 当成点击：往上翻一档，到顶了回到 peek
        const i = SNAP_ORDER.indexOf(snap);
        setSnap(SNAP_ORDER[(i + 1) % SNAP_ORDER.length]);
        return;
      }
      const ratio = el.getBoundingClientRect().height / window.innerHeight;
      const nearest = SNAP_ORDER.reduce((best, name) =>
        Math.abs(SNAPS[name] - ratio) < Math.abs(SNAPS[best] - ratio) ? name : best, 'peek');
      setSnap(nearest);
      e.target.releasePointerCapture?.(e.pointerId);
    };

    return h('button.sheet-handle', {
      type: 'button',
      'aria-label': '拖动或点击调整面板高度',
      onpointerdown: (e) => {
        if (!isNarrow()) return;
        startY = e.clientY;
        startH = el.getBoundingClientRect().height;
        moved = false;
        el.classList.add('dragging');
        e.target.setPointerCapture?.(e.pointerId);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      },
    }, h('span.grip', null));
  }

  /** 没选中任何点位时：显示这座城市的概览 */
  function showOverview(city, { visibleCount = null } = {}) {
    currentCity = city;
    const counts = new Map();
    for (const p of city.pois) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const stats = [...counts.entries()]
      .map(([id, n]) => ({ cat: findCategory(categories, id), n }))
      .sort((a, b) => a.cat.order - b.cat.order);

    fill(el,
      sheetHandle(),
      h('div.panel-body', null,
        h('div.overview', null,
          h('h3', null, `${city.name}`),
          h('p.hint', null,
            visibleCount !== null && visibleCount !== city.pois.length
              ? `筛选出 ${visibleCount} / ${city.pois.length} 个点位`
              : `共 ${city.pois.length} 个点位`,
            '，点地图上的标记看详情。'),
          h('ul.cat-stats', null, ...stats.map(({ cat, n }) =>
            h('li', null,
              h('span.dot', { style: `--pin:${esc(cat.color)}` }, cat.emoji),
              h('span.label', null, cat.label),
              h('span.n', null, n)))),
          // 数据来源这类元信息放最后：窄屏抽屉收起时只露出顶部一小条，
          // 那点地方应该留给分类统计，而不是一段免责说明
          city.notes && h('p.notes', null, city.notes))));
    if (isNarrow()) setSnap('peek', { silent: true });
  }

  /** 选中某个点位 */
  function showPoi(poi, city = currentCity) {
    currentCity = city ?? currentCity;
    const cat = findCategory(categories, poi.category);
    const nearby = (poi.nearby ?? [])
      .map((id) => currentCity?.pois.find((p) => p.id === id))
      .filter(Boolean);

    // 没显式写 nearby 就按距离找最近的三个，省得每条数据都手写关联
    const auto = nearby.length ? nearby : (currentCity?.pois ?? [])
      .filter((p) => p.id !== poi.id && p.coord)
      .map((p) => ({ p, d: haversine(poi.coord, p.coord) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map(({ p }) => p);

    fill(el,
      sheetHandle(),
      h('div.panel-body', null,
        h('div.poi-head', null,
          h('span.cat-chip', { style: `--pin:${esc(cat.color)}` }, `${cat.emoji} ${cat.label}`),
          h('h3', null, poi.name),
          poi.summary && h('p.summary', null, poi.summary)),

        poi.why && h('blockquote.why', null, poi.why),
        poi.desc && h('p.desc', null, poi.desc),

        poi.tags?.length && h('div.tags', null,
          ...poi.tags.map((t) => h('span.tag', null, t))),

        metaRow(poi),
        linkList(poi),

        auto.length && h('div.nearby', null,
          h('h4', null, nearby.length ? '顺路还有' : '走几步就到'),
          h('ul', null, ...auto.map((p) => {
            const c = findCategory(categories, p.category);
            const d = poi.coord && p.coord ? haversine(poi.coord, p.coord) : null;
            return h('li', null, h('button', {
              type: 'button',
              onclick: () => onSelect?.(p.id),
            },
              h('span.dot', { style: `--pin:${esc(c.color)}` }, c.emoji),
              h('span.name', null, p.name),
              d !== null && h('span.dist', null, formatDistance(d))));
          }))),

        h('div.coord-line', null,
          h('button.link-like', {
            type: 'button',
            title: '复制 WGS-84 坐标',
            onclick: async () => {
              const text = `${poi.coord.lat}, ${poi.coord.lng}`;
              try {
                await navigator.clipboard.writeText(text);
                toast('坐标已复制');
              } catch {
                toast(`复制失败，手抄一下：${text}`, 'warn', 4000);
              }
            },
          }, `📍 ${poi.coord.lat.toFixed(6)}, ${poi.coord.lng.toFixed(6)}`),
          h('span.datum-note', null, 'WGS-84'))));

    // 窄屏上选中点位时把抽屉抬到中间档，既看得到内容又留着地图
    if (isNarrow() && snap === 'peek') setSnap('half');
  }

  setSnap('peek', { silent: true });

  return {
    showPoi,
    showOverview,
    setSnap,
    snap: () => snap,
    /**
     * 窄屏下抽屉占掉的高度，地图定位时要避开。
     * 按档位比例算而不是量 DOM：选中点位时抽屉常常正在做 0.2s 的高度动画，
     * 这时候量到的是旧高度，算出来的 padding 不够，标记会被抽屉盖住。
     */
    sheetHeight: () => (isNarrow() ? Math.round(window.innerHeight * SNAPS[snap]) : 0),
  };
}
