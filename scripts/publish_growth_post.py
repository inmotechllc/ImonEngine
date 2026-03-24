from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from chrome_cdp import CdpPage, close_tab, detect_mcp_chrome_port, open_new_tab


DEFAULT_META_ASSET_ID = "1042144572314434"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish one due growth-queue item through the signed-in browser session."
    )
    parser.add_argument("--queue-file", required=True)
    parser.add_argument("--social-profiles-file", required=True)
    parser.add_argument("--item-id", required=True)
    parser.add_argument("--port", type=int)
    return parser.parse_args()


def load_json(path: str) -> Any:
    file_path = Path(path)
    if not file_path.exists():
        raise SystemExit(f"Missing file: {file_path}")
    return json.loads(file_path.read_text(encoding="utf-8"))


def wait_until(page: CdpPage, expression: str, *, timeout: float = 30.0, interval: float = 0.5) -> Any:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            result = page.evaluate(expression)
            if result:
                return result
        except Exception as error:  # pragma: no cover - browser timing
            last_error = error
        time.sleep(interval)
    if last_error:
        raise RuntimeError(f"Timed out waiting for browser condition: {last_error}") from last_error
    raise RuntimeError("Timed out waiting for browser condition.")


def js_string(value: str) -> str:
    return json.dumps(value)


def click_exact_text(page: CdpPage, text: str) -> bool:
    expression = f"""
(() => {{
  const target = [...document.querySelectorAll('button,[role=button],a')]
    .find((node) => ((node.innerText || node.getAttribute('aria-label') || '').trim()) === {js_string(text)});
  if (!target) return false;
  target.click();
  return true;
}})()
"""
    return bool(page.evaluate(expression))


def resolve_meta_asset_id(profiles: list[dict[str, Any]], business_id: str) -> str:
    for profile in profiles:
        if profile.get("businessId") != business_id:
            continue
        if profile.get("platform") != "meta_business":
            continue
        external_id = str(profile.get("externalId") or "").strip()
        if external_id:
            return external_id
        url = str(profile.get("profileUrl") or "")
        if "asset_id=" in url:
            return url.split("asset_id=", 1)[1].split("&", 1)[0]
    return DEFAULT_META_ASSET_ID


def clear_and_insert_editor_text(page: CdpPage, text: str) -> None:
    clear_expression = """
(() => {
  const el = document.querySelector('[contenteditable=true]');
  if (!el) return 'missing';
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('delete');
  return 'ready';
})()
"""
    state = page.evaluate(clear_expression)
    if state != "ready":
        raise RuntimeError("Could not focus the Meta composer editor.")
    page.send("Input.insertText", {"text": text})


def post_to_facebook(
    page: CdpPage,
    *,
    caption: str,
    business_id: str,
    social_profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    asset_id = resolve_meta_asset_id(social_profiles, business_id)
    composer_url = (
        "https://business.facebook.com/latest/composer/"
        f"?asset_id={asset_id}&nav_ref=internal_nav&ref=biz_web_home_create_post&context_ref=HOME"
    )
    page.navigate(composer_url)
    wait_until(page, "(() => location.href.includes('/composer/') && !!document.querySelector('[contenteditable=true]'))()")
    clear_and_insert_editor_text(page, caption)
    wait_until(
        page,
        "(() => (document.body.innerText || '').includes('Publish') && "
        "/Just now|Now|Preview/i.test(document.body.innerText || ''))()",
        timeout=10.0,
    )
    if not click_exact_text(page, "Publish"):
        raise RuntimeError("Could not find the Meta Business Suite Publish action.")
    wait_until(
        page,
        "(() => !location.href.includes('/composer/') || "
        "/published|scheduled|posted/i.test(document.body.innerText || ''))()",
        timeout=45.0,
    )
    time.sleep(2.0)
    return {
        "status": "posted",
        "channel": "facebook_page",
        "postedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pageUrl": str(page.evaluate("location.href")),
        "bodySnippet": str(page.evaluate("(document.body.innerText || '').slice(0, 1200)")),
    }


def main() -> None:
    args = parse_args()
    queue = load_json(args.queue_file)
    social_profiles = load_json(args.social_profiles_file)
    item = next((entry for entry in queue if entry.get("id") == args.item_id), None)
    if not item:
        raise SystemExit(f"Could not find growth queue item {args.item_id!r}.")

    channel = str(item.get("channel") or "")
    if channel != "facebook_page":
        raise SystemExit(f"Unsupported growth channel for live posting: {channel}")

    port = args.port or detect_mcp_chrome_port()
    tab = open_new_tab(port, "https://business.facebook.com/")
    page = CdpPage(tab["webSocketDebuggerUrl"])
    page.enable()

    try:
        result = post_to_facebook(
            page,
            caption=str(item.get("caption") or "").strip(),
            business_id=str(item.get("businessId") or ""),
            social_profiles=social_profiles,
        )
        print(json.dumps(result, indent=2))
    finally:
        page.close()
        close_tab(port, tab["id"])


if __name__ == "__main__":
    main()
