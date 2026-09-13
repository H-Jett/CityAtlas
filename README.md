# 城市旅游攻略图鉴 CityAtlas

一座城市一张地图，美食、景点、茶馆、夜景都钉在它该在的位置上。点一下标记，右边就是这个地方值得去的理由。

纯静态站：没有后端、没有构建步骤、不需要任何 API key。

现在收录：🇨🇳 成都 · 🇰🇷 首尔 / 釜山 / 济州岛，共 78 个点位。

## 玩法

- 首页是城市列表，按国家分组，两个以上国家时顶部出现国家筛选。
- 点进城市就是这座城市的地图。
- 地图上的彩色水滴标记按分类着色：🍜 美食 / 🏯 景点 / 🏛️ 博物馆 / 🌳 公园 / ☕ 咖啡茶馆 / 🌃 夜景酒吧 / 🛍️ 逛街购物 / 🛏️ 住宿 / 🚇 交通。
- 顶部 chips 可以多选筛选，搜索框搜点位名、标签和正文。
- 点击标记，右侧（手机上是底部抽屉，可上下拖）展示详情：一句话、推荐理由、详细介绍、人均、建议时长、什么时候去，以及走几步就到的邻近点位。
- 底图可切换。中国大陆的城市有「高德 / OSM / 简洁 / 卫星」四种，境外城市只给全球源（高德在境外返回的是空白瓦片，所以直接不列出来）。
- 当前城市、选中的点位、筛选条件都写在 URL 里，复制链接发给别人，打开就是同一个画面。

## 本地跑

```sh
python3 -m http.server 8080     # 打开 http://127.0.0.1:8080/
node tests/all.mjs              # 单测（零依赖）
```

端到端冒烟和截图需要 playwright（属于开发机工具，不在本仓库依赖里）：

```sh
python3 -m venv ~/.venvs/shot && ~/.venvs/shot/bin/pip install playwright
PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright ~/.venvs/shot/bin/playwright install chromium
~/.venvs/shot/bin/python scripts/smoke.py        # 真点一遍，断言 URL 与界面对得上
~/.venvs/shot/bin/python scripts/screenshot.py   # mobile/desktop 两种视口截图到 logs/shots
```

容器或干净的 Linux 上第一次跑截图，记得先装中文字体，否则截出来全是方块：

```sh
apt-get install -y fonts-wqy-microhei fonts-noto-color-emoji && fc-cache -f
```

## 加一座新城市

**前端没有任何城市 id、国家 id 或分类 id 的硬编码，加城市 = 加数据。** 索引、分类统计、国家分组、底图可选项全部从数据推导。

### 三步

```sh
# 1. 照着 configs/chengdu.seed.csv 写一份点位清单
vim configs/kyoto.seed.csv

# 2. 查坐标，生成 data/cities/kyoto.json
python3 scripts/geocode.py --city kyoto

# 3. 重建首页索引
node scripts/update_index.mjs && node tests/all.mjs
```

就这样。`index.json` 是派生产物，**不要手改** —— 它由第 3 步从各城市文件重新生成。

### seed CSV 怎么写

第一行是 `id=__city__` 的城市元信息行：

| 列 | 说明 |
|---|---|
| `name` / `nameEn` | 城市名 |
| `country` | 国家 id，要在 `data/countries.json` 里 |
| `lng` / `lat` / `zoom` | 默认视野。挑一个最能代表这座城市的中心和缩放 |
| `cover` | 首页卡片的封面 emoji |
| `tagline` | 首页卡片那句话 |
| `region` | 省 / 道 / 州 |
| `basemap` | 可选，指定默认底图。境外城市写 `osm` |
| `summary` | 写进城市文件的 `notes`，显示在概览面板底部 |

后面每行一个点位：`id`、`name`、`category`（要在 `data/categories.json` 里）必填；`query` 是给地图搜索用的词，留空就用「名称 + 城市名」；其余 `summary` / `why` / `desc` / `tags` / `price` / `duration` / `bestTime` / `address` 全部可选，**缺了就整块不显示**，不用补空字符串。

### 关于地理编码

`geocode.py` 用 OpenStreetMap Nominatim 查坐标，直接返回 WGS-84。几条实测经验：

- **查询词用当地语言命中率最高。** 韩国地点写韩文比写中文稳（`경복궁` > `景福宫 首尔`）。
- **街区名常常查不到。** OSM 里没有「전포카페거리」这种商圈概念，改用地标（`전포동`）。
- **同名地点要靠距离筛。** `용두암` 单查会匹配到浦项市的同名岩石，加上城市名才对。脚本会按离城市中心的距离过滤，跨度大的地方（济州岛东西 70 公里）要调 `--max-km`。
- **匹配到的地物类型会被检查。** 同一个名字在 OSM 里常常既是景点又是公交站，站点在景区门口甚至街对面，脚本优先挑真正的地物并把可疑的列出来复核。
- 查不到的点位不会被静默丢掉，而是坐标留空、在报告里点名，用编辑模式在地图上点一下补齐。

### 加一个国家 / 一个分类

- 国家：往 `data/countries.json` 加一项（`id` / `name` / `flag` / `order`，境外建议加 `defaultBasemap: "osm"`）。
- 分类：往 `data/categories.json` 加一项（`id` / `label` / `emoji` / `color` / `order`）。数据里用了但表里没有的分类不会崩，会降级成灰色兜底样式并在控制台提示。

### 只想补几个点或校正坐标

打开 `?city=<城市 id>&edit=1`，在地图上点着加，改完导出 JSON 覆盖原文件，再跑一次 `node scripts/update_index.mjs`。

## 编辑模式

地址栏加 `&edit=1`，或者点顶栏的 ✏️。

- **加点位**：在地图上点一下，就在那里新建一个，接着填表单。
- **改位置**：直接拖动标记，或用表单里的「🎯 在地图上点选」。
- **粘外部坐标**：表单里可以粘从别处复制来的坐标，选好它是哪种基准（WGS-84 / GCJ-02 高德腾讯 / BD-09 百度），会自动换算。经纬顺序写反了也能自动认出来。
- **删除**：是软删除，列表里划线保留，点一下就回来，导出时才真剔除。
- **撤销**：`Ctrl/Cmd + Z`。
- **导出**：`Ctrl/Cmd + S` 或点「导出」。对话框会先列出这次到底动了什么（新增/修改/移动/删除各几条），然后给下载和复制两个出口。把内容存成 `data/cities/<城市 id>.json` 覆盖原文件，commit 即可。
- **草稿**：改动每半秒自动存进浏览器的 localStorage，关掉页面再回来会问你要不要接着改。如果在这期间仓库里的数据变过了（别人提交了，或你在另一台机器改过），会弹警告让你自己选，不会默默覆盖。
- 导出的 JSON 可以从「从 JSON 导入」原样粘回来接着编辑，换台机器也能继续。

⚠️ 草稿只存在当前浏览器里。清缓存、换设备、无痕模式都会让它消失，录完记得导出。localStorage 写不进去时页面会明确提示。

## 坐标系说明

这是本项目最容易出错的地方，专门说一下。

- **数据一律存 WGS-84**（GPS 和 GeoJSON 的基准），城市 JSON 的 `datum` 字段写明这一点。
- **高德系的瓦片是 GCJ-02**（俗称火星坐标，在 WGS-84 上叠了一层保密偏移），**OSM 是 WGS-84**。同一个经纬度画在两种底图上能差出 500 米。
- 所以画标记之前过 `toDisplay()`，从地图上取坐标之后过 `fromDisplay()`（都在 `src/geo/crs.js`）。业务代码只用这两个函数，不直接调底层转换——漏转和多转的症状一模一样，都是点位偏移，只能靠单一出口和纪律避免。
- 切底图时三件事缺一不可：换瓦片、按新基准重算地图中心、把所有标记逐个换算。只做第一件是最常见的半截 bug。
- `GCJ-02 → WGS-84` 用迭代反解，不是「正转一遍取差值反减」——后者往返不一致，反复切底图点位会一次次地走。
- 验收办法：同一个点位分别在高德和 OSM 底图下截图，看标记是不是压在同一栋建筑上。`tests/crs.test.mjs` 里还有三条守卫用例：往返误差、境内偏移量级、以及「转两次必须明显偏离转一次」。

如果你发现某个点位在一种底图上准、另一种上偏了几百米，那不是数据错了，是转换环节漏了一处。

## 数据从哪来

- 坐标来自 [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/)，直接返回 WGS-84。
- 文案是人写的。营业时间、人均、票价这类信息会变，只写了相对稳定的部分，**出门前请再确认**。
- 分类定义在 `data/categories.json`，加一类只改这个文件，前端不用动。

## 目录

```
src/
  app.js            入口：URL 是唯一真相，所有交互走 go(patch, mode)
  url.js            query string ⇄ 状态（纯函数）
  dom.js            建 DOM、转义、toast、模态框
  geo/crs.js        WGS-84 ⇄ GCJ-02 ⇄ BD-09，全项目坐标换算的唯一出口
  map/              底图注册表 / Leaflet 生命周期 / divIcon 彩色标记
  ui/               首页 / 筛选 / 详情面板（窄屏是底部抽屉）
  editor/           编辑总控 / 表单 / 草稿 / 稳定序列化 / 导出导入
  vendor/leaflet/   Leaflet 1.9.4，本地 vendor 不挂 CDN
data/cities/        每座城市一个 JSON（自包含）+ index.json（派生，勿手改）
data/countries.json 国家定义；data/categories.json 分类定义
configs/            点位清单 CSV（录入管线的输入，不是运行时资源）
scripts/            vendor_leaflet / geocode / update_index / format_city / screenshot / smoke
tests/              零依赖单测，node 直接跑
```

## 瓦片来源与版权

本站是个人非商业用途的地图图鉴，四个底图源都免 API key，署名都保留在页面右下角。

| 源 | 覆盖 | 基准 | 说明 |
|---|---|---|---|
| 高德 | 仅中国大陆 | GCJ-02 | 中文路网。公开栅格接口，没有官方可用性承诺，随时可能限流或变更 |
| OpenStreetMap | 全球 | WGS-84 | 遵守其 [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)，数据 © OSM 贡献者，ODbL 授权 |
| Carto Voyager | 全球 | WGS-84 | 浅色底图，© [CARTO](https://carto.com/attributions) |
| Esri World Imagery | 全球 | WGS-84 | 卫星影像，Tiles © Esri / Maxar / Earthstar Geographics |

高德的海外数据基本是空的（首尔的瓦片只有 179 字节，成都同级别是 5KB），而且它返回
200 而不是错误，自动回退那条路走不通，所以境外城市干脆不列这个源。

页面在连续拉不到瓦片时会自动切到另一个源并提示，只切一次。

**Leaflet** 1.9.4，BSD-2-Clause，许可证随代码放在 `src/vendor/leaflet/LEAFLET-LICENSE.txt`。

代码本身按 MIT 授权，见 `LICENSE`。
