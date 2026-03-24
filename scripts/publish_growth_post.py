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


def body_text(page: CdpPage) -> str:
    return str(page.evaluate("(document.body.innerText || '').trim()"))


def click_at(page: CdpPage, x: float, y: float) -> None:
    page.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none"})
    page.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    page.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})


def rect_for_selector(page: CdpPage, selector: str, *, index: int = 0) -> dict[str, float] | None:
    expression = f"""
(() => {{
  const matches = [...document.querySelectorAll({js_string(selector)})];
  const target = matches[{index}] ?? null;
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  return {{
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height
  }};
}})()
"""
    result = page.evaluate(expression)
    return result if isinstance(result, dict) else None


def click_selector_center(page: CdpPage, selector: str, *, index: int = 0) -> bool:
    rect = rect_for_selector(page, selector, index=index)
    if not rect:
        return False
    click_at(page, float(rect["x"]), float(rect["y"]))
    return True


def rect_for_exact_text(page: CdpPage, text: str, *, root_selector: str | None = None) -> dict[str, float] | None:
    root_expression = (
        f"[...document.querySelectorAll({js_string(root_selector)})]"
        if root_selector
        else "[document]"
    )
    expression = f"""
(() => {{
  const roots = {root_expression};
  for (const root of roots) {{
    const candidates = [
      ...root.querySelectorAll('button,[role=button],a,div,span')
    ];
    const target = candidates.find((node) => ((node.innerText || node.getAttribute('aria-label') || '').trim()) === {js_string(text)});
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    return {{
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: rect.width,
      height: rect.height
    }};
  }}
  return null;
}})()
"""
    result = page.evaluate(expression)
    return result if isinstance(result, dict) else None


def click_exact_text(page: CdpPage, text: str, *, root_selector: str | None = None, real_click: bool = False) -> bool:
    if real_click:
      rect = rect_for_exact_text(page, text, root_selector=root_selector)
      if not rect:
          return False
      click_at(page, float(rect["x"]), float(rect["y"]))
      return True

    root_expression = (
        f"[...document.querySelectorAll({js_string(root_selector)})]"
        if root_selector
        else "[document]"
    )
    expression = f"""
(() => {{
  const roots = {root_expression};
  for (const root of roots) {{
    const target = [...root.querySelectorAll('button,[role=button],a,div,span')]
      .find((node) => ((node.innerText || node.getAttribute('aria-label') || '').trim()) === {js_string(text)});
    if (!target) continue;
    target.click();
    return true;
  }}
  return false;
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


def resolve_brand_name(profiles: list[dict[str, Any]], business_id: str) -> str:
    for profile in profiles:
        if profile.get("businessId") == business_id and profile.get("brandName"):
            return str(profile["brandName"]).strip()
    return "Imon"


def resolve_pinterest_board_name(profiles: list[dict[str, Any]], business_id: str) -> str:
    brand_name = resolve_brand_name(profiles, business_id)
    return f"{brand_name} Digital Assets".strip()


def split_caption(caption: str, fallback_title: str) -> tuple[str, str]:
    lines = [line.strip() for line in caption.splitlines() if line.strip()]
    if not lines:
        return fallback_title, ""
    title = lines[0]
    description = "\n\n".join(lines[1:])
    return title, description


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
        raise RuntimeError("Could not focus the rich text editor.")
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


def dismiss_pinterest_tour(page: CdpPage) -> None:
    for label in ("Cancel", "End tour"):
        if click_exact_text(page, label):
            time.sleep(1.0)


def ensure_pinterest_board_selected(page: CdpPage, board_name: str) -> None:
    page_text = body_text(page)
    if board_name in page_text and "No boards found" not in page_text:
        return

    if not click_exact_text(page, "Select"):
        if not click_exact_text(page, board_name):
            raise RuntimeError("Could not open the Pinterest board picker.")

    wait_until(page, "(() => !!document.querySelector('#pickerSearchField'))()", timeout=15.0)
    page.set_input_value("#pickerSearchField", board_name)
    time.sleep(1.0)

    picker_text = body_text(page)
    if "No boards found" in picker_text:
        if not click_selector_center(page, '[data-test-id="create-board-button"]'):
            raise RuntimeError("Could not open the Pinterest create-board flow.")
        wait_until(page, "(() => !!document.querySelector('#boardEditName'))()", timeout=15.0)
        page.set_input_value("#boardEditName", board_name)
        secret_checked = bool(
            page.evaluate("(() => !!document.querySelector('#secret:checked'))()")
        )
        if secret_checked:
            click_selector_center(page, "#secret")
            time.sleep(0.5)
        if not click_exact_text(page, "Create", root_selector='[role="dialog"]', real_click=True):
            raise RuntimeError("Could not confirm Pinterest board creation.")
        wait_until(
            page,
            f"(() => !(document.body.innerText || '').includes('No boards found') && "
            f"(document.body.innerText || '').includes({js_string(board_name)}))()",
            timeout=20.0,
        )
        return

    if not click_exact_text(page, board_name, root_selector='[role="dialog"]', real_click=True):
        raise RuntimeError(f"Could not select the Pinterest board {board_name!r}.")
    wait_until(page, f"(() => (document.body.innerText || '').includes({js_string(board_name)}))()", timeout=15.0)


def fill_pinterest_description(page: CdpPage, description: str) -> None:
    if not description.strip():
        return
    clear_expression = """
(() => {
  const el = document.querySelector('[contenteditable=true][role=combobox]');
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
        return
    page.evaluate(
        f"""
(() => {{
  const el = document.querySelector('[contenteditable=true][role=combobox]');
  if (!el) return '';
  el.focus();
  document.execCommand('insertText', false, {js_string(description)});
  return (el.innerText || '').trim();
}})()
"""
    )


def post_to_pinterest(
    page: CdpPage,
    *,
    title: str,
    description: str,
    asset_path: str,
    destination_url: str,
    business_id: str,
    social_profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    board_name = resolve_pinterest_board_name(social_profiles, business_id)
    page.navigate("https://www.pinterest.com/pin-builder/")
    wait_until(page, "(() => !!document.querySelector('input[type=file]'))()", timeout=30.0)
    dismiss_pinterest_tour(page)
    ensure_pinterest_board_selected(page, board_name)

    page.upload_files("input[type=file]", 0, [asset_path])
    wait_until(
        page,
        "(() => (document.body.innerText || '').includes('Create carousel') || "
        "(document.body.innerText || '').includes('Delete image'))()",
        timeout=45.0,
    )
    dismiss_pinterest_tour(page)

    page.set_input_value('textarea[id^="pin-draft-title-"]', title)
    page.set_input_value('textarea[id^="pin-draft-link-"]', destination_url)
    fill_pinterest_description(page, description)
    time.sleep(1.0)

    if not click_exact_text(page, "Publish", real_click=True):
        raise RuntimeError("Could not find the Pinterest Publish action.")
    wait_until(
        page,
        "(() => /You created a Pin!|Saved to/i.test(document.body.innerText || ''))()",
        timeout=45.0,
    )

    if click_exact_text(page, "See your Pin", real_click=True):
        wait_until(page, "(() => location.href.includes('/pin/'))()", timeout=20.0)

    time.sleep(1.0)
    return {
        "status": "posted",
        "channel": "pinterest",
        "postedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pageUrl": str(page.evaluate("location.href")),
        "bodySnippet": str(page.evaluate("(document.body.innerText || '').slice(0, 1200)")),
        "boardName": board_name,
    }


def main() -> None:
    args = parse_args()
    queue = load_json(args.queue_file)
    social_profiles = load_json(args.social_profiles_file)
    item = next((entry for entry in queue if entry.get("id") == args.item_id), None)
    if not item:
        raise SystemExit(f"Could not find growth queue item {args.item_id!r}.")

    channel = str(item.get("channel") or "")
    port = args.port or detect_mcp_chrome_port()

    if channel == "facebook_page":
        start_url = "https://business.facebook.com/"
    elif channel == "pinterest":
        start_url = "https://www.pinterest.com/pin-builder/"
    else:
        raise SystemExit(f"Unsupported growth channel for live posting: {channel}")

    tab = open_new_tab(port, start_url)
    page = CdpPage(tab["webSocketDebuggerUrl"])
    page.enable()

    try:
        if channel == "facebook_page":
            result = post_to_facebook(
                page,
                caption=str(item.get("caption") or "").strip(),
                business_id=str(item.get("businessId") or ""),
                social_profiles=social_profiles,
            )
        else:
            fallback_title = str(item.get("title") or "").replace(" on pinterest", "").replace(" on facebook_page", "").strip()
            title, description = split_caption(str(item.get("caption") or "").strip(), fallback_title)
            result = post_to_pinterest(
                page,
                title=title,
                description=description,
                asset_path=str(item.get("assetPath") or "").strip(),
                destination_url=str(item.get("destinationUrl") or "").strip(),
                business_id=str(item.get("businessId") or ""),
                social_profiles=social_profiles,
            )
        print(json.dumps(result, indent=2))
    finally:
        page.close()
        close_tab(port, tab["id"])


if __name__ == "__main__":
    main()
