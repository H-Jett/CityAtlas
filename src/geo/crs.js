// WGS-84 ⇄ GCJ-02 ⇄ BD-09 互转。全项目坐标换算的唯一出口。
//
// 为什么需要它：高德/腾讯的地图瓦片用 GCJ-02（俗称火星坐标，在 WGS-84 上叠了一层
// 保密偏移），OpenStreetMap 用 WGS-84。同一个经纬度在两种底图上能差出 500 米，
// 直接把 GPS 坐标画到高德瓦片上，标记会整体挪到隔壁街区去。
//
// 本项目的约定：
//   · 数据文件里的 coord 一律是 WGS-84（GPS 原生基准，也是 GeoJSON 的基准）。
//   · 往地图上画之前过 toDisplay()，从地图上取坐标之后过 fromDisplay()。
//   · 业务代码只许用 toDisplay / fromDisplay，不要直接调下面的 wgs84ToGcj02 等函数
//     —— 单一出口才能保证「转了几次」是可数的。漏转和多转的症状一模一样，
//     都是点位偏移，只能靠纪律避免。
//
// 坐标一律用具名对象 {lng, lat}，不用数组：Leaflet 是 [lat, lng]、GeoJSON 是
// [lng, lat]、下面的转换公式习惯 (lng, lat)，三种顺序在一个文件里打架是这类项目
// 最高频的 bug。只有 toLatLngArray / fromLatLng 两个函数允许出现数组。

const PI = Math.PI;
const X_PI = (PI * 3000) / 180; // BD-09 特有的角度常数
const A = 6378245.0; // 克拉索夫斯基椭球长半轴（GCJ-02 偏移算法用的就是这个老椭球）
const EE = 0.00669342162296594323; // 第一偏心率平方

/** 支持的坐标基准 */
export const DATUMS = ['wgs84', 'gcj02', 'bd09'];

/** 中国大陆的粗略包围盒。境外不做偏移（GCJ-02 只在境内生效） */
export function outOfChina(lng, lat) {
  return !(lng > 72.004 && lng < 137.8347 && lat > 0.8293 && lat < 55.8271);
}

function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return ret;
}

function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return ret;
}

/** WGS-84 → GCJ-02 */
export function wgs84ToGcj02({ lng, lat }) {
  if (outOfChina(lng, lat)) return { lng, lat };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

/**
 * GCJ-02 → WGS-84，不动点迭代反解。
 *
 * 常见的错误写法是「把 GCJ 当 WGS 正转一遍，拿差值反向减回去」——那只是一阶近似，
 * 在偏移梯度大的地方残差能到 5~10 米，而且不满足往返一致性：编辑模式下反复切换
 * 底图，点位会一次次地「走」。迭代三轮就能收敛到亚毫米，代价可以忽略。
 */
export function gcj02ToWgs84({ lng, lat }, maxIter = 10) {
  if (outOfChina(lng, lat)) return { lng, lat };
  let wgs = { lng, lat };
  for (let i = 0; i < maxIter; i++) {
    const fwd = wgs84ToGcj02(wgs);
    const dLng = lng - fwd.lng;
    const dLat = lat - fwd.lat;
    wgs = { lng: wgs.lng + dLng, lat: wgs.lat + dLat };
    // 1e-9 度 ≈ 0.1 毫米，够了
    if (Math.abs(dLng) < 1e-9 && Math.abs(dLat) < 1e-9) break;
  }
  return wgs;
}

/** BD-09（百度）→ GCJ-02 */
export function bd09ToGcj02({ lng, lat }) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
}

/** GCJ-02 → BD-09（百度） */
export function gcj02ToBd09({ lng, lat }) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return { lng: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}

function assertDatum(datum) {
  if (!DATUMS.includes(datum)) {
    throw new Error(`未知坐标基准 "${datum}"，只支持 ${DATUMS.join(' / ')}`);
  }
}

/**
 * 存储坐标（WGS-84）→ 指定基准的显示坐标。
 * 画 marker、设地图中心、算 bounds 之前都要过这一道。
 */
export function toDisplay(coord, datum) {
  assertDatum(datum);
  if (datum === 'wgs84') return { ...coord };
  const gcj = wgs84ToGcj02(coord);
  return datum === 'gcj02' ? gcj : gcj02ToBd09(gcj);
}

/**
 * 指定基准的坐标 → 存储坐标（WGS-84）。
 * 地图点击、marker 拖拽、以及表单里粘贴外部坐标，都要过这一道再入库。
 */
export function fromDisplay(ll, datum) {
  assertDatum(datum);
  if (datum === 'wgs84') return { ...ll };
  const gcj = datum === 'bd09' ? bd09ToGcj02(ll) : ll;
  return gcj02ToWgs84(gcj);
}

/** {lng,lat} → Leaflet 的 [lat, lng]。整个项目只有这里和 fromLatLng 能出现数组顺序 */
export function toLatLngArray({ lng, lat }) {
  return [lat, lng];
}

/** Leaflet 的 LatLng 对象 → {lng, lat} */
export function fromLatLng(ll) {
  return { lng: ll.lng, lat: ll.lat };
}

/** 坐标保留 6 位小数（≈ 0.1 米），避免浮点尾巴污染导出的 JSON diff */
export function roundCoord({ lng, lat }, digits = 6) {
  const f = 10 ** digits;
  return { lng: Math.round(lng * f) / f, lat: Math.round(lat * f) / f };
}
