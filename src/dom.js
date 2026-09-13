// 建 DOM 和转义的公共小工具。没有引入模板引擎：这个站的动态片段就那么几处，
// 手写 h() 比多一层依赖划算，而且强制每处 innerHTML 都显式想一下要不要转义。

/** HTML 转义。凡是把数据拼进 innerHTML 的地方都必须过它 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 建元素。h('div.card', {onclick}, '文本', childEl)
 * 标签里可以直接带 .class（多个用 . 连接），省掉大量 className 赋值。
 */
export function h(spec, attrs = null, ...children) {
  const [tag, ...classes] = String(spec).split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');

  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      el.className = [el.className, value].filter(Boolean).join(' ');
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key in el && key !== 'list' && typeof value !== 'object') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }

  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 清空并填充 */
export function fill(parent, ...children) {
  parent.replaceChildren(...children.flat(3).filter((c) => c !== null && c !== undefined && c !== false));
  return parent;
}

let toastTimer = 0;

/**
 * 一闪而过的提示。
 * 约定：任何被 catch 住的失败都要走它出声，不许静默吞掉——尤其是 localStorage
 * 写失败（隐私模式、配额满），那种情况用户以为草稿存住了，其实一个字没存。
 */
export function toast(message, kind = '', ms = 2600) {
  const el = qs('#toast');
  if (!el) return;
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** 防抖，用于搜索输入和草稿自动保存 */
export function debounce(fn, ms = 300) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** 把 Error 渲染成页面上的一块错误提示，而不是只留在控制台 */
export function errorBlock(title, err) {
  return h('div.empty', null,
    h('div.big', null, '😵'),
    h('p', null, title),
    h('pre.err-detail', null, String(err?.message ?? err)));
}
