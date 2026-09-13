// URL ⇄ 状态的双向转换。纯函数，好测。
//
// 走 query string 而不是路径路由，是因为站点部署在 GitHub Pages 的子路径下且没有
// 服务端 rewrite：/CityAtlas/chengdu 这种路径刷新就是 404，得靠 404.html 兜底那套
// 把戏。query 不改路径，刷新、分享、右键新开标签页都是原生行为。
//
// 参数：
//   city  城市 id            poi   选中的点位 id
//   cat   分类筛选           q     搜索关键词
//   base  底图 id            edit  编辑模式
//
// cat 有三态，缺省和空串含义不同，别用 `params.get('cat') || ''` 之类的写法抹平：
//   没有 cat 参数 → null（全部）
//   cat=（空串）  → 空集（一个不看）
//   cat=food,cafe → 只看这两类

import { DEFAULT_BASEMAP } from './map/basemaps.js';

/** 解析 location.search。传进来的可以带不带 ? 都行 */
export function parseUrl(search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawCat = params.get('cat');

  return {
    city: params.get('city') || null,
    poi: params.get('poi') || null,
    cats: rawCat === null ? null : new Set(rawCat.split(',').filter(Boolean)),
    keyword: params.get('q') ?? '',
    base: params.get('base') || DEFAULT_BASEMAP,
    edit: params.get('edit') === '1',
  };
}

/** 状态 → query string（不含 ?）。默认值不写进去，链接短一点 */
export function buildQuery(state = {}) {
  const parts = [];
  const push = (key, value) => parts.push(`${key}=${encodeURIComponent(value)}`);

  if (state.city) push('city', state.city);
  if (state.poi) push('poi', state.poi);
  if (state.cats instanceof Set) {
    // 排序后再拼，保证同一组筛选产生同一个链接（否则分享出去的 URL 每次都不一样）
    parts.push(`cat=${[...state.cats].sort().map(encodeURIComponent).join(',')}`);
  }
  if (state.keyword) push('q', state.keyword);
  if (state.base && state.base !== DEFAULT_BASEMAP) push('base', state.base);
  if (state.edit) push('edit', '1');

  return parts.join('&');
}

/** 完整 URL，用于分享按钮 */
export function buildUrl(state, pathname = location.pathname) {
  const query = buildQuery(state);
  return query ? `${pathname}?${query}` : pathname;
}

/** 两个状态是否等价（决定 pushState 还是什么都不做） */
export function sameState(a, b) {
  return buildQuery(a) === buildQuery(b);
}

/**
 * pushState 还是 replaceState：
 *   选点位、换城市、改筛选 → push，用户按返回键能回到上一个选择；
 *   平移缩放、切底图、开编辑器 → replace，不该往历史里塞一堆噪音。
 */
export function syncUrl(state, mode = 'replace') {
  const url = buildUrl(state);
  if (mode === 'push' && url === location.pathname + location.search) return;
  history[mode === 'push' ? 'pushState' : 'replaceState']({}, '', url);
}
