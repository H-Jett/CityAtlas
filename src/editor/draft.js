// 草稿：把编辑中的城市数据存进 localStorage，以及和线上版本对账。
//
// 这是个没有后端的编辑器，用户录二十个点位要花一两个小时，而这些工作全靠浏览器里
// 一份 localStorage 撑着。所以这个文件的每个函数都是围绕「别弄丢」写的：
//   · 写新草稿前先把上一版挪到 .prev 槽，手滑还能捞回来；
//   · 存储写失败要能被上层发现并出声（隐私模式、配额满都会静默失败）；
//   · 记下草稿基于哪个版本的线上数据（baseHash），线上变过就警告而不是默默覆盖；
//   · 删除是打标记不是真删，导出前都能撤销。
//
// storage 可注入，方便 node 里测。

import { stableString, fnv1a } from './serialize.js';

const VERSION = 'v1';
const key = (cityId) => `ca:draft:${VERSION}:${cityId}`;
const prevKey = (cityId) => `${key(cityId)}.prev`;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 有些环境下访问 localStorage 本身就会抛（禁用了 cookie 的 iframe）
  }
}

/** 城市内容指纹。只看内容不看 key 顺序，编辑器里调整过字段顺序不算改动 */
export function hashCity(city) {
  return fnv1a(stableString(compact(city)));
}

/** 去掉软删除项和所有下划线开头的内部字段，导出和算哈希都用它 */
export function compact(city) {
  const clean = (obj) => Object.fromEntries(
    Object.entries(obj).filter(([k, v]) =>
      !k.startsWith('_') && v !== undefined && v !== '' &&
      !(Array.isArray(v) && v.length === 0)));

  return {
    ...clean(city),
    pois: (city.pois ?? []).filter((p) => !p._deleted).map(clean),
  };
}

export function loadDraft(cityId, storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(cityId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('[draft] 读草稿失败', err);
    return null;
  }
}

export function loadPrev(cityId, storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(prevKey(cityId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 存草稿。返回 { ok, error }——调用方必须把失败提示给用户：
 * 静默失败的后果是用户以为存住了，其实一个字没存。
 */
export function saveDraft(cityId, draft, storage = defaultStorage()) {
  if (!storage) return { ok: false, error: new Error('这个浏览器不让用 localStorage') };
  try {
    // 写新的之前先留一份上一版，手滑清空了还能捞回来
    const current = storage.getItem(key(cityId));
    if (current) storage.setItem(prevKey(cityId), current);
    storage.setItem(key(cityId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

export function discardDraft(cityId, storage = defaultStorage()) {
  if (!storage) return;
  try {
    const current = storage.getItem(key(cityId));
    if (current) storage.setItem(prevKey(cityId), current); // 丢弃也留一手
    storage.removeItem(key(cityId));
  } catch (err) {
    console.warn('[draft] 丢弃草稿失败', err);
  }
}

/**
 * 草稿与线上数据对账。
 *   none  没有草稿，直接用线上版
 *   clean 有草稿，且它就是基于当前线上版改的
 *   stale 有草稿，但线上版在那之后变过（别人提交了，或者你在另一台机器上改了）
 *         —— 这种情况必须让用户自己选，直接覆盖就是在替他丢别人的改动
 */
export function reconcile(published, draft) {
  if (!draft?.city) return { status: 'none', city: published, draft: null };
  const status = draft.baseHash === hashCity(published) ? 'clean' : 'stale';
  return { status, city: draft.city, draft };
}

const sameCoord = (a, b) =>
  !!a && !!b && Math.abs(a.lng - b.lng) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9;

/** 除了坐标之外的字段是否一样 */
function sameExceptCoord(a, b) {
  const strip = (p) => {
    const { coord, ...rest } = compactPoi(p);
    return rest;
  };
  return stableString(strip(a)) === stableString(strip(b));
}

function compactPoi(poi) {
  return Object.fromEntries(Object.entries(poi).filter(([k, v]) =>
    !k.startsWith('_') && v !== undefined && v !== '' &&
    !(Array.isArray(v) && v.length === 0)));
}

/**
 * 线上版 → 工作副本 的差异。moved 单列出来：拖标记微调坐标是编辑模式里最常见的
 * 动作，跟"改了文案"混在一起报会让人看不出到底动了什么。
 */
export function diffCities(published, working) {
  const before = new Map((published.pois ?? []).map((p) => [p.id, p]));
  const after = new Map((working.pois ?? []).filter((p) => !p._deleted).map((p) => [p.id, p]));

  const added = [];
  const modified = [];
  const moved = [];
  const removed = [];

  for (const [id, poi] of after) {
    const old = before.get(id);
    if (!old) { added.push(poi); continue; }
    const coordSame = sameCoord(old.coord, poi.coord);
    const restSame = sameExceptCoord(old, poi);
    if (coordSame && restSame) continue;
    if (restSame) moved.push({ before: old, after: poi });
    else modified.push({ before: old, after: poi });
  }
  for (const [id, poi] of before) if (!after.has(id)) removed.push(poi);

  return { added, modified, moved, removed };
}

/** 改动总数，给"有没有未导出的东西"这类判断用 */
export function diffCount(diff) {
  return diff.added.length + diff.modified.length + diff.moved.length + diff.removed.length;
}

export function describeDiff(diff) {
  const parts = [];
  if (diff.added.length) parts.push(`新增 ${diff.added.length}`);
  if (diff.modified.length) parts.push(`修改 ${diff.modified.length}`);
  if (diff.moved.length) parts.push(`移动 ${diff.moved.length}`);
  if (diff.removed.length) parts.push(`删除 ${diff.removed.length}`);
  return parts.join(' · ') || '没有改动';
}

/** 软删除：打标记，不真删，导出时才剔除 */
export function softDelete(city, poiId) {
  const poi = city.pois.find((p) => p.id === poiId);
  if (poi) poi._deleted = true;
  return city;
}

export function restoreDeleted(city, poiId) {
  const poi = city.pois.find((p) => p.id === poiId);
  if (poi) delete poi._deleted;
  return city;
}
