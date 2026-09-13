// 分类筛选条：一排彩色 chip，点一下筛选。渲染逻辑在这里，判定逻辑在 filter.js。

import { h, fill, esc } from '../dom.js';
import { usedCategories, toggleCat } from './filter.js';

export function createFilters(el, { categories = [], onChange = null } = {}) {
  let cats = null; // null = 全部
  let used = [];

  function draw() {
    const allIds = used.map((c) => c.id);
    const isAll = cats === null;

    fill(el,
      h('button.chip.all', {
        type: 'button',
        'aria-pressed': String(isAll),
        onclick: () => { cats = null; draw(); onChange?.(cats); },
      }, '全部'),
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
