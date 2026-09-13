// 零依赖的极简测试骨架：不装 jest/vitest，node 直接跑 tests/*.mjs。
// 计数是模块级单例，所以 tests/all.mjs 把几个测试文件 import 进来时，
// 总结是合并统计的；单跑某个文件也会在退出时打印它自己的总结。

let pass = 0;
let fail = 0;
let currentFile = '';

process.on('exit', () => {
  const total = pass + fail;
  console.log(
    `\n${fail ? '✗ 失败' : '✓ 全绿'}  ${pass}/${total} 通过` + (fail ? `，${fail} 个失败` : '')
  );
});

/** 分组标题，通常每个测试文件开头调一次 */
export function suite(name) {
  currentFile = name;
  console.log(`\n${name}`);
}

export function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    process.exitCode = 1;
    console.error(`  ✗ ${name}${currentFile ? ` (${currentFile})` : ''}`);
    console.error(`      ${String(err.message).split('\n').join('\n      ')}`);
  }
}

export function ok(cond, msg = '期望为真') {
  if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n期望 ${b}\n实际 ${a}`.trim());
}

/** 浮点/距离比较 */
export function near(actual, expected, tol, msg = '') {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${msg}\n期望 ${expected} ± ${tol}，实际 ${actual}`.trim());
  }
}

/** 断言落在区间内（量级检查比精确值更能守住"算法对不对"） */
export function between(actual, lo, hi, msg = '') {
  if (!(actual >= lo && actual <= hi)) {
    throw new Error(`${msg}\n期望落在 [${lo}, ${hi}]，实际 ${actual}`.trim());
  }
}

export function throws(fn, msg = '期望抛错但没有') {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(msg);
}
