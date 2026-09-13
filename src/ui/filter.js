// 筛选的纯函数部分，和 UI 分开放，方便 node 直接测。
//
// cats 有三种状态，含义各不相同，别混：
//   null      = 不筛选，全都显示（URL 里不写 cat 参数）
//   非空集合  = 只看这几类
//   空集合    = 一类都不看（地图上空空如也）。这是用户把最后一个分类也点掉的结果，
//               是个合法状态，不该偷偷替用户改回"全部"——他点了就是想看看有多空。

/** 点位是否命中关键词。名称、摘要、标签、正文、地址都参与匹配 */
export function poiMatchesKeyword(poi, keyword) {
  if (!keyword) return true;
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const hay = [poi.name, poi.summary, poi.desc, poi.why, poi.address, ...(poi.tags ?? [])]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

export function filterPois(pois, { cats = null, keyword = '' } = {}) {
  return pois.filter((p) =>
    (cats === null || cats.has(p.category)) && poiMatchesKeyword(p, keyword));
}

/**
 * 点某个分类 chip 之后 cats 该变成什么。
 *
 * 从"全部"状态点一个分类，意图几乎总是「只看这一类」，而不是「把这一类关掉」——
 * 后者要点九下才能达到目的。所以第一下是筛选，之后才是多选切换。
 */
export function toggleCat(cats, id, allIds) {
  if (cats === null) return new Set([id]);
  const next = new Set(cats);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  // 全选等价于不筛选，收敛成 null，URL 也短一点
  if (allIds && next.size === allIds.length && allIds.every((x) => next.has(x))) return null;
  return next;
}

/** 城市里实际出现过的分类 + 各自数量，按分类表的 order 排。
    没有点位的分类不显示 chip——成都页面不该出现一个空的「温泉」按钮 */
export function usedCategories(pois, categories) {
  const counts = new Map();
  for (const p of pois) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return categories
    .filter((c) => counts.has(c.id))
    .map((c) => ({ ...c, count: counts.get(c.id) }))
    .concat(
      // 数据里有、但 categories.json 里没有的分类也得能筛，否则那些点位会被藏起来
      [...counts.keys()]
        .filter((id) => !categories.some((c) => c.id === id))
        .map((id) => ({ id, label: id, emoji: '📍', color: '#64748b', order: 999, count: counts.get(id), unknown: true }))
    )
    .sort((a, b) => a.order - b.order);
}
