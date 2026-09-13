#!/usr/bin/env python3
"""把 configs/<city>.seed.csv 里的点位查出坐标，生成 data/cities/<city>.json。

为什么要有这个脚本：凭印象写经纬度一定会错。第一版的宽窄巷子就被我写到了景区
东北 600 米外，肉眼看地图才发现。这里改用 OpenStreetMap Nominatim 查询——它直接
返回 WGS-84，正好是本项目的存储基准，省掉一次"我记的是哪个基准的坐标"的猜测。

Nominatim 是志愿者运营的免费服务，使用政策要求：带可识别的 User-Agent、串行请求、
每秒不超过一次。所以这个脚本故意跑得很慢，也会把结果缓存下来避免重复打扰。

查不到或者匹配可疑的点位不会被静默丢掉，而是在报告里单独列出来，坐标留空，由人
用网页里的编辑模式在地图上点一下补齐。

用法:
    python3 scripts/geocode.py --city chengdu
    python3 scripts/geocode.py --city chengdu --no-cache --out data/cities
"""

import argparse
import csv
import json
import logging
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "logs"
CACHE = Path("/tmp/cityatlas-geocode")  # 小文件，放系统临时目录就行

NOMINATIM = "https://nominatim.openstreetmap.org/search"
UA = "CityAtlas/0.1 (personal travel map; https://github.com/H-Jett/CityAtlas)"
MIN_INTERVAL = 1.2  # 秒，遵守 Nominatim 的使用政策

log = logging.getLogger("geocode")
_last_request = 0.0


def setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.INFO)
    for handler in (logging.StreamHandler(sys.stdout),
                    logging.FileHandler(LOG_DIR / "geocode.log", encoding="utf-8")):
        handler.setFormatter(fmt)
        log.addHandler(handler)


def haversine(a, b) -> float:
    """两点球面距离，米"""
    r = 6371008.8
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = p2 - p1
    dl = math.radians(b["lng"] - a["lng"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def query_nominatim(text: str, country: str = "cn", use_cache: bool = True) -> list[dict]:
    global _last_request
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / f"{country}-{urllib.parse.quote(text, safe='')}.json"
    if use_cache and cache_file.exists():
        log.info("      （命中缓存）")
        return json.loads(cache_file.read_text(encoding="utf-8"))

    wait = MIN_INTERVAL - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)

    url = f"{NOMINATIM}?{urllib.parse.urlencode({
        'q': text, 'format': 'json', 'limit': 5,
        'countrycodes': country,
        # 要中文名，拿不到中文再退回本地语言和英文
        'accept-language': 'zh-CN,zh,en',
    })}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        log.warning("      查询失败: %s", exc)
        data = []
    _last_request = time.monotonic()
    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


# 地物类型的优先级。同一个名字在 OSM 里常常既是景点又是公交站/地铁站，
# 而站点通常在景区门口甚至街对面——宽窄巷子第一版就匹配到了公交站，偏了 300 米。
PLACE_CLASSES = {"tourism", "historic", "leisure", "amenity", "shop", "landuse",
                 "place", "natural", "building", "man_made", "waterway"}
TRANSIT_CLASSES = {"railway", "aeroway", "highway", "public_transport", "amenity"}


def pick_best(results: list[dict], center: dict, max_km: float,
              category: str = "") -> tuple[dict | None, str]:
    """从候选里挑一个：先看落没落在城市附近，再看地物类型对不对，最后才比距离"""
    prefer = TRANSIT_CLASSES if category == "transit" else PLACE_CLASSES
    scored = []
    for r in results:
        coord = {"lng": float(r["lon"]), "lat": float(r["lat"])}
        km = haversine(center, coord) / 1000
        if km > max_km:
            continue
        rank = 0 if r.get("class") in prefer else 1
        scored.append((rank, km, coord, r))
    if not scored:
        return None, "候选都不在城市范围内" if results else "一条结果都没有"
    scored.sort(key=lambda x: (x[0], x[1]))
    rank, km, coord, r = scored[0]
    return {"coord": coord, "km": km, "display": r.get("display_name", ""),
            "type": r.get("type", ""), "class": r.get("class", ""),
            "fallback_class": rank == 1}, ""


def split_tags(text: str) -> list[str]:
    return [t.strip() for t in (text or "").replace("，", ",").split(",") if t.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--city", required=True, help="城市 id，对应 configs/<city>.seed.csv")
    parser.add_argument("--out", default=str(ROOT / "data" / "cities"), help="输出目录")
    parser.add_argument("--no-cache", action="store_true", help="忽略本地缓存重新查")
    parser.add_argument("--max-km", type=float, default=60.0,
                        help="离城市中心多远算跑偏。济州岛这种跨度大的地方要调大")
    args = parser.parse_args()

    setup_logging()
    seed_path = ROOT / "configs" / f"{args.city}.seed.csv"
    if not seed_path.exists():
        log.error("找不到 %s", seed_path.relative_to(ROOT))
        return 2

    rows = list(csv.DictReader(seed_path.open(encoding="utf-8")))
    meta = {k: v for k, v in (rows[0] or {}).items()} if rows else {}
    # 第一行如果 id 是 __city__ 就是城市元信息行
    city_meta = None
    if rows and rows[0].get("id") == "__city__":
        city_meta = rows.pop(0)

    if not city_meta:
        log.error("seed 文件第一行必须是 id=__city__ 的城市元信息行")
        return 2

    center = {"lng": float(city_meta["lng"]), "lat": float(city_meta["lat"])}
    country = (city_meta.get("country") or "cn").strip().lower()
    log.info("城市 %s（%s，%s），中心 %.6f,%.6f，共 %d 个待查点位",
             args.city, city_meta["name"], country.upper(), center["lng"], center["lat"], len(rows))
    log.info("数据源 Nominatim，串行 + 每次间隔 %.1fs（遵守使用政策），预计耗时约 %.0f 秒",
             MIN_INTERVAL, len(rows) * MIN_INTERVAL)

    pois = []
    missing = []
    suspicious = []
    started = time.monotonic()

    for i, row in enumerate(rows, 1):
        name = row["name"].strip()
        # query 列留空就用「名称 + 城市名」；韩国地点建议直接写韩文，命中率最高
        query = (row.get("query") or "").strip() or f'{name} {city_meta["name"]}'
        elapsed = time.monotonic() - started
        eta = (elapsed / i * (len(rows) - i)) if i > 1 else len(rows) * MIN_INTERVAL
        log.info("[%d/%d %.0f%%] %s  ←  「%s」  (已用 %.0fs, 剩约 %.0fs)",
                 i, len(rows), i / len(rows) * 100, name, query, elapsed, eta)

        results = query_nominatim(query, country, use_cache=not args.no_cache)
        best, why = pick_best(results, center, args.max_km, row["category"].strip())

        poi = {
            "id": row["id"].strip(),
            "name": name,
            "category": row["category"].strip(),
            "coord": None,
        }
        for key in ("summary", "desc", "why", "price", "hours", "duration", "bestTime", "address"):
            value = (row.get(key) or "").strip()
            if value:
                poi[key] = value
        tags = split_tags(row.get("tags", ""))
        if tags:
            poi["tags"] = tags

        if best:
            poi["coord"] = {"lng": round(best["coord"]["lng"], 6),
                            "lat": round(best["coord"]["lat"], 6)}
            log.info("      ✓ %.6f,%.6f  距中心 %.1f km  [%s/%s]  %s",
                     poi["coord"]["lng"], poi["coord"]["lat"], best["km"],
                     best["class"], best["type"], best["display"][:50])
            # 匹配到的地物类型和我们想要的对不上时提醒一声，但不拦
            if best["km"] > args.max_km * 0.5:
                suspicious.append((name, f'离中心 {best["km"]:.1f} km，确认一下是不是同名的别处'))
            if best["fallback_class"]:
                suspicious.append((name, f'只匹配到 {best["class"]}/{best["type"]}（多半是门口的站点而不是地点本身）'))
        else:
            log.warning("      ✗ 没查到：%s", why)
            missing.append((name, query, why))

        pois.append(poi)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.city}.json"
    city = {
        "schema": 1,
        "id": args.city,
        "name": city_meta["name"],
        **{k: city_meta[k].strip() for k in ("nameEn", "region", "cover", "tagline")
           if (city_meta.get(k) or "").strip()},
        "country": country,
        "datum": "wgs84",
        "center": center,
        "zoom": int(city_meta.get("zoom") or 12),
        **({"basemap": city_meta["basemap"].strip()} if (city_meta.get("basemap") or "").strip() else {}),
        "updated": time.strftime("%Y-%m-%d"),
        "notes": city_meta.get("summary") or "",
        "pois": pois,
    }
    out_path.write_text(json.dumps(city, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    log.info("─" * 60)
    log.info("写入 %s：%d 个点位，其中 %d 个缺坐标",
             out_path.relative_to(ROOT), len(pois), len(missing))
    if missing:
        log.warning("这些点位没查到坐标，需要在网页的编辑模式里手动点一下补上：")
        for name, query, why in missing:
            log.warning("  · %s（查询词「%s」）：%s", name, query, why)
    if suspicious:
        log.warning("这些点位查到了但值得复核：")
        for name, why in suspicious:
            log.warning("  · %s：%s", name, why)
    log.info("耗时 %.0f 秒", time.monotonic() - started)
    return 0


if __name__ == "__main__":
    sys.exit(main())
