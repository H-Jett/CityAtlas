// 扫真实的 data/ 目录。这是本项目最值钱的一个测试文件：
// 代码逻辑写错了页面一眼看得出来，数据抄错一个小数点却能在地图上安静地待很久。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite, test, ok, eq } from './harness.mjs';
import { normalizeCity, normalizeCategories, validateCity, errorsOf, formatProblems } from '../src/data/schema.js';

suite('data/（真实数据）');

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const readJSON = (rel) => JSON.parse(readFileSync(DATA + rel, 'utf-8'));

const categories = normalizeCategories(readJSON('categories.json'));
const index = readJSON('cities/index.json');

test('index.json 与城市文件同步', () => {
  // 索引是派生产物：城市文件改了点位数、改了封面，索引不跟着变，首页就会显示旧数字。
  // 这条直接跑生成脚本的 --check，省得在两个地方各写一遍对账逻辑
  try {
    execFileSync('node', [fileURLToPath(new URL('../scripts/update_index.mjs', import.meta.url)), '--check'],
      { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
      || '索引过期了，跑一次 node scripts/update_index.mjs');
  }
});

test('每座城市都有国家，且国家在 countries.json 里', () => {
  const known = new Set(readJSON('countries.json').countries.map((c) => c.id));
  for (const c of index.cities) {
    ok(c.country, `${c.id} 没有 country 字段`);
    ok(known.has(c.country), `${c.id} 的 country "${c.country}" 不在 countries.json 里`);
  }
});

test('categories.json 可用且 id 唯一', () => {
  ok(categories.length > 0, '一个分类都没有');
  eq(new Set(categories.map((c) => c.id)).size, categories.length, '分类 id 有重复');
  for (const c of categories) {
    ok(/^#[0-9a-f]{6}$/i.test(c.color), `${c.id} 的 color "${c.color}" 不是 #rrggbb`);
    ok(c.emoji && c.label, `${c.id} 缺 emoji 或 label`);
  }
});

test('index.json 的城市 id 唯一、数据文件都存在', () => {
  const ids = index.cities.map((c) => c.id);
  eq(new Set(ids).size, ids.length, '城市 id 有重复');
  for (const c of index.cities) {
    ok(existsSync(DATA + 'cities/' + (c.file ?? c.id + '.json')), `${c.id} 的数据文件不存在`);
    ok(c.name && c.tagline, `${c.id} 缺 name 或 tagline`);
  }
});

test('cities/ 目录下没有游离于索引之外的城市文件', () => {
  const listed = new Set(index.cities.map((c) => c.file ?? c.id + '.json'));
  const onDisk = readdirSync(DATA + 'cities').filter((f) => f.endsWith('.json') && f !== 'index.json');
  for (const f of onDisk) ok(listed.has(f), `${f} 没有写进 index.json，首页看不到它`);
});

for (const entry of index.cities) {
  const city = normalizeCity(readJSON('cities/' + (entry.file ?? entry.id + '.json')));

  test(`${entry.name}：校验零 error`, () => {
    const problems = validateCity(city, categories);
    const fatal = errorsOf(problems);
    ok(fatal.length === 0, '\n' + formatProblems(fatal));
  });

  test(`${entry.name}：index 的 poiCount 与实际条数一致`, () => {
    // 冗余字段一定会漂移，所以必须有人盯着
    eq(city.pois.length, entry.poiCount, 'poiCount 对不上，改完数据记得同步 index.json');
  });

  test(`${entry.name}：每个点位都有一句话摘要`, () => {
    // summary 是面板和列表的主文案，缺了页面会空一块
    const missing = city.pois.filter((p) => !p.summary).map((p) => p.id);
    eq(missing, [], '这些点位缺 summary');
  });

  test(`${entry.name}：城市文件里声明的 datum 与索引中心点吻合`, () => {
    // index.json 的 center 也是 WGS-84，两边差太远说明有一边忘了转
    const d = Math.hypot(city.center.lng - entry.center.lng, city.center.lat - entry.center.lat);
    ok(d < 0.02, `城市文件与索引的 center 差了 ${d.toFixed(4)} 度，检查是不是有一边是 GCJ-02`);
  });
}
