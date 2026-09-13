// 分类筛选条：一排彩色 chip，点一下筛选。渲染逻辑在这里，判定逻辑在 filter.js。

import { h, fill, esc } from '../dom.js';
import { usedCategories, toggleCat } from './filter.js';

export function createFilters(el, { categories = [], onChange = null } = {}) {
  let cats = null; // null = 全部
  let used = [];

  function draw() {
    const allIds = used.map((c) => c.id);
    const isAll = cats === null;
    const isNone = cats !== null && cats.size === 0;

    fill(el,
      h('button.chip.all', {
        type: 'button',
        'aria-pressed': String(isAll),
        title: '显示所有分类',
        onclick: () => { cats = null; draw(); onChange?.(cats); },
      }, '全部显示'),
      // 一个都不看也是合法状态：地图清空之后再一类一类点回来，比从全选状态
      // 逐个关掉快得多——分类多了以后尤其明显
      h('button.chip.none', {
        type: 'button',
        'aria-pressed': String(isNone),
        title: '取消所有分类，再按需要一类一类点回来',
        onclick: () => { cats = new Set(); draw(); onChange?.(cats); },
      }, '全部取消'),
      ...used.map((c) => {
        const on = isAll || cats.has(c.id);
        return h('button.chip', {
          type: 'button',
          'aria-pressed': String(on),
          style: `--pin:${esc(c.color)}`,
          title: c.unknown ? `${c.id}（不在 categories.json 里）` : c.label,
          onclick: () => { cats = toggleCat(cats, c.id, allIds); draw(); onChange?.(cats); },
        },
          h('span.emoji', null, c.emoji),
          c.label,
          h('span.n', null, c.count));
      }));
  }

  return {
    /** 换城市时重建 chips，并把筛选重置 */
    setCity(pois, initialCats = null) {
      used = usedCategories(pois, categories);
      cats = initialCats;
      draw();
      return cats;
    },
    cats: () => cats,
    setCats(next) { cats = next; draw(); },
  };
}
