// 用编辑器那套稳定序列化把城市 JSON 规范化一遍。
//
// 格式的唯一真相是 src/editor/serialize.js：geocode.py 生成的文件、手改过的文件、
// 编辑器导出的文件，都得长成同一个样子，否则每次在网页里导出一遍就会产生一个
// 纯格式的 diff，久了就没人愿意看这个 diff 了。
//
// 用法: node scripts/format_city.mjs data/cities/chengdu.json [...]

import { readFileSync, writeFileSync } from 'node:fs';
import { serializeCity } from '../src/editor/serialize.js';
import { compact } from '../src/editor/draft.js';
import { normalizeCity, validateCity, formatProblems, errorsOf } from '../src/data/schema.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node scripts/format_city.mjs data/cities/<city>.json');
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  const city = normalizeCity(raw);
  const problems = validateCity(city, []);
  const fatal = errorsOf(problems);

  const before = readFileSync(file, 'utf-8');
  const after = serializeCity(compact(city));
  writeFileSync(file, after, 'utf-8');

  const changed = before !== after;
  console.log(`${file}: ${city.pois.length} 个点位，${changed ? '已规范化' : '格式已经是规范的'}`);
  if (problems.length) console.log(formatProblems(problems));
  if (fatal.length) failed++;
}
process.exit(failed ? 1 : 0);
