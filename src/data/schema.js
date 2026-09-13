// 城市 JSON 的归一化与校验。全是纯函数，既给浏览器用，也给 tests/data.test.mjs
// 在 node 里直接扫真实数据目录用。
//
// 内容错误比代码错误多得多：经纬写反、id 撞车、分类拼错、坐标掉到别的省。
// 所以校验器的目标不是"schema 合法"，而是"这条数据画到地图上会不会明显是错的"。

import { fromDisplay, roundCoord, DATUMS } from '../geo/crs.js';
import { haversine } from '../geo/distance.js';

/** 点位离城市中心超过这个距离就报警（跨城的点位多半是坐标抄错了） */
const FAR_FROM_CENTER_KM = 100;

const err = (path, msg) => ({ level: 'error', path, msg });
const warn = (path, msg) => ({ level: 'warn', path, msg });

function isCoord(c) {
  return !!c && Number.isFinite(c.lng) && Number.isFinite(c.lat);
}

/** 经纬度本身合不合法。跟国家无关，纬度绝不会超过 90 */
function isOnEarth({ lng, lat }) {
  return Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

/**
 * 判断坐标是不是把经纬写反了。
 *
 * 不用"在不在某个国家的包围盒里"来判断——那样每加一个国家就要维护一个 bbox，
 * 而且首尔(127, 37.5) 和成都(104, 30.6) 这种经纬都在 ±90 内的地方，交换后依然
 * 是合法坐标，靠 bbox 根本看不出来。改成跟城市中心比：写反了会离中心十万八千里，
 * 而交换回来就近在咫尺。这个判据对任何国家都成立。
 */
function looksSwapped(coord, center) {
  const swapped = { lng: coord.lat, lat: coord.lng };
  if (!isOnEarth(swapped)) return false;
  // 纬度不可能超过 ±90。写了个 104 进去而交换后就合法，那就是写反了，不用再比距离
  if (Math.abs(coord.lat) > 90) return true;
  if (!isCoord(center)) return false;
  const now = haversine(center, coord);
  const then = haversine(center, swapped);
  return now > FAR_FROM_CENTER_KM * 1000 && then < FAR_FROM_CENTER_KM * 1000 && then < now / 10;
}

/** 分类查找。未知 id 不崩，降级成一个灰色兜底分类并由调用方决定要不要报警 */
export function findCategory(categories, id) {
  const hit = categories.find((c) => c.id === id);
  if (hit) return hit;
  return { id, label: id || '未分类', emoji: '📍', color: '#64748b', order: 999, unknown: true };
}

/** 国家/地区查找。未知 id 不崩，降级成一个只有 id 的兜底 */
export function findCountry(countries, id) {
  const hit = countries.find((c) => c.id === id);
  if (hit) return hit;
  return { id: id || 'unknown', name: id || '其他', flag: '🌍', order: 999, unknown: true };
}

/** 归一化国家表 */
export function normalizeCountries(raw) {
  const list = (raw?.countries ?? []).filter((c) => c && c.id);
  return list
    .map((c, i) => ({
      id: String(c.id),
      name: c.name ?? c.id,
      flag: c.flag ?? '🌍',
      order: Number.isFinite(c.order) ? c.order : i,
      defaultBasemap: c.defaultBasemap ?? '',
    }))
    .sort((a, b) => a.order - b.order);
}

/** 归一化分类表：排序 + 去掉缺 id 的条目 */
export function normalizeCategories(raw) {
  const list = (raw?.categories ?? []).filter((c) => c && c.id);
  return list
    .map((c, i) => ({
      id: String(c.id),
      label: c.label ?? c.id,
      emoji: c.emoji ?? '📍',
      color: c.color ?? '#64748b',
      order: Number.isFinite(c.order) ? c.order : i,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * 归一化一座城市：把坐标统一到 WGS-84、补默认值、保证可选字段类型稳定。
 *
 * datum 字段是"录入与展示一致"的最后一道保险：如果哪天有人直接从高德拾取器
 * 导出了一批 GCJ-02 坐标，只要在文件头写明 "datum": "gcj02"，读进来就会被转正，
 * 而不是默默偏 500 米。未知 datum 直接抛错，绝不猜。
 */
export function normalizeCity(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('城市数据不是对象');
  const datum = raw.datum ?? 'wgs84';
  if (!DATUMS.includes(datum)) {
    throw new Error(`城市 ${raw.id ?? '?'} 的 datum "${datum}" 无法识别，只支持 ${DATUMS.join(' / ')}`);
  }
  const toWgs = (c) => (isCoord(c) ? roundCoord(fromDisplay(c, datum)) : c);

  return {
    schema: raw.schema ?? 1,
    id: raw.id ?? '',
    name: raw.name ?? raw.id ?? '',
    nameEn: raw.nameEn ?? '',
    country: raw.country ?? 'cn',
    // 首页卡片用的展示字段，放在城市文件里让它自包含，index.json 由脚本派生
    region: raw.region ?? '',
    cover: raw.cover ?? '',
    tagline: raw.tagline ?? '',
    datum: 'wgs84', // 归一化后内存里永远是 WGS-84
    center: toWgs(raw.center),
    zoom: Number.isFinite(raw.zoom) ? raw.zoom : 12,
    // 城市可以指定默认底图：境外城市用高德只会得到一片空白
    basemap: raw.basemap ?? '',
    updated: raw.updated ?? '',
    notes: raw.notes ?? '',
    pois: (raw.pois ?? []).map((p) => ({
      ...p,
      id: p.id ?? '',
      name: p.name ?? '',
      category: p.category ?? '',
      coord: toWgs(p.coord),
      tags: Array.isArray(p.tags) ? p.tags : p.tags ? [p.tags] : [],
      links: Array.isArray(p.links) ? p.links : [],
    })),
  };
}

/**
 * 校验一座（已归一化的）城市，返回问题列表。
 * error 会让 data.test.mjs 变红；warn 只在控制台提示，不阻塞发布。
 */
export function validateCity(city, categories = []) {
  const problems = [];
  const at = (i, field) => `${city.id || '?'}.pois[${i}]${field ? '.' + field : ''}`;

  if (!city.id) problems.push(err('city.id', '缺少城市 id'));
  if (!city.name) problems.push(err('city.name', '缺少城市名'));
  if (!isCoord(city.center) || !isOnEarth(city.center)) {
    problems.push(err('city.center', '缺少或非法的城市中心坐标'));
  }
  if (!Array.isArray(city.pois) || city.pois.length === 0) {
    problems.push(err('city.pois', '这座城市一个点位都没有'));
    return problems;
  }

  const seen = new Map();
  city.pois.forEach((p, i) => {
    if (!p.id) problems.push(err(at(i), '缺少点位 id'));
    else if (seen.has(p.id)) problems.push(err(at(i, 'id'), `id "${p.id}" 与第 ${seen.get(p.id) + 1} 条重复`));
    else seen.set(p.id, i);

    if (!p.name) problems.push(err(at(i, 'name'), '缺少点位名称'));
    if (!p.category) problems.push(err(at(i, 'category'), '缺少分类'));
    else if (categories.length && !categories.some((c) => c.id === p.category)) {
      problems.push(warn(at(i, 'category'), `分类 "${p.category}" 不在 categories.json 里，会显示成灰色兜底样式`));
    }

    if (!isCoord(p.coord)) {
      problems.push(err(at(i, 'coord'), '缺少或非法的坐标'));
      return;
    }
    // 经纬写反是最高频的人工录入错误：成都写成 lng:30.65, lat:104.08。
    // 这一条要排在"坐标合法吗"前面——写反之后纬度常常就超出 ±90 了，
    // 先报一句笼统的"不在地球上"等于把线索藏起来
    if (looksSwapped(p.coord, city.center)) {
      problems.push(err(at(i, 'coord'), `坐标疑似经纬颠倒（写成 lng:${p.coord.lng}, lat:${p.coord.lat}，交换过来才在这座城市附近）`));
      return;
    }
    if (!isOnEarth(p.coord)) {
      problems.push(err(at(i, 'coord'), `坐标 ${p.coord.lng},${p.coord.lat} 不在地球上（经度要在 ±180、纬度 ±90 之内）`));
      return;
    }
    if (isCoord(city.center)) {
      const km = haversine(city.center, p.coord) / 1000;
      if (km > FAR_FROM_CENTER_KM) {
        problems.push(err(at(i, 'coord'), `离城市中心 ${km.toFixed(0)} km，超过 ${FAR_FROM_CENTER_KM} km，多半是坐标抄错了`));
      }
    }
  });

  return problems;
}

/** 只挑 error 级别 */
export function errorsOf(problems) {
  return problems.filter((p) => p.level === 'error');
}

/** 把问题列表拼成人能读的一段话 */
export function formatProblems(problems) {
  return problems.map((p) => `[${p.level}] ${p.path}: ${p.msg}`).join('\n');
}
