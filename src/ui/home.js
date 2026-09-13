// 首页：按国家分组的城市卡片列表。数据来自 data/cities/index.json + countries.json，
// 纯展示，不碰地图。
//
// 国家既是筛选器也是分组依据：只有一个国家时不显示筛选条（一个"全部"加一个"中国"
// 的筛选器等于没有），加到两个国家才冒出来。

import { h, fill, esc, debounce, errorBlock } from '../dom.js';
import { loadCityIndex, loadCountries } from '../data/loader.js';
import { findCountry } from '../data/schema.js';

function cityCard(entry, country, onOpen) {
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
        entry.updated && h('span', null, `更新于 ${entry.updated}`))),
    h('span.flag', { title: country.name, 'aria-label': country.name }, country.flag));
}

/** 城市名、英文名、省份、一句话、国家名都参与搜索 */
function matches(entry, country, keyword) {
  if (!keyword) return true;
  const hay = [entry.name, entry.nameEn, entry.region, entry.tagline, country.name]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(keyword.toLowerCase());
}

export async function renderHome({ onOpen, country = null, onCountryChange = null }) {
  const grid = document.getElementById('city-grid');
  const search = document.getElementById('home-search');
  const bar = document.getElementById('country-bar');
  const foot = document.querySelector('.home-foot');
  document.title = '城市旅游攻略图鉴';

  let index;
  let countries;
  try {
    [index, countries] = await Promise.all([loadCityIndex(), loadCountries()]);
  } catch (err) {
    fill(grid, errorBlock('城市列表没读出来', err));
    console.error(err);
    return;
  }

  // 只列出真有城市的国家，并按国家表的 order 排
  const counts = new Map();
  for (const c of index.cities) counts.set(c.country, (counts.get(c.country) ?? 0) + 1);
  const used = countries
    .filter((c) => counts.has(c.id))
    .map((c) => ({ ...c, count: counts.get(c.id) }))
    .concat([...counts.keys()]
      .filter((id) => !countries.some((c) => c.id === id))
      .map((id) => ({ ...findCountry(countries, id), count: counts.get(id) })))
    .sort((a, b) => a.order - b.order);

  function drawBar(active) {
    // 只有一个国家时，筛选条没有意义
    if (used.length < 2) return fill(bar);
    fill(bar,
      h('button.chip.all', {
        type: 'button',
        'aria-pressed': String(!active),
        onclick: () => onCountryChange?.(null),
      }, '全部'),
      ...used.map((c) => h('button.chip', {
        type: 'button',
        'aria-pressed': String(active === c.id),
        onclick: () => onCountryChange?.(active === c.id ? null : c.id),
      },
        h('span.emoji', null, c.flag),
        c.name,
        h('span.n', null, c.count))));
  }

  function draw(keyword = '') {
    const visible = index.cities.filter((c) =>
      (!country || c.country === country) && matches(c, findCountry(countries, c.country), keyword));

    if (!visible.length) {
      fill(grid, h('div.empty', null, h('div.big', null, '🔍'),
        keyword ? `没有匹配「${esc(keyword)}」的城市` : '这个国家还没有城市'));
      return;
    }

    // 按国家分组显示，组内保持索引里的顺序
    const groups = used
      .map((c) => ({ country: c, cities: visible.filter((x) => x.country === c.id) }))
      .filter((g) => g.cities.length);

    fill(grid, ...groups.map((g) =>
      h('section.country-group', null,
        // 只剩一组时不必再重复国家名，卡片右上角的国旗已经说明了
        groups.length > 1 && h('h2.group-head', null,
          h('span.flag', null, g.country.flag), g.country.name,
          h('span.n', null, `${g.cities.length} 座城市`)),
        h('div.group-grid', null,
          ...g.cities.map((c) => cityCard(c, findCountry(countries, c.country), onOpen))))));
  }

  drawBar(country);
  draw(search.value.trim());
  search.oninput = debounce(() => draw(search.value.trim()), 150);

  const shown = country ? index.cities.filter((c) => c.country === country) : index.cities;
  const total = shown.reduce((sum, c) => sum + (c.poiCount ?? 0), 0);
  fill(foot, h('p', null,
    `${shown.length} 座城市 · ${total} 个点位`,
    index.updated ? ` · 数据更新于 ${index.updated}` : ''));
}
