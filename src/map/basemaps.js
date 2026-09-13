// 底图注册表。
//
// datum 字段是这张表存在的真正理由：瓦片决定了地图那套经纬度是什么基准。
// 高德/腾讯系的瓦片是 GCJ-02，OSM 系是 WGS-84，同一个坐标画上去能差 500 米。
// 加新底图时 datum 千万别猜——拿一个已知地标（比如天安门）在上面比一比。
//
// 这几个源都不需要 API key，也都支持 https（GitHub Pages 是 https，混合内容会被拦）。

export const BASEMAPS = [
  {
    id: 'amap',
    label: '高德',
    datum: 'gcj02',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: '1234',
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.amap.com/" target="_blank" rel="noopener">高德地图</a>',
  },
  {
    id: 'osm',
    label: 'OSM',
    datum: 'wgs84',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 贡献者',
  },
  {
    id: 'sat',
    label: '卫星',
    datum: 'gcj02',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: '1234',
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.amap.com/" target="_blank" rel="noopener">高德地图</a>',
  },
];

export const DEFAULT_BASEMAP = 'amap';

export function findBasemap(id) {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP);
}

/** 某个底图挂了的时候换哪个：优先换到不同基准的源，这样一眼能看出是不是同一家挂了 */
export function fallbackFor(id) {
  const current = findBasemap(id);
  return BASEMAPS.find((b) => b.id !== current.id && b.datum !== current.datum)
    ?? BASEMAPS.find((b) => b.id !== current.id);
}
