// 距离与包围盒。用于：编辑模式显示「两种基准差了多少米」、schema 校验点位是否
// 离城市中心太远、以及 fitBounds 前算范围。

const R = 6371008.8; // 地球平均半径（米，IUGG 平均半径）

/** 两点球面距离，单位米。同基准比较才有意义 */
export function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 人类可读的距离：<1km 说米，否则说公里 */
export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** 一组坐标的包围盒，空数组返回 null */
export function bbox(coords) {
  if (!coords.length) return null;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const { lng, lat } of coords) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, east, south, north };
}
