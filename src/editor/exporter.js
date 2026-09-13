// 导出与导入：编辑器的最终产物是一份能直接覆盖 data/cities/<id>.json 的文本。
//
// 导入那一半同样重要：导出的 JSON 必须能原样粘回来接着编辑，否则这个编辑器就是
// 单向的——换台机器、或者草稿被清掉，之前录的东西就再也进不来了。

import { serializeCity } from './serialize.js';
import { compact } from './draft.js';
import { normalizeCity, validateCity, errorsOf } from '../data/schema.js';

/** 工作副本 → 可落盘的文本（剔掉软删除项和内部字段） */
export function cityToText(city) {
  return serializeCity(compact(city));
}

export function fileNameFor(city) {
  return `${city.id || 'city'}.json`;
}

/** 触发浏览器下载 */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // 立刻 revoke 在部分浏览器上会打断下载，等一拍再收
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 复制到剪贴板。navigator.clipboard 在非 https 或没有用户手势时会失败，
 * 所以准备了 execCommand 兜底——复制不上还不吭声，用户会以为复制成功了。
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 解析粘贴进来的 JSON。返回 { city, problems }：
 * city 为 null 表示根本读不出来，problems 里会说明原因。
 */
export function parseImported(text, categories = []) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { city: null, problems: [{ level: 'error', path: 'json', msg: `不是合法的 JSON：${err.message}` }] };
  }

  let city;
  try {
    city = normalizeCity(raw);
  } catch (err) {
    return { city: null, problems: [{ level: 'error', path: 'city', msg: err.message }] };
  }

  const problems = validateCity(city, categories);
  // 有 error 也把 city 交回去：编辑器正好是用来修这些问题的地方，
  // 拦着不让导入等于逼用户去手改 JSON
  return { city, problems, fatal: errorsOf(problems).length > 0 };
}
