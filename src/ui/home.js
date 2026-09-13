// 首页：城市卡片列表。数据来自 data/cities/index.json，纯展示，不碰地图。

import { h, fill, esc, debounce, errorBlock } from '../dom.js';
import { loadCityIndex } from '../data/loader.js';

function cityCard(entry, onOpen) {
  return h('a.city-card', {
    href: `?city=${encodeURIComponent(entry.id)}`,
    onclick: (e) => {
      // 左键交给 SPA，Ctrl/Cmd+点击、中键仍然按原生行为开新标签页
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      onOpen(entry.id);
    },
  },
    h('div.cover', { 'aria-hidden': 'true' }, entry.cover ?? '📍'),
    h('div.body', null,
      h('div.title-row', null,
        h('h3', null, entry.name),
        entry.region && h('span.region', null, entry.region)),
      h('p.tagline', null, entry.tagline ?? ''),
      h('div.meta', null,
        h('span', null, `${entry.poiCount ?? '?'} 个点位`),
        entry.updated && h('span', null, `更新于 ${entry.updated}`))));
}

/** 简易搜索：城市名、英文名、省份、一句话都参与匹配 */
function matches(entry, keyword) {
  if (!keyword) return true;
  const hay = [entry.name, entry.nameEn, entry.region, entry.tagline]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(keyword.toLowerCase());
}

export async function renderHome({ onOpen }) {
  const grid = document.getElementById('city-grid');
  const search = document.getElementById('home-search');
  const foot = document.querySelector('.home-foot');
  document.title = '城市旅游攻略图鉴';

  let index;
  try {
    index = await loadCityIndex();
  } catch (err) {
    fill(grid, errorBlock('城市列表没读出来', err));
    console.error(err);
    return;
  }

  const draw = (keyword = '') => {
    const list = index.cities.filter((c) => matches(c, keyword));
    if (!list.length) {
      fill(grid, h('div.empty', null, h('div.big', null, '🔍'), `没有匹配「${esc(keyword)}」的城市`));
      return;
    }
    fill(grid, ...list.map((c) => cityCard(c, onOpen)));
  };

  draw(search.value.trim());
  search.oninput = debounce(() => draw(search.value.trim()), 150);

  const total = index.cities.reduce((sum, c) => sum + (c.poiCount ?? 0), 0);
  fill(foot, h('p', null,
    `${index.cities.length} 座城市 · ${total} 个点位`,
    index.updated ? ` · 数据更新于 ${index.updated}` : ''));
}
