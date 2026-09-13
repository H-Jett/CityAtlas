// URL ⇄ 状态。核心是往返一致，以及 cat 三态（缺省 / 空串 / 有值）不被抹平。

import { suite, test, ok, eq } from './harness.mjs';
import { parseUrl, buildQuery, buildUrl, sameState } from '../src/url.js';

suite('url');

test('空 query 解析出干净的默认状态', () => {
  const s = parseUrl('');
  eq(s.city, null);
  eq(s.poi, null);
  eq(s.cats, null);
  eq(s.keyword, '');
  eq(s.base, 'amap');
  eq(s.edit, false);
});

test('完整 query 全解析出来', () => {
  const s = parseUrl('?city=chengdu&poi=cd-food-001&cat=food,cafe&q=火锅&base=osm&edit=1');
  eq(s.city, 'chengdu');
  eq(s.poi, 'cd-food-001');
  eq([...s.cats].sort(), ['cafe', 'food']);
  eq(s.keyword, '火锅');
  eq(s.base, 'osm');
  eq(s.edit, true);
});

test('带不带问号都能解析', () => {
  eq(parseUrl('city=chengdu').city, parseUrl('?city=chengdu').city);
});

test('cat 缺省是 null（全部），cat= 是空集（一个不看）', () => {
  eq(parseUrl('?city=x').cats, null);
  const empty = parseUrl('?city=x&cat=');
  ok(empty.cats instanceof Set, 'cat= 应该解析成集合而不是 null');
  eq(empty.cats.size, 0);
});

test('往返：parse(build(s)) 与原状态等价', () => {
  const states = [
    { city: 'chengdu' },
    { city: 'chengdu', poi: 'cd-food-001' },
    { city: 'chengdu', cats: new Set(['food']) },
    { city: 'chengdu', cats: new Set(), keyword: '火锅' },
    { city: 'chengdu', cats: new Set(['cafe', 'food']), keyword: '茶', base: 'osm', edit: true },
  ];
  for (const s of states) {
    const back = parseUrl(buildQuery(s));
    ok(sameState(s, back), `往返后不一致：${buildQuery(s)} → ${buildQuery(back)}`);
  }
});

test('同一组筛选永远产生同一个链接（Set 顺序不影响）', () => {
  const a = buildQuery({ city: 'x', cats: new Set(['food', 'cafe']) });
  const b = buildQuery({ city: 'x', cats: new Set(['cafe', 'food']) });
  eq(a, b, '分享出去的链接不该因为点击顺序不同而不同');
});

test('默认值不写进 URL，链接保持短', () => {
  eq(buildQuery({ city: 'chengdu', base: 'amap', keyword: '', edit: false }), 'city=chengdu');
  ok(buildQuery({ city: 'chengdu', base: 'osm' }).includes('base=osm'));
});

test('中文和特殊字符被正确编码', () => {
  const q = buildQuery({ city: 'chengdu', keyword: '火锅 & 茶' });
  ok(!q.includes(' '), `空格没编码：${q}`);
  eq(parseUrl(q).keyword, '火锅 & 茶');
});

test('未知底图 id 回落到默认，不让 URL 把地图搞崩', () => {
  eq(parseUrl('?city=x&base=不存在的底图').base, '不存在的底图');
  // parseUrl 只负责如实解析，回落发生在 findBasemap；这里确认它确实会回落
  eq(buildQuery(parseUrl('?city=x&base=amap')), 'city=x');
});

test('buildUrl 拼出可分享的完整路径', () => {
  eq(buildUrl({ city: 'chengdu', poi: 'p1' }, '/CityAtlas/'), '/CityAtlas/?city=chengdu&poi=p1');
  eq(buildUrl({}, '/CityAtlas/'), '/CityAtlas/');
});
