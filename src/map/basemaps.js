// 底图注册表。
//
// 两个关键字段：
//
// datum —— 瓦片决定了地图那套经纬度是什么基准。高德/腾讯系是 GCJ-02，其余都是
//   WGS-84，同一坐标画上去差 500 米。加新底图时 datum 不能猜，拿已知地标比一比。
//
// coverage —— 高德的海外数据基本是空的：实测首尔、釜山的中文瓦片返回 179 字节的
//   空白图（成都同级别瓦片是 5KB），高德卫星在首尔也只有 4KB 的占位 PNG（成都是
//   27KB 的真影像）。而它返回的是 200 而不是错误，tileerror 那条自动回退根本不会
//   触发，用户只会对着一片空白发呆。所以非中国大陆的城市直接不给这些源。
//
// 这几个源都不需要 API key，也都支持 https（Pages 是 https，混合内容会被拦）。

export const BASEMAPS = [
  {
    id: 'amap',
    label: '高德',
    datum: 'gcj02',
    coverage: 'cn',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: '1234',
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.amap.com/" target="_blank" rel="noopener">高德地图</a>',
  },
  {
    id: 'osm',
    label: 'OSM',
    datum: 'wgs84',
    coverage: 'global',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 贡献者',
  },
  {
    id: 'light',
    label: '简洁',
    datum: 'wgs84',
    coverage: 'global',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 贡献者 &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
  },
  {
    id: 'sat',
    label: '卫星',
    datum: 'wgs84',
    coverage: 'global',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics',
  },
];

export const DEFAULT_BASEMAP = 'amap';
/** 中国大陆之外统一用 OSM 起步：中文路网那几个源在境外是空白的 */
export const DEFAULT_BASEMAP_ABROAD = 'osm';

export function findBasemap(id) {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP);
}

/** 某个国家能用哪些底图。cn 全都能用，其他国家只给全球源 */
export function basemapsFor(countryId) {
  if (!countryId || countryId === 'cn') return BASEMAPS;
  return BASEMAPS.filter((b) => b.coverage === 'global');
}

/** 这座城市默认该用哪张底图：城市自己指定的优先，否则按国家给默认值 */
export function defaultBasemapFor(city, countryId) {
  const usable = basemapsFor(countryId);
  const wanted = city?.basemap && usable.find((b) => b.id === city.basemap);
  if (wanted) return wanted.id;
  const fallback = countryId && countryId !== 'cn' ? DEFAULT_BASEMAP_ABROAD : DEFAULT_BASEMAP;
  return usable.find((b) => b.id === fallback)?.id ?? usable[0].id;
}

/** 某个底图挂了的时候换哪个：只在同样覆盖这座城市的源里挑，优先换到不同基准的 */
export function fallbackFor(id, countryId) {
  const current = findBasemap(id);
  const usable = basemapsFor(countryId).filter((b) => b.id !== current.id);
  return usable.find((b) => b.datum !== current.datum) ?? usable[0] ?? null;
}
