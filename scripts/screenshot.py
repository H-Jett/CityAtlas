#!/usr/bin/env python3
"""用无头 chromium 实际渲染页面并截图，验证两种视口下的布局。

纯静态站没有测试框架能验证 CSS 和地图渲染 —— 瓦片有没有加载出来、标记落在哪、
面板有没有挡住地图，只有真渲染一遍才知道。脚本同时把页面里的 console.error 和
未捕获异常打出来，那类错误光看截图是发现不了的。

依赖（本机开发工具，不属于本项目）:
    python3 -m venv ~/.venvs/shot
    ~/.venvs/shot/bin/pip install playwright
    PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright ~/.venvs/shot/bin/playwright install chromium

容器里第一次跑之前记得装中文字体，否则截出来全是方块:
    apt-get install -y fonts-wqy-microhei fonts-noto-color-emoji && fc-cache -f

用法:
    ~/.venvs/shot/bin/python scripts/screenshot.py                 # 默认 logs/shots
    ~/.venvs/shot/bin/python scripts/screenshot.py --only city-desktop --keep-console
"""

import argparse
import http.server
import logging
import socketserver
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "logs"

VIEWPORTS = {
    "mobile": dict(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                   is_mobile=True, has_touch=True),
    "desktop": dict(viewport={"width": 1440, "height": 900}, device_scale_factor=1,
                    is_mobile=False, has_touch=False),
}

# 每个场景：名字 → (URL query, 进入后要做的事)
SCENES = [
    ("home", "", None),
    ("city", "?city=chengdu", None),
    ("city-poi", "?city=chengdu&poi=cd-sight-001", None),
    # 同一个点位分别在高德和 OSM 底图下截一张，人工比对标记有没有偏移。
    # 这是坐标系那套换算唯一靠谱的验收方式
    ("city-osm", "?city=chengdu&base=osm", None),
    # 境外城市：底图应该自动是 OSM，且底图切换里不该出现高德
    ("abroad", "?city=seoul", None),
    ("abroad-poi", "?city=seoul&poi=kr-seoul-sight-001", None),
]

log = logging.getLogger("shot")


def setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.INFO)
    for handler in (logging.StreamHandler(sys.stdout),
                    logging.FileHandler(LOG_DIR / "screenshot.log", encoding="utf-8")):
        handler.setFormatter(fmt)
        log.addHandler(handler)


def serve(port: int):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *a, directory=str(ROOT), **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def run_kind(pw, kind: str, base: str, out: Path, only: str | None, wait_ms: int) -> int:
    """跑一种视口下的所有场景，返回捕获到的页面错误数"""
    errors = 0
    browser = pw.chromium.launch()
    ctx = browser.new_context(locale="zh-CN", **VIEWPORTS[kind])
    page = ctx.new_page()

    def on_console(msg):
        nonlocal errors
        if msg.type == "error":
            errors += 1
            log.error("    [console.error] %s", msg.text)

    def on_pageerror(exc):
        nonlocal errors
        errors += 1
        log.error("    [pageerror] %s", exc)

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)

    for name, query, after in SCENES:
        tag = f"{name}-{kind}"
        if only and only not in (name, tag, kind):
            continue
        log.info("  %s  %s", tag, query or "/")
        page.goto(base + query, wait_until="load")
        # 地图瓦片是异步拉的，networkidle 之后再多等一会儿让它画完
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            log.warning("    networkidle 超时（瓦片还在拉？），照样截图")
        if after:
            after(page)
        page.wait_for_timeout(wait_ms)
        path = out / f"{tag}.png"
        page.screenshot(path=str(path))
        log.info("    → %s (%d KB)", path.relative_to(ROOT), path.stat().st_size // 1024)

    ctx.close()
    browser.close()
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(LOG_DIR / "shots"), help="截图输出目录")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--only", help="只跑某个场景或某种视口（如 city / city-desktop / mobile）")
    parser.add_argument("--wait", type=int, default=1200, help="截图前额外等待毫秒数（等瓦片）")
    args = parser.parse_args()

    setup_logging()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("没装 playwright，见本文件开头的依赖说明")
        return 2

    httpd = serve(args.port)
    base = f"http://127.0.0.1:{args.port}/"
    log.info("静态服务器 %s，截图输出 %s", base, out)

    errors = 0
    try:
        with sync_playwright() as pw:
            for kind in VIEWPORTS:
                if args.only and args.only not in VIEWPORTS and not args.only.endswith(kind) \
                        and args.only not in [s[0] for s in SCENES]:
                    continue
                log.info("[%s]", kind)
                errors += run_kind(pw, kind, base, out, args.only, args.wait)
    finally:
        httpd.shutdown()

    if errors:
        log.error("完成，但页面里有 %d 条错误 —— 截图看着正常也不算通过", errors)
        return 1
    log.info("完成，页面无 console 错误")
    return 0


if __name__ == "__main__":
    sys.exit(main())
