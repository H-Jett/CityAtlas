#!/usr/bin/env python3
"""把 Leaflet 的发行文件下载到 src/vendor/leaflet/，并记录版本与 sha256。

本项目不挂 CDN：一是国内 CDN 抽风时整站地图直接白屏，二是 GitHub Pages 上
第三方脚本的可用性不受我们控制。代价是升级要重跑一次这个脚本。

用法:
    python3 scripts/vendor_leaflet.py                 # 装 DEFAULT_VERSION
    python3 scripts/vendor_leaflet.py --version 1.9.4
    python3 scripts/vendor_leaflet.py --check         # 只校验现有文件的 sha256，不下载
"""

import argparse
import hashlib
import json
import logging
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "src" / "vendor" / "leaflet"
LOG_DIR = ROOT / "logs"

DEFAULT_VERSION = "1.9.4"
CDN = "https://unpkg.com/leaflet@{version}/dist/{name}"
LICENSE_URL = "https://unpkg.com/leaflet@{version}/LICENSE"

# ESM 产物让我们能在 src/ 里直接 import，不用挂全局 L。
# images/ 这 5 个小 PNG 本项目其实用不到（标记是 divIcon 画的），
# 但 leaflet.css 里硬编码了它们的路径，不放就会有人随手用了默认图标然后 404。
FILES = [
    "leaflet-src.esm.js",
    "leaflet.css",
    "images/layers.png",
    "images/layers-2x.png",
    "images/marker-icon.png",
    "images/marker-icon-2x.png",
    "images/marker-shadow.png",
]

log = logging.getLogger("vendor")


def setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.INFO)
    for handler in (logging.StreamHandler(sys.stdout),
                    logging.FileHandler(LOG_DIR / "vendor_leaflet.log", encoding="utf-8")):
        handler.setFormatter(fmt)
        log.addHandler(handler)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, retries: int = 3) -> bytes:
    """下载单个文件，失败退避重试。"""
    for attempt in range(1, retries + 1):
        started = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CityAtlas-vendor/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
            cost = time.monotonic() - started
            log.info("  ↓ %-28s %7.1f KB  %.2fs", url.rsplit("/", 1)[-1], len(body) / 1024, cost)
            return body
        except (urllib.error.URLError, TimeoutError) as exc:
            log.warning("  第 %d/%d 次下载失败: %s (%s)", attempt, retries, url, exc)
            if attempt == retries:
                raise
            time.sleep(2 * attempt)
    raise RuntimeError("unreachable")


def check(manifest_path: Path) -> int:
    """校验本地文件与 VERSION.json 记录是否一致，返回不一致的个数。"""
    if not manifest_path.exists():
        log.error("没有 %s，先跑一次不带 --check 的下载", manifest_path.relative_to(ROOT))
        return 1
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bad = 0
    for name, want in manifest["files"].items():
        path = VENDOR / name
        if not path.exists():
            log.error("  缺失 %s", name)
            bad += 1
            continue
        got = sha256(path.read_bytes())
        if got != want:
            log.error("  校验不符 %s\n    期望 %s\n    实际 %s", name, want, got)
            bad += 1
        else:
            log.info("  ✓ %s", name)
    log.info("校验完成：leaflet %s，%d 个文件，%d 个异常",
             manifest["version"], len(manifest["files"]), bad)
    return bad


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", default=DEFAULT_VERSION, help="Leaflet 版本号")
    parser.add_argument("--check", action="store_true", help="只校验本地文件，不下载")
    args = parser.parse_args()

    setup_logging()
    manifest_path = VENDOR / "VERSION.json"

    if args.check:
        return 1 if check(manifest_path) else 0

    log.info("开始 vendor leaflet %s → %s", args.version, VENDOR.relative_to(ROOT))
    VENDOR.mkdir(parents=True, exist_ok=True)
    (VENDOR / "images").mkdir(exist_ok=True)

    digests: dict[str, str] = {}
    for i, name in enumerate(FILES, 1):
        log.info("[%d/%d] %s", i, len(FILES) + 1, name)
        body = fetch(CDN.format(version=args.version, name=name))
        (VENDOR / name).write_bytes(body)
        digests[name] = sha256(body)

    log.info("[%d/%d] LICENSE", len(FILES) + 1, len(FILES) + 1)
    body = fetch(LICENSE_URL.format(version=args.version))
    (VENDOR / "LEAFLET-LICENSE.txt").write_bytes(body)
    digests["LEAFLET-LICENSE.txt"] = sha256(body)

    manifest_path.write_text(json.dumps({
        "library": "leaflet",
        "version": args.version,
        "source": CDN.format(version=args.version, name=""),
        "fetched": time.strftime("%Y-%m-%d"),
        "files": digests,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    total = sum((VENDOR / n).stat().st_size for n in FILES) / 1024
    log.info("完成：%d 个文件 + LICENSE，合计 %.0f KB，清单写入 %s",
             len(FILES), total, manifest_path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
