// 扫描 data/cities/*.json，重新生成首页用的 index.json。
//
// index.json 是派生产物，不要手改：城市文件里已经有 name/country/cover/tagline/
// center/zoom 和点位总数，再让人手抄一遍到索引里，迟早会对不上——poiCount 尤其。
// 加一座城市的完整流程因此收敛成三步：
//
//   1. 写 configs/<id>.seed.csv
//   2. python3 scripts/geocode.py --city <id>
//   3. node scripts/update_index.mjs
//
// 缺 cover/tagline 这类展示字段时会明确提示补哪一个，而不是默默留空让首页难看。
//
// 用法: node scripts/update_index.mjs [--check]
//   --check 只比对不写入，CI 或提交前用它确认索引没过期。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeCity, normalizeCountries, validateCity, errorsOf, formatProblems } from '../src/data/schema.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const CITIES = `${DATA}cities/`;
const INDEX = `${CITIES}index.json`;
const checkOnly = process.argv.includes('--check');

const countries = normalizeCountries(JSON.parse(readFileSync(`${DATA}countries.json`, 'utf-8')));
const countryOrder = new Map(countries.map((c, i) => [c.id, c.order ?? i]));

const files = readdirSync(CITIES).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();

const entries = [];
const warnings = [];
let fatal = 0;

for (const file of files) {
  const city = normalizeCity(JSON.parse(readFileSync(CITIES + file, 'utf-8')));
  const problems = validateCity(city, []);
  const errors = errorsOf(problems);
  if (errors.length) {
    console.error(`✗ ${file}\n${formatProblems(errors)}`);
    fatal++;
    continue;
  }
  if (!countryOrder.has(city.country)) {
    warnings.push(`${file}: country "${city.country}" 不在 countries.json 里，首页会归到「其他」`);
  }
  for (const [key, label] of [['cover', '封面 emoji'], ['tagline', '一句话介绍']]) {
    if (!city[key]) warnings.push(`${file}: 缺 ${key}（${label}），首页卡片会空一块`);
  }

  entries.push({
    id: city.id,
    name: city.name,
    ...(city.nameEn ? { nameEn: city.nameEn } : {}),
    country: city.country,
    file,
    ...(city.cover ? { cover: city.cover } : {}),
    ...(city.region ? { region: city.region } : {}),
    ...(city.tagline ? { tagline: city.tagline } : {}),
    center: city.center,
    zoom: city.zoom,
    poiCount: city.pois.length,
    updated: city.updated,
  });
}

// 先按国家的 order，再按点位数从多到少——内容多的城市排前面
entries.sort((a, b) =>
  (countryOrder.get(a.country) ?? 999) - (countryOrder.get(b.country) ?? 999)
  || b.poiCount - a.poiCount
  || a.id.localeCompare(b.id));

const index = {
  schema: 1,
  note: '本文件由 scripts/update_index.mjs 从 data/cities/*.json 生成，不要手改。',
  updated: entries.map((e) => e.updated).filter(Boolean).sort().at(-1) ?? '',
  cities: entries,
};

const text = `${JSON.stringify(index, null, 2)}\n`;
const before = readFileSync(INDEX, 'utf-8');

for (const w of warnings) console.warn(`⚠ ${w}`);

if (checkOnly) {
  if (before !== text) {
    console.error('✗ index.json 与城市文件对不上了，跑一次 node scripts/update_index.mjs');
    process.exit(1);
  }
  console.log(`✓ index.json 是最新的（${entries.length} 座城市，${entries.reduce((n, e) => n + e.poiCount, 0)} 个点位）`);
} else {
  writeFileSync(INDEX, text, 'utf-8');
  console.log(`${before === text ? '索引无变化' : '已更新索引'}：${entries.length} 座城市，`
    + `${entries.reduce((n, e) => n + e.poiCount, 0)} 个点位`);
  for (const e of entries) console.log(`  ${e.country}  ${e.name.padEnd(6, '　')} ${String(e.poiCount).padStart(3)} 个点位`);
}

process.exit(fatal ? 1 : 0);
