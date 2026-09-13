// 城市数据校验器的测试。用例基本都是照着"人会怎么录错"设计的：
// 经纬写反、id 撞车、分类拼错、坐标掉到别的省。

import { suite, test, ok, eq, throws } from './harness.mjs';
import {
  normalizeCity, normalizeCategories, validateCity, findCategory, errorsOf,
} from '../src/data/schema.js';

suite('data/schema');

const CATS = normalizeCategories({
  categories: [
    { id: 'food', label: '美食', emoji: '🍜', color: '#e5484d', order: 1 },
    { id: 'sight', label: '景点', emoji: '🏯', color: '#f5a524', order: 2 },
  ],
});

const baseCity = (pois) => ({
  id: 'chengdu', name: '成都', datum: 'wgs84',
  center: { lng: 104.06, lat: 30.57 }, zoom: 13, pois,
});

const poi = (over = {}) => ({
  id: 'p1', name: '某处', category: 'food', coord: { lng: 104.06, lat: 30.66 }, ...over,
});

const codes = (city, cats = CATS) => validateCity(normalizeCity(city), cats);

test('正常数据零问题', () => {
  eq(codes(baseCity([poi()])), []);
});

test('必填字段缺失报 error', () => {
  const problems = codes(baseCity([poi({ id: '', name: '', category: '' })]));
  eq(errorsOf(problems).length, 3, '应报 id/name/category 三个错');
});

test('点位 id 重复报 error 并指出是第几条', () => {
  const problems = errorsOf(codes(baseCity([poi(), poi({ name: '另一处' })])));
  eq(problems.length, 1);
  ok(problems[0].msg.includes('重复'), problems[0].msg);
  ok(problems[0].msg.includes('第 1 条'), problems[0].msg);
});

test('经纬颠倒被点名，而不是只说超范围', () => {
  // 成都写成 lng:30.66, lat:104.06 —— 这是最高频的人工录入错误
  const problems = errorsOf(codes(baseCity([poi({ coord: { lng: 30.66, lat: 104.06 } })])));
  eq(problems.length, 1);
  ok(problems[0].msg.includes('经纬颠倒'), problems[0].msg);
});

test('境外坐标报错但不误判成经纬颠倒', () => {
  const problems = errorsOf(codes(baseCity([poi({ coord: { lng: 139.76, lat: 35.68 } })])));
  eq(problems.length, 1);
  ok(problems[0].msg.includes('不在中国境内'), problems[0].msg);
});

test('点位离城市中心太远报 error', () => {
  // 成都的城市文件里混进一个上海的坐标
  const problems = errorsOf(codes(baseCity([poi({ coord: { lng: 121.47, lat: 31.23 } })])));
  eq(problems.length, 1);
  ok(problems[0].msg.includes('km'), problems[0].msg);
});

test('未知分类只报 warn，不阻塞渲染', () => {
  const problems = codes(baseCity([poi({ category: 'hotspring' })]));
  eq(errorsOf(problems).length, 0);
  eq(problems.length, 1);
  eq(problems[0].level, 'warn');
});

test('findCategory 对未知 id 返回灰色兜底而不是 undefined', () => {
  const cat = findCategory(CATS, 'nope');
  ok(cat.unknown);
  eq(cat.color, '#64748b');
  eq(findCategory(CATS, 'food').label, '美食');
});

test('一个点位都没有报 error', () => {
  ok(errorsOf(codes(baseCity([]))).length > 0);
});

test('normalizeCity 把 gcj02 数据转成 WGS-84 存储', () => {
  const raw = { ...baseCity([poi({ coord: { lng: 104.0565, lat: 30.6693 } })]), datum: 'gcj02' };
  const city = normalizeCity(raw);
  eq(city.datum, 'wgs84');
  // 高德坐标转回 GPS 基准，经度会往西挪 2~3 毫度
  ok(city.pois[0].coord.lng < 104.0565, '经度应变小');
  ok(Math.abs(city.pois[0].coord.lng - 104.054) < 0.001, `实际 ${city.pois[0].coord.lng}`);
});

test('未知 datum 直接抛错，不猜', () => {
  throws(() => normalizeCity({ ...baseCity([poi()]), datum: 'cgcs2000' }));
});

test('normalizeCity 补默认值、稳定可选字段类型', () => {
  const city = normalizeCity({ id: 'x', center: { lng: 104, lat: 30 }, pois: [{ id: 'a', tags: '单个标签' }] });
  eq(city.zoom, 12);
  eq(city.name, 'x');
  eq(city.pois[0].tags, ['单个标签']);
  eq(city.pois[0].links, []);
});
