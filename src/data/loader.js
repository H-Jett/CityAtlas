// 数据加载：带缓存的 JSON 拉取 + 归一化 + 校验告警。
//
// 路径用 import.meta.url 解析而不是写 './data/…'：站点部署在 GitHub Pages 的
// 子路径（/CityAtlas/）下，页面 URL 还带 query，相对路径很容易解析到意外的地方。
// 以模块自身位置为基准最稳，本地 http.server 和 Pages 上行为一致。

import { normalizeCategories, normalizeCity, validateCity, formatProblems, errorsOf } from './schema.js';

const DATA_BASE = new URL('../../data/', import.meta.url);

const cache = new Map();

/** 同一份 JSON 只取一次；失败不进缓存，下次还能重试 */
export async function loadJSON(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const url = new URL(relPath, DATA_BASE);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`读取 ${relPath} 失败：HTTP ${res.status}`);
  const json = await res.json();
  cache.set(relPath, json);
  return json;
}

export async function loadCategories() {
  return normalizeCategories(await loadJSON('categories.json'));
}

/** 首页数据源。返回 { updated, cities: [...] } */
export async function loadCityIndex() {
  const raw = await loadJSON('cities/index.json');
  const cities = (raw?.cities ?? []).filter((c) => c && c.id);
  return { updated: raw?.updated ?? '', cities };
}

/**
 * 读一座城市的全量点位。
 * 校验问题里的 error 会抛出（宁可白屏也别画错的地图），warn 只在控制台提醒。
 */
export async function loadCity(cityId, categories) {
  const index = await loadCityIndex();
  const entry = index.cities.find((c) => c.id === cityId);
  if (!entry) throw new Error(`城市 "${cityId}" 不在索引里`);

  const city = normalizeCity(await loadJSON(`cities/${entry.file ?? cityId + '.json'}`));
  const problems = validateCity(city, categories ?? []);
  const fatal = errorsOf(problems);
  if (fatal.length) {
    throw new Error(`${entry.name} 的数据有 ${fatal.length} 处错误：\n${formatProblems(fatal)}`);
  }
  if (problems.length) console.warn(`[${cityId}] 数据告警：\n${formatProblems(problems)}`);

  // 索引里的 poiCount 是冗余字段（首页不想为了显示个数字就把整城数据拉下来），
  // 冗余就会漂移，这里顺手对一次账
  if (Number.isFinite(entry.poiCount) && entry.poiCount !== city.pois.length) {
    console.warn(`[${cityId}] index.json 写的 poiCount=${entry.poiCount}，实际 ${city.pois.length} 条`);
  }
  return { city, entry };
}

/** 编辑模式导出后重新载入时用，丢掉缓存 */
export function invalidate(relPath) {
  if (relPath) cache.delete(relPath);
  else cache.clear();
}
