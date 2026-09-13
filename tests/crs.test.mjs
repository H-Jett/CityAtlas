// 坐标基准转换的回归测试。
//
// 这个文件存在的首要理由：GCJ-02 → WGS-84 有一种流传很广的错误实现（正转一遍
// 取差值反减），单看某个点的结果「差不多对」，但不满足往返一致性。下面第一条
// 用例就是冲它去的 —— 如果有人把 crs.js 里的迭代改回一阶近似，它会立刻变红。

import { suite, test, ok, eq, near, between, throws } from './harness.mjs';
import {
  outOfChina, wgs84ToGcj02, gcj02ToWgs84, bd09ToGcj02, gcj02ToBd09,
  toDisplay, fromDisplay, toLatLngArray, fromLatLng, roundCoord,
} from '../src/geo/crs.js';
import { haversine } from '../src/geo/distance.js';

suite('geo/crs');

// 覆盖几个偏移梯度差别较大的地方
const POINTS = {
  天安门: { lng: 116.3912, lat: 39.907 },
  成都天府广场: { lng: 104.0665, lat: 30.5728 },
  乌鲁木齐: { lng: 87.6168, lat: 43.8256 },
  三亚: { lng: 109.5082, lat: 18.2479 },
  漠河: { lng: 122.5388, lat: 53.4733 },
};

test('wgs → gcj → wgs 往返误差小于 1e-7 度（≈1 厘米）', () => {
  for (const [name, p] of Object.entries(POINTS)) {
    const back = gcj02ToWgs84(wgs84ToGcj02(p));
    near(back.lng, p.lng, 1e-7, `${name} 经度往返`);
    near(back.lat, p.lat, 1e-7, `${name} 纬度往返`);
  }
});

test('往返后的实地距离残差小于 1 厘米', () => {
  for (const [name, p] of Object.entries(POINTS)) {
    const back = gcj02ToWgs84(wgs84ToGcj02(p));
    ok(haversine(p, back) < 0.01, `${name} 往返残差 ${haversine(p, back)} m 过大`);
  }
});

test('境外坐标原样返回（GCJ-02 只在境内生效）', () => {
  const 东京 = { lng: 139.7671, lat: 35.6812 };
  const 纽约 = { lng: -73.9857, lat: 40.7484 };
  ok(outOfChina(东京.lng, 东京.lat));
  ok(outOfChina(纽约.lng, 纽约.lat));
  eq(wgs84ToGcj02(东京), 东京);
  eq(gcj02ToWgs84(纽约), 纽约);
  ok(!outOfChina(116.39, 39.9), '北京应判定为境内');
});

test('境内偏移量级落在 200~800 米', () => {
  for (const [name, p] of Object.entries(POINTS)) {
    const shift = haversine(p, wgs84ToGcj02(p));
    between(shift, 200, 800, `${name} 的 GCJ-02 偏移量`);
  }
});

test('双重转换守卫：转两次会明显偏离转一次', () => {
  // 漏转和多转的症状都是"点位偏了"，这条用例保证多转一次一定看得出来，
  // 免得将来有人在 mapview 和 markers 里各加了一次转换却互相抵消不掉。
  const p = POINTS.成都天府广场;
  const once = toDisplay(p, 'gcj02');
  const twice = wgs84ToGcj02(once);
  ok(haversine(once, twice) > 100, `转两次只差 ${haversine(once, twice)} m，守卫失效`);
});

test('toDisplay/fromDisplay 对 wgs84 是恒等', () => {
  const p = POINTS.三亚;
  eq(toDisplay(p, 'wgs84'), p);
  eq(fromDisplay(p, 'wgs84'), p);
});

test('toDisplay/fromDisplay 往返（gcj02 与 bd09）', () => {
  // gcj02 走迭代反解，能收敛到厘米以下；bd09 的公式是一对近似式、并不严格互逆，
  // 实测往返残差约 7 厘米（乌鲁木齐最大）。地图上 7 厘米无关紧要，但阈值要分开写，
  // 否则等于用 bd09 的宽松标准掩盖 gcj02 那边可能的退化。
  const TOL = { gcj02: 0.05, bd09: 0.2 };
  for (const datum of ['gcj02', 'bd09']) {
    for (const [name, p] of Object.entries(POINTS)) {
      const back = fromDisplay(toDisplay(p, datum), datum);
      ok(haversine(p, back) < TOL[datum],
        `${name} 在 ${datum} 下往返残差 ${haversine(p, back)} m 超过 ${TOL[datum]} m`);
    }
  }
});

test('bd09 ⇄ gcj02 往返', () => {
  const gcj = wgs84ToGcj02(POINTS.天安门);
  const back = bd09ToGcj02(gcj02ToBd09(gcj));
  ok(haversine(gcj, back) < 0.05);
  // 百度在高德基础上又偏了几百米，不能当成同一套
  between(haversine(gcj, gcj02ToBd09(gcj)), 300, 1500, '百度相对高德的偏移');
});

test('未知基准直接抛错，不静默当成 wgs84', () => {
  throws(() => toDisplay(POINTS.天安门, 'cgcs2000'));
  throws(() => fromDisplay(POINTS.天安门, ''));
  throws(() => toDisplay(POINTS.天安门, undefined));
});

test('Leaflet 数组互转保持 [lat, lng] 顺序', () => {
  eq(toLatLngArray({ lng: 104.06, lat: 30.57 }), [30.57, 104.06]);
  eq(fromLatLng({ lat: 30.57, lng: 104.06, alt: 0 }), { lng: 104.06, lat: 30.57 });
});

test('roundCoord 截到 6 位小数', () => {
  eq(roundCoord({ lng: 104.06654321987, lat: 30.5728123456 }), { lng: 104.066543, lat: 30.572812 });
});
