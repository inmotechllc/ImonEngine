from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from pathlib import Path

from chrome_cdp import CdpPage, detect_mcp_chrome_port, find_tab, http_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--to", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body-file")
    parser.add_argument("--body")
    parser.add_argument("--port", type=int)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    body = args.body
    if args.body_file:
        body = Path(args.body_file).read_text(encoding="utf-8")
    if body is None:
        raise SystemExit("Provide --body or --body-file.")

    port = args.port or detect_mcp_chrome_port()
    tabs = http_json(port, "/json/list")
    try:
        tab = find_tab(tabs, tab_id=None, url_substring="mail.google.com", title_substring="Inbox")
    except RuntimeError:
        page_tabs = [tab for tab in tabs if tab.get("type") == "page"]
        if not page_tabs:
            raise SystemExit("No browser tabs are available for Gmail automation.")
        tab = page_tabs[0]

    page = CdpPage(tab["webSocketDebuggerUrl"])
    try:
        page.enable()
        compose_url = (
            "https://mail.google.com/mail/?view=cm&fs=1&tf=1&"
            + urllib.parse.urlencode({"to": args.to, "su": args.subject, "body": body})
        )
        page.navigate(compose_url)
        time.sleep(5)
        result = page.evaluate(
            """
(() => {
  const sendButton = [...document.querySelectorAll('div[role="button"], button')]
    .find((el) => /send/i.test(el.getAttribute('aria-label') || '') || (el.innerText || '').trim() === 'Send');
  if (!sendButton) return 'missing';
  sendButton.click();
  return 'clicked';
})()
"""
        )
        if result != "clicked":
            print(json.dumps({"status": "error", "reason": "Send button not found."}, indent=2))
            return 1
        time.sleep(2)
        print(json.dumps({"status": "ok", "to": args.to, "subject": args.subject}, indent=2))
        return 0
    finally:
        page.close()


if __name__ == "__main__":
    sys.exit(main())
