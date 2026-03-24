from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from chrome_cdp import CdpPage, close_tab, detect_mcp_chrome_port, open_new_tab


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create and publish a Gumroad digital product from a ready-for-upload pack."
    )
    parser.add_argument("--pack-dir", required=True)
    parser.add_argument("--port", type=int)
    return parser.parse_args()


def read_manifest(pack_dir: Path) -> dict[str, Any]:
    manifest_path = pack_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"Missing manifest: {manifest_path}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def first_existing(paths: list[Path]) -> Path | None:
    for candidate in paths:
        if candidate.exists():
            return candidate
    return None


def collect_publish_assets(pack_dir: Path) -> dict[str, Any]:
    gumroad_dir = pack_dir / "gumroad"
    covers_dir = pack_dir / "covers"

    zip_files = sorted(gumroad_dir.glob("*.zip"))
    if not zip_files:
        raise SystemExit(f"No Gumroad zip found in {gumroad_dir}")

    cover_files = sorted(
        [
            path
            for path in covers_dir.iterdir()
            if path.is_file()
            and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
            and "thumbnail" not in path.name.lower()
        ]
    )
    thumbnail_file = first_existing(
        [
            covers_dir / "thumbnail-square.png",
            covers_dir / "thumbnail-square.jpg",
            covers_dir / "thumbnail.png",
            covers_dir / "thumbnail.jpg",
        ]
    )

    return {
        "zip_path": zip_files[0],
        "cover_files": cover_files[:2],
        "thumbnail_file": thumbnail_file,
    }


def compose_summary(pack: dict[str, Any]) -> str:
    summary = str(pack.get("shortDescription", "")).strip()
    if len(summary) <= 120:
        return summary
    deliverables = pack.get("deliverables", [])
    if isinstance(deliverables, list) and deliverables:
        return str(deliverables[0]).strip()[:120]
    return summary[:117].rstrip() + "..."


def compose_description(pack: dict[str, Any]) -> str:
    description = str(pack.get("description", "")).strip()
    deliverables = [str(item).strip() for item in pack.get("deliverables", []) if str(item).strip()]
    blocks = [description] if description else []
    if deliverables:
        blocks.append("You'll get:")
        blocks.extend(f"- {item}" for item in deliverables)
    return "\n\n".join(blocks[:1] + [block for block in blocks[1:] if block])


def compose_receipt(pack: dict[str, Any]) -> str:
    asset_type = str(pack.get("assetType", ""))
    if asset_type == "social_template_pack":
        return (
            "Thanks for your purchase. Open the template pack, swap in your message, "
            "and export the slides when they are ready to post."
        )
    if asset_type == "icon_pack":
        return (
            "Thanks for your purchase. Unzip the pack, pick the SVG or PNG icons you need, "
            "and drop them into your next dashboard, landing page, or prototype."
        )
    if asset_type == "texture_pack":
        return (
            "Thanks for your purchase. Unzip the textures and layer them into your next deck, poster, "
            "or brand system wherever you need extra depth."
        )
    return (
        "Thanks for your purchase. Download the pack, unzip the files, and pick the assets that fit "
        "your setup best."
    )


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


def set_input_by_index(page: CdpPage, selector: str, index: int, value: str) -> str:
    expression = f"""
(() => {{
  const nodes = [...document.querySelectorAll({js_string(selector)})];
  const el = nodes[{index}];
  if (!el) return 'missing';
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, {js_string(value)});
  else el.value = {js_string(value)};
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return el.value;
}})()
"""
    return str(page.evaluate(expression))


def set_textarea_by_index(page: CdpPage, index: int, value: str) -> str:
    expression = f"""
(() => {{
  const nodes = [...document.querySelectorAll('textarea')];
  const el = nodes[{index}];
  if (!el) return 'missing';
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, {js_string(value)});
  else el.value = {js_string(value)};
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return el.value;
}})()
"""
    return str(page.evaluate(expression))


def click_text(page: CdpPage, text: str) -> bool:
    expression = f"""
(() => {{
  const needle = {js_string(text.lower())};
  const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
  const target = nodes.find((node) => {{
    const text = (node.innerText || node.getAttribute('aria-label') || '').trim().toLowerCase();
    return text === needle || text.includes(needle);
  }});
  if (!target) return false;
  target.click();
  return true;
}})()
"""
    return bool(page.evaluate(expression))


def focus_selector(page: CdpPage, selector: str) -> None:
    result = page.evaluate(
        f"""
(() => {{
  const el = document.querySelector({js_string(selector)});
  if (!el) return 'missing';
  el.focus();
  return 'focused';
}})()
"""
    )
    if result != "focused":
        raise RuntimeError(f"Could not focus selector {selector!r}.")


def dispatch_key(page: CdpPage, *, key: str, code: str, windows_key_code: int, modifiers: int = 0) -> None:
    page.send(
        "Input.dispatchKeyEvent",
        {
            "type": "rawKeyDown",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": windows_key_code,
            "nativeVirtualKeyCode": windows_key_code,
            "modifiers": modifiers,
        },
    )
    page.send(
        "Input.dispatchKeyEvent",
        {
            "type": "keyUp",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": windows_key_code,
            "nativeVirtualKeyCode": windows_key_code,
            "modifiers": modifiers,
        },
    )


def replace_editor_text(page: CdpPage, selector: str, value: str) -> None:
    focus_selector(page, selector)
    dispatch_key(page, key="a", code="KeyA", windows_key_code=65, modifiers=2)
    dispatch_key(page, key="Backspace", code="Backspace", windows_key_code=8)
    page.send("Input.insertText", {"text": value})
    time.sleep(0.5)


def click_primary_action(page: CdpPage) -> str | None:
    for label in ("Publish and continue", "Save and continue", "Save changes", "Publish", "Continue"):
        if click_text(page, label):
            return label
    return None


def current_path(page: CdpPage) -> str:
    return str(page.evaluate("location.pathname"))


def create_product(page: CdpPage, title: str, price: int) -> str:
    wait_until(page, "location.pathname === '/products/new' && !!document.querySelector('form')")
    if set_input_by_index(page, "input", 0, title) == "missing":
        raise RuntimeError("Could not set product title on Gumroad new-product page.")
    if set_input_by_index(page, "input", 1, str(price)) == "missing":
        raise RuntimeError("Could not set product price on Gumroad new-product page.")

    if not click_text(page, "Digital product"):
        raise RuntimeError("Could not choose Gumroad digital product type.")
    if not click_text(page, "Next: Customize"):
        raise RuntimeError("Could not continue to the Gumroad customize step.")

    wait_until(page, "location.pathname.includes('/products/') && location.pathname.includes('/edit')", timeout=45)
    return str(page.evaluate("location.href"))


def populate_product_tab(page: CdpPage, pack: dict[str, Any], cover_files: list[Path]) -> None:
    wait_until(page, "!!document.querySelector('[contenteditable=true]') && document.querySelectorAll('input').length >= 5")
    set_input_by_index(page, "input[type='text']", 0, str(pack["title"]))
    replace_editor_text(page, "[contenteditable='true']", compose_description(pack))
    set_input_by_index(page, "input[placeholder=\"You'll get...\"]", 0, compose_summary(pack))
    if cover_files:
        page.upload_files("input[type=file]", 0, [str(path.resolve()) for path in cover_files])
        time.sleep(4)
    action = click_primary_action(page)
    if action is None:
        raise RuntimeError("Could not save Gumroad product details.")
    time.sleep(3)


def populate_content_tab(page: CdpPage, edit_url: str, zip_path: Path) -> None:
    page.navigate(f"{edit_url}/content")
    wait_until(page, "location.pathname.endsWith('/edit/content') && !!document.querySelector('input[type=file]')", timeout=30)
    page.upload_files("input[type=file]", 0, [str(zip_path.resolve())])
    zip_stem = zip_path.stem
    wait_until(page, f"document.body.innerText.toLowerCase().includes({js_string(zip_stem.lower())})", timeout=60)
    action = click_primary_action(page)
    if action is None:
        raise RuntimeError("Could not save Gumroad content.")
    time.sleep(3)


def populate_receipt_tab(page: CdpPage, edit_url: str, receipt_text: str) -> None:
    page.navigate(f"{edit_url}/receipt")
    wait_until(page, "location.pathname.endsWith('/edit/receipt') && document.querySelectorAll('textarea').length >= 1")
    set_input_by_index(page, "input[type='text']", 0, "Download")
    set_textarea_by_index(page, 0, receipt_text)
    action = click_primary_action(page)
    if action is None:
        raise RuntimeError("Could not save Gumroad receipt settings.")
    time.sleep(3)


def publish_if_needed(page: CdpPage, edit_url: str) -> None:
    page.navigate(edit_url)
    wait_until(page, "location.pathname.includes('/edit') && document.querySelectorAll('button').length > 0")
    button_texts = page.evaluate(
        """
(() => [...document.querySelectorAll('button')]
  .map((node) => (node.innerText || node.getAttribute('aria-label') || '').trim())
  .filter(Boolean))()
"""
    )
    texts = [str(item).lower() for item in (button_texts or [])]
    if any(text == "unpublish" for text in texts):
        return
    if click_text(page, "Publish and continue") or click_text(page, "Publish"):
        time.sleep(4)
        wait_until(page, """
(() => [...document.querySelectorAll('button')]
  .some((node) => ((node.innerText || node.getAttribute('aria-label') || '').trim().toLowerCase() === 'unpublish')))()
""", timeout=30)
        return
    raise RuntimeError("Product did not expose a publish or unpublish control after setup.")


def extract_product_urls(page: CdpPage) -> tuple[str, str, str]:
    result = page.evaluate(
        """
(() => {
  const match = location.pathname.match(/\\/products\\/([^/]+)\\/edit/);
  const productId = match ? match[1] : null;
  const pageData = document.querySelector('#app')?.dataset?.page;
  let subdomain = 'gumroad.com';
  if (pageData) {
    try {
      const parsed = JSON.parse(pageData);
      subdomain = parsed?.props?.current_seller?.subdomain || subdomain;
    } catch (error) {
      subdomain = 'gumroad.com';
    }
  }
  return {
    productId,
    editUrl: location.href,
    productUrl: productId ? `https://${subdomain.replace(/^https?:\\/\\//, '')}/l/${productId}` : null
  };
})()
"""
    )
    if not result or not result.get("productId") or not result.get("productUrl"):
        raise RuntimeError("Could not determine the Gumroad product URL.")
    return str(result["productId"]), str(result["editUrl"]), str(result["productUrl"])


def main() -> int:
    args = parse_args()
    pack_dir = Path(args.pack_dir).resolve()
    manifest = read_manifest(pack_dir)
    assets = collect_publish_assets(pack_dir)

    port = args.port or detect_mcp_chrome_port()
    tab = open_new_tab(port, "https://gumroad.com/products/new")
    page = CdpPage(tab["webSocketDebuggerUrl"])
    try:
        page.enable()
        edit_url = create_product(page, str(manifest["title"]), int(manifest["suggestedPrice"]))
        edit_base_url = edit_url.split("/content")[0].split("/receipt")[0].split("/share")[0]
        populate_product_tab(page, manifest, assets["cover_files"])
        populate_content_tab(page, edit_base_url, assets["zip_path"])
        populate_receipt_tab(page, edit_base_url, compose_receipt(manifest))
        publish_if_needed(page, edit_base_url)
        product_id, final_edit_url, product_url = extract_product_urls(page)
        print(
            json.dumps(
                {
                    "status": "published",
                    "packId": manifest["id"],
                    "productId": product_id,
                    "productUrl": product_url,
                    "editUrl": final_edit_url,
                    "zipPath": str(assets["zip_path"]),
                },
                indent=2,
            )
        )
        return 0
    finally:
        page.close()
        try:
            close_tab(port, str(tab["id"]))
        except Exception:
            pass


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
