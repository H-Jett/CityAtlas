// 城市 JSON 的稳定序列化。导出和草稿哈希共用一套，两边必须完全一致。
//
// 为什么不直接 JSON.stringify(city, null, 2)：
//   1. key 顺序跟着对象的插入顺序走，编辑过的点位字段会乱序，git diff 全是噪音；
//   2. coord 会被拆成三行，一份 20 个点位的文件平白多出 40 行，读起来很难受；
//   3. 浮点尾巴（104.05080799999999）会原样写进文件。
//
// 目标是幂等：导出 → 粘回来 → 再导出，字节完全一致。不幂等的话，每次打开编辑器
// 又关掉都会产生一个非空 diff，久了就没人相信这个 diff 了。

const CITY_KEYS = ['schema', 'id', 'name', 'country', 'datum', 'center', 'zoom', 'basemap', 'updated', 'notes', 'pois'];
const POI_KEYS = [
  'id', 'name', 'category', 'coord',
  'summary', 'desc', 'why', 'tags',
  'price', 'hours', 'duration', 'bestTime', 'address', 'rating',
  'links', 'nearby',
];

/** 按给定顺序排 key，表里没有的排在后面并保持原有相对顺序（别人加的字段不能丢） */
function orderedEntries(obj, order) {
  const known = order.filter((k) => obj[k] !== undefined);
  const rest = Object.keys(obj).filter((k) => !order.includes(k));
  return [...known, ...rest].map((k) => [k, obj[k]]);
}

const isCoord = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === 2 && 'lng' in v && 'lat' in v;

/** 坐标固定 6 位小数（≈0.1 米），够用且不会带浮点尾巴 */
function coordText(c) {
  const n = (x) => Number(Number(x).toFixed(6));
  return `{ "lng": ${n(c.lng)}, "lat": ${n(c.lat)} }`;
}

/** 纯字符串的短数组内联成一行（tags 这种） */
const isShortStringArray = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') &&
  v.reduce((n, s) => n + s.length, 0) < 70;

function render(value, indent, keyOrder = null) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);

  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (isCoord(value)) return coordText(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isShortStringArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    const items = value.map((v) => padIn + render(v, indent + 1, keyOrder));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }

  const entries = orderedEntries(value, keyOrder ?? []);
  if (!entries.length) return '{}';
  const lines = entries.map(([k, v]) =>
    `${padIn}${JSON.stringify(k)}: ${render(v, indent + 1, k === 'pois' ? POI_KEYS : keyOrder)}`);
  return `{\n${lines.join(',\n')}\n${pad}}`;
}

/** 城市 → 可直接写进 data/cities/<id>.json 的文本（含末尾换行） */
export function serializeCity(city) {
  const entries = orderedEntries(city, CITY_KEYS);
  const lines = entries.map(([k, v]) => {
    const order = k === 'pois' ? POI_KEYS : null;
    return `  ${JSON.stringify(k)}: ${render(v, 1, order)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** 紧凑且稳定的串，只用来算哈希，不给人看 */
export function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableString(value[k])}`).join(',')}}`;
}

/** FNV-1a 32 位。够用来判断"线上那份变过没有"，不是密码学用途 */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
