// 筛选逻辑。重点守两件事：cats 的三态语义（全部 / 选几个 / 一个不选）不被偷偷合并，
// 以及"从全部状态点一下分类"是筛出这一类而不是把它关掉。

import { suite, test, ok, eq } from './harness.mjs';
import { filterPois, toggleCat, usedCategories, poiMatchesKeyword } from '../src/ui/filter.js';

suite('ui/filter');

const CATS = [
  { id: 'food', label: '美食', emoji: '🍜', color: '#e5484d', order: 1 },
  { id: 'sight', label: '景点', emoji: '🏯', color: '#f5a524', order: 2 },
  { id: 'cafe', label: '咖啡', emoji: '☕', color: '#b45309', order: 3 },
];
const ALL = ['food', 'sight', 'cafe'];

const POIS = [
  { id: 'a', name: '小龙翻大江', category: 'food', tags: ['火锅'], summary: '牛油锅底' },
  { id: 'b', name: '宽窄巷子', category: 'sight', tags: ['老街', '人多'], desc: '青砖院墙' },
  { id: 'c', name: '鹤鸣茶社', category: 'cafe', tags: ['露天'], why: '成都最不装的地方' },
];

const ids = (list) => list.map((p) => p.id);

test('cats 为 null 时全都显示', () => {
  eq(ids(filterPois(POIS, { cats: null })), ['a', 'b', 'c']);
});

test('选中若干分类只显示这几类', () => {
  eq(ids(filterPois(POIS, { cats: new Set(['food', 'cafe']) })), ['a', 'c']);
});

test('空集合是合法状态：一个都不显示', () => {
  eq(ids(filterPois(POIS, { cats: new Set() })), []);
});

test('关键词匹配名称、标签、摘要、正文和推荐理由', () => {
  eq(ids(filterPois(POIS, { keyword: '火锅' })), ['a']);      // 标签
  eq(ids(filterPois(POIS, { keyword: '青砖' })), ['b']);      // 正文
  eq(ids(filterPois(POIS, { keyword: '不装' })), ['c']);      // 推荐理由
  eq(ids(filterPois(POIS, { keyword: '牛油' })), ['a']);      // 摘要
  eq(ids(filterPois(POIS, { keyword: '巷子' })), ['b']);      // 名称
});

test('关键词是空白时不过滤', () => {
  eq(ids(filterPois(POIS, { keyword: '   ' })), ['a', 'b', 'c']);
  ok(poiMatchesKeyword(POIS[0], ''));
});

test('分类与关键词是交集', () => {
  eq(ids(filterPois(POIS, { cats: new Set(['food']), keyword: '巷子' })), []);
  eq(ids(filterPois(POIS, { cats: new Set(['sight']), keyword: '巷子' })), ['b']);
});

test('从"全部"点一个分类 = 只看这一类', () => {
  eq([...toggleCat(null, 'food', ALL)], ['food']);
});

test('再点别的分类是追加，点自己是去掉', () => {
  const one = toggleCat(null, 'food', ALL);
  const two = toggleCat(one, 'cafe', ALL);
  eq([...two].sort(), ['cafe', 'food']);
  eq([...toggleCat(two, 'food', ALL)], ['cafe']);
});

test('点到一个都不剩就是空集，不偷偷替用户变回全部', () => {
  const one = toggleCat(null, 'food', ALL);
  const none = toggleCat(one, 'food', ALL);
  ok(none instanceof Set);
  eq(none.size, 0);
});

test('把所有分类都点亮等价于不筛选，收敛成 null', () => {
  let cats = toggleCat(null, 'food', ALL);
  cats = toggleCat(cats, 'sight', ALL);
  cats = toggleCat(cats, 'cafe', ALL);
  eq(cats, null);
});

test('只列出城市里真有点位的分类，并带计数', () => {
  const used = usedCategories(POIS, CATS);
  eq(used.map((c) => c.id), ['food', 'sight', 'cafe']);
  eq(used.map((c) => c.count), [1, 1, 1]);

  const onlyFood = usedCategories([POIS[0]], CATS);
  eq(onlyFood.map((c) => c.id), ['food'], '没有点位的分类不该出现 chip');
});

test('数据里有但 categories.json 里没有的分类也能筛', () => {
  const extra = [...POIS, { id: 'd', name: '温泉', category: 'hotspring', tags: [] }];
  const used = usedCategories(extra, CATS);
  const last = used.at(-1);
  eq(last.id, 'hotspring');
  ok(last.unknown, '应标记为未知分类');
  // 没有 chip 就意味着这些点位永远被藏起来，那比多一个灰 chip 糟糕得多
  eq(ids(filterPois(extra, { cats: new Set(['hotspring']) })), ['d']);
});
