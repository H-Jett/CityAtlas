// 草稿与差异对账。这个文件守的是"别把用户录的东西弄丢"：
// 哈希对内容敏感但对 key 顺序不敏感、线上版变过要判成 stale、软删除项不进导出、
// 序列化幂等（否则每次打开编辑器再关掉都会产生一个假 diff）。

import { suite, test, ok, eq } from './harness.mjs';
import {
  hashCity, compact, saveDraft, loadDraft, loadPrev, discardDraft,
  reconcile, diffCities, diffCount, describeDiff, softDelete, restoreDeleted,
} from '../src/editor/draft.js';
import { serializeCity, stableString } from '../src/editor/serialize.js';

suite('editor/draft');

/** node 里没有 localStorage，用个最小实现顶上 */
function fakeStorage(failOnWrite = false) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failOnWrite) throw new DOMException('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const city = (pois) => ({
  schema: 1, id: 'chengdu', name: '成都', datum: 'wgs84',
  center: { lng: 104.06, lat: 30.57 }, zoom: 13,
  pois,
});
const poi = (over = {}) => ({
  id: 'p1', name: '鹤鸣茶社', category: 'cafe',
  coord: { lng: 104.054821, lat: 30.659719 }, summary: '百年茶馆',
  tags: ['露天'], links: [], ...over,
});

test('hashCity 对 key 顺序不敏感，对内容敏感', () => {
  const a = city([poi()]);
  const b = city([{ ...poi() }]);
  // 打乱字段插入顺序
  const shuffled = city([Object.fromEntries(Object.entries(poi()).reverse())]);
  eq(hashCity(a), hashCity(b));
  eq(hashCity(a), hashCity(shuffled), 'key 顺序不该影响哈希');

  const changed = city([poi({ summary: '改了一个字' })]);
  ok(hashCity(a) !== hashCity(changed), '内容变了哈希必须变');
});

test('compact 丢掉软删除项和内部字段', () => {
  const c = city([poi(), poi({ id: 'p2', _deleted: true }), poi({ id: 'p3', _new: true })]);
  const out = compact(c);
  eq(out.pois.map((p) => p.id), ['p1', 'p3'], '软删除的不该出现');
  ok(!('_new' in out.pois[1]), '下划线开头的内部字段不该导出');
  ok(!('links' in out.pois[0]), '空数组不该导出');
});

test('存草稿会把上一版留在 .prev 槽里', () => {
  const s = fakeStorage();
  saveDraft('chengdu', { baseHash: 'aaa', city: city([poi()]) }, s);
  saveDraft('chengdu', { baseHash: 'aaa', city: city([poi({ name: '第二版' })]) }, s);
  eq(loadDraft('chengdu', s).city.pois[0].name, '第二版');
  eq(loadPrev('chengdu', s).city.pois[0].name, '鹤鸣茶社', '上一版应该留着');
});

test('存储写失败要如实返回错误，不能静默吞掉', () => {
  const res = saveDraft('chengdu', { baseHash: 'x', city: city([poi()]) }, fakeStorage(true));
  eq(res.ok, false);
  ok(res.error, '必须带上错误对象，上层才能提示用户');
});

test('丢弃草稿也留一份在 .prev', () => {
  const s = fakeStorage();
  saveDraft('chengdu', { baseHash: 'aaa', city: city([poi()]) }, s);
  discardDraft('chengdu', s);
  eq(loadDraft('chengdu', s), null);
  ok(loadPrev('chengdu', s), '丢弃后还应该能捞回来');
});

test('reconcile：没草稿 / 草稿是新的 / 线上版变过', () => {
  const published = city([poi()]);
  eq(reconcile(published, null).status, 'none');

  const fresh = { baseHash: hashCity(published), city: city([poi({ name: '改过' })]) };
  eq(reconcile(published, fresh).status, 'clean');

  const stale = { baseHash: 'deadbeef', city: city([poi({ name: '改过' })]) };
  const r = reconcile(published, stale);
  eq(r.status, 'stale', '线上版变过必须判成 stale，不能默默覆盖');
});

test('diff 把"只挪了位置"和"改了内容"分开报', () => {
  const published = city([poi(), poi({ id: 'p2', name: '宽窄巷子', category: 'sight' })]);
  const working = city([
    poi({ coord: { lng: 104.0549, lat: 30.6598 } }),      // 只挪了坐标
    poi({ id: 'p2', name: '宽窄巷子', category: 'sight', summary: '新写的摘要' }), // 只改内容
    poi({ id: 'p3', name: '新加的' }),                     // 新增
  ]);
  const d = diffCities(published, working);
  eq(d.moved.length, 1, '挪位置应算 moved');
  eq(d.modified.length, 1);
  eq(d.added.map((p) => p.id), ['p3']);
  eq(d.removed.length, 0);
  eq(diffCount(d), 3);
  ok(describeDiff(d).includes('移动'), describeDiff(d));
});

test('软删除算 removed，恢复后回到无改动', () => {
  const published = city([poi(), poi({ id: 'p2' })]);
  const working = structuredClone(published);
  softDelete(working, 'p2');
  eq(diffCities(published, working).removed.map((p) => p.id), ['p2']);

  restoreDeleted(working, 'p2');
  eq(diffCount(diffCities(published, working)), 0, '恢复后不该还有 diff');
});

test('没改动时 diff 为空（新加载的副本不该报脏）', () => {
  const published = city([poi(), poi({ id: 'p2', name: '别处' })]);
  const working = structuredClone(published);
  eq(diffCount(diffCities(published, working)), 0);
  eq(describeDiff(diffCities(published, working)), '没有改动');
});

test('serializeCity 幂等：导出 → 解析 → 再导出，字节一致', () => {
  const c = city([poi(), poi({ id: 'p2', name: '宽窄巷子', category: 'sight', tags: ['老街', '人多'] })]);
  const once = serializeCity(compact(c));
  const twice = serializeCity(compact(JSON.parse(once)));
  eq(once, twice, '不幂等的话每次开关编辑器都会产生假 diff');
});

test('序列化：坐标一行、固定 key 顺序、末尾换行', () => {
  const text = serializeCity(compact(city([poi()])));
  ok(text.includes('"coord": { "lng": 104.054821, "lat": 30.659719 }'), text);
  ok(text.endsWith('}\n'), '末尾要有换行，不然 git 会抱怨');
  ok(text.indexOf('"id"') < text.indexOf('"name"'), 'key 顺序应按约定表');
  ok(text.includes('"tags": ["露天"]'), '短字符串数组应内联成一行');
});

test('序列化不丢掉约定表里没有的自定义字段', () => {
  const text = serializeCity(compact(city([poi({ myOwnField: '保留我' })])));
  ok(text.includes('myOwnField'), '别人加的字段不能在导出时被吃掉');
});

test('坐标写进文件前截到 6 位，不带浮点尾巴', () => {
  const text = serializeCity(compact(city([poi({ coord: { lng: 104.05080799999999, lat: 30.6661938 } })])));
  ok(text.includes('104.050808'), text);
  ok(!text.includes('99999'), '浮点尾巴不该进文件');
});

test('stableString 对 key 顺序不敏感', () => {
  eq(stableString({ a: 1, b: 2 }), stableString({ b: 2, a: 1 }));
});
