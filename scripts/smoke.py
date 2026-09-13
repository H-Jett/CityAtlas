#!/usr/bin/env python3
"""端到端冒烟：用无头 chromium 真点一遍，断言 URL 和界面对得上。

单测能覆盖纯函数，截图能看出布局，但「点标记 → 面板出现 → URL 变了 → 按返回键
回到概览」这条链路两者都盖不住，而路由是最容易在重构中悄悄坏掉的地方。

用法:
    ~/.venvs/shot/bin/python scripts/smoke.py
    ~/.venvs/shot/bin/python scripts/smoke.py --headed --port 8766
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

log = logging.getLogger("smoke")
checks = {"pass": 0, "fail": 0}


def setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.INFO)
    for handler in (logging.StreamHandler(sys.stdout),
                    logging.FileHandler(LOG_DIR / "smoke.log", encoding="utf-8")):
        handler.setFormatter(fmt)
        log.addHandler(handler)


def check(name: str, cond, detail: str = "") -> None:
    if cond:
        checks["pass"] += 1
        log.info("  ✓ %s", name)
    else:
        checks["fail"] += 1
        log.error("  ✗ %s%s", name, f"  —— {detail}" if detail else "")


def serve(port: int):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *a, directory=str(ROOT), **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def visible_pins(page) -> int:
    return page.eval_on_selector_all(
        ".pin-wrap", "els => els.filter(e => !e.classList.contains('hidden')).length")


def run(page, base: str) -> None:
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 期望值从真实数据推导，别写死——数据一加点位就红的测试没人会留着
    import json
    index = json.loads((ROOT / "data/cities/index.json").read_text(encoding="utf-8"))
    total = index["cities"][0]["poiCount"]

    log.info("首页 → 城市页")
    page.goto(base, wait_until="load")
    page.wait_for_selector(".city-card")
    check("首页列出了城市卡片", page.locator(".city-card").count() >= 1)
    page.locator(".city-card").first.click()
    page.wait_for_selector(".pin-wrap")
    check("点卡片进到城市页，URL 带上 city", "city=chengdu" in page.url, page.url)
    check(f"{total} 个标记都画出来了", visible_pins(page) == total, f"实际 {visible_pins(page)}")
    check("筛选 chips 出来了", page.locator(".filters .chip").count() >= 2)

    log.info("点标记 → 详情面板")
    page.locator(".pin-wrap").first.click()
    page.wait_for_selector(".poi-head h3")
    title = page.locator(".poi-head h3").inner_text()
    check("面板显示了点位标题", bool(title), title)
    check("URL 带上 poi", "poi=" in page.url, page.url)
    check("选中的标记有 active 态", page.locator(".pin-wrap.active").count() == 1)

    log.info("浏览器返回键")
    page.go_back()
    page.wait_for_selector(".overview")
    check("返回后回到城市概览", "poi=" not in page.url, page.url)
    check("没有标记还停在 active 态", page.locator(".pin-wrap.active").count() == 0)

    log.info("分类筛选")
    chip = page.locator(".filters .chip:not(.all)").first
    want = int(chip.locator(".n").inner_text())  # chip 上的计数就是期望的可见标记数
    chip.click()
    page.wait_for_timeout(300)
    check(f"点一个分类 chip 后只剩这一类（{want} 个）", visible_pins(page) == want, f"实际 {visible_pins(page)}")
    check("筛选写进了 URL", "cat=" in page.url, page.url)
    page.locator(".filters .chip.all").click()
    page.wait_for_timeout(300)
    check("点「全部」恢复所有标记", visible_pins(page) == total, f"实际 {visible_pins(page)}")
    check("恢复全部后 URL 里不留 cat", "cat=" not in page.url, page.url)

    log.info("搜索")
    # 挑一个全城只出现一次的词。「茶」「盖碗」这类在别的点位正文里也有，
    # 搜出多条是搜索功能对的表现，不是 bug——别拿它当断言
    page.fill("#poi-search", "音叉")
    page.wait_for_timeout(400)
    check("搜索缩小到命中的点位", visible_pins(page) == 1, f"实际 {visible_pins(page)}")
    page.fill("#poi-search", "")
    page.wait_for_timeout(400)
    check("清空搜索后全部回来", visible_pins(page) == total, f"实际 {visible_pins(page)}")

    log.info("深链直接进入")
    page.goto(base + "?city=chengdu&poi=cd-cafe-001&base=osm", wait_until="load")
    page.wait_for_selector(".poi-head h3")
    check("深链直接选中了点位", "鹤鸣" in page.locator(".poi-head h3").inner_text())
    check("深链指定的底图生效",
          page.locator('#basemap-switch button[aria-pressed="true"]').inner_text() == "OSM")

    log.info("不存在的点位 id 要降级而不是白屏")
    page.goto(base + "?city=chengdu&poi=不存在", wait_until="load")
    page.wait_for_selector(".overview")
    check("降级回城市概览并清掉 poi 参数", "poi=" not in page.url, page.url)

    check("整个过程没有 console 错误", not errors, "; ".join(errors[:3]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--headed", action="store_true", help="开着浏览器跑，方便肉眼看")
    args = parser.parse_args()

    setup_logging()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("没装 playwright，见 scripts/screenshot.py 开头的依赖说明")
        return 2

    httpd = serve(args.port)
    base = f"http://127.0.0.1:{args.port}/"
    log.info("静态服务器 %s", base)

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not args.headed)
            ctx = browser.new_context(locale="zh-CN", viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            run(page, base)
            ctx.close()
            browser.close()
    finally:
        httpd.shutdown()

    total = checks["pass"] + checks["fail"]
    if checks["fail"]:
        log.error("冒烟失败：%d/%d 通过，%d 条不符", checks["pass"], total, checks["fail"])
        return 1
    log.info("冒烟全绿：%d/%d", checks["pass"], total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
