// 跑全部测试：node tests/all.mjs（或 npm test）
// harness 的计数是模块单例，所以这里 import 进来的各文件会合并成一份总结。

import './crs.test.mjs';
import './schema.test.mjs';
import './filter.test.mjs';
import './url.test.mjs';
import './data.test.mjs';
