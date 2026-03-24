from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from chrome_cdp import CdpPage, close_tab, detect_mcp_chrome_port, open_new_tab


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create and publish a Gumroad digital product from a ready-for-upload pack."
    )
    parser.add_argument("--pack-dir", required=True)
    parser.add_argument("--product-id")
    parser.add_argument("--edit-url")
    parser.add_argument(
        "--content-only",
        action="store_true",
        help="Repair or verify the content tab for an existing product instead of creating a new one.",
    )
    parser.add_argument(
        "--media-only",
        action="store_true",
        help="Repair or verify the product media tab for an existing product instead of creating a new one.",
    )
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


def slugify_filename(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "download"


def pick_source_zip(gumroad_dir: Path, pack: dict[str, Any]) -> Path:
    zip_files = [path for path in gumroad_dir.glob("*.zip") if path.is_file()]
    if not zip_files:
        raise SystemExit(f"No Gumroad zip found in {gumroad_dir}")

    expected_name = f"{slugify_filename(str(pack.get('title', 'download')))}.zip"
    exact = next((path for path in zip_files if path.name.lower() == expected_name.lower()), None)
    if exact:
        return exact

    zip_files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return zip_files[0]


def collect_publish_assets(pack_dir: Path, pack: dict[str, Any]) -> dict[str, Any]:
    gumroad_dir = pack_dir / "gumroad"
    covers_dir = pack_dir / "covers"

    source_zip_path = pick_source_zip(gumroad_dir, pack)
    temp_dir = Path(tempfile.mkdtemp(prefix="gumroad-upload-"))
    upload_zip_path = temp_dir / f"{slugify_filename(str(pack.get('title', source_zip_path.stem)))}.zip"
    shutil.copy2(source_zip_path, upload_zip_path)

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
        "zip_path": upload_zip_path,
        "source_zip_path": source_zip_path,
        "temp_dir": temp_dir,
        "cover_files": cover_files[:2],
        "thumbnail_file": thumbnail_file or (cover_files[0] if cover_files else None),
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
    action = click_primary_action(page)
    if action is None:
        raise RuntimeError("Could not save Gumroad product details.")
    time.sleep(3)


def read_product_media_state(page: CdpPage) -> dict[str, Any]:
    state = page.evaluate(
        """
(() => {
  const images = [...document.querySelectorAll('img')];
  const buttonTexts = [...document.querySelectorAll('button, label')]
    .map((node) => (node.innerText || node.getAttribute('aria-label') || '').trim().toLowerCase())
    .filter(Boolean);
  return {
    hasThumbnail: images.some((img) => (img.alt || '').trim().toLowerCase() === 'thumbnail image'),
    largeImageCount: images.filter((img) => (img.naturalWidth || 0) >= 1000 && (img.naturalHeight || 0) >= 600).length,
    hasCoverUpload: buttonTexts.some((text) => text === 'add cover' || text === 'upload images or videos'),
    hasThumbnailUpload: buttonTexts.some((text) => text === 'upload'),
    bodySnippet: (document.body.innerText || '').slice(0, 1200)
  };
})()
"""
    )
    if not isinstance(state, dict):
        return {
            "hasThumbnail": False,
            "largeImageCount": 0,
            "hasCoverUpload": False,
            "hasThumbnailUpload": False,
            "bodySnippet": "",
        }
    return state


def product_media_ready(state: dict[str, Any], *, require_covers: bool, require_thumbnail: bool) -> bool:
    has_covers = int(state.get("largeImageCount", 0)) > 0
    has_thumbnail = bool(state.get("hasThumbnail"))
    return (not require_covers or has_covers) and (not require_thumbnail or has_thumbnail)


def wait_for_product_media(
    page: CdpPage,
    *,
    require_covers: bool,
    require_thumbnail: bool,
    timeout: float = 90.0,
) -> dict[str, Any]:
    deadline = time.time() + timeout
    last_state: dict[str, Any] | None = None
    while time.time() < deadline:
        last_state = read_product_media_state(page)
        if product_media_ready(last_state, require_covers=require_covers, require_thumbnail=require_thumbnail):
            return last_state
        time.sleep(1.0)
    details = last_state.get("bodySnippet", "") if last_state else ""
    raise RuntimeError(f"Timed out waiting for Gumroad product media. {details}")


def ensure_product_media(
    page: CdpPage,
    edit_url: str,
    cover_files: list[Path],
    thumbnail_file: Path | None,
    *,
    attempts: int = 3,
) -> dict[str, Any]:
    page.navigate(edit_url)
    wait_until(page, "location.pathname.includes('/edit') && document.body.innerText.includes('Thumbnail')", timeout=30)
    initial_state = read_product_media_state(page)
    if product_media_ready(
        initial_state,
        require_covers=bool(cover_files),
        require_thumbnail=bool(thumbnail_file),
    ):
        return {"changed": False, "state": initial_state, "attempts": 0}

    changed = False
    last_state = initial_state
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        page.navigate(edit_url)
        wait_until(page, "location.pathname.includes('/edit') && document.body.innerText.includes('Thumbnail')", timeout=30)
        last_state = read_product_media_state(page)

        try:
            if cover_files and int(last_state.get("largeImageCount", 0)) == 0:
                page.upload_files(
                    "input[type=file][multiple][accept*='.jpeg']",
                    0,
                    [str(path.resolve()) for path in cover_files],
                )
                last_state = wait_for_product_media(page, require_covers=True, require_thumbnail=False)
                changed = True

            if thumbnail_file and not bool(last_state.get("hasThumbnail")):
                page.upload_files(
                    "input[type=file][accept*='.jpeg']:not([multiple])",
                    0,
                    [str(thumbnail_file.resolve())],
                )
                last_state = wait_for_product_media(
                    page,
                    require_covers=bool(cover_files) or int(last_state.get("largeImageCount", 0)) > 0,
                    require_thumbnail=True,
                )
                changed = True
        except Exception as error:
            last_error = error
            time.sleep(2)
            continue

        if changed:
            action = click_primary_action(page)
            if action is None:
                raise RuntimeError("Could not save Gumroad product media.")
            time.sleep(3)

        page.navigate(edit_url)
        wait_until(page, "location.pathname.includes('/edit') && document.body.innerText.includes('Thumbnail')", timeout=30)
        last_state = read_product_media_state(page)
        if product_media_ready(
            last_state,
            require_covers=bool(cover_files),
            require_thumbnail=bool(thumbnail_file),
        ):
            return {"changed": changed, "state": last_state, "attempts": attempt if changed else 0}

    details = last_state.get("bodySnippet", "") if isinstance(last_state, dict) else ""
    if last_error:
        raise RuntimeError(
            f"Gumroad product media was still incomplete after {attempts} attempt(s). "
            f"{last_error} {details}"
        ) from last_error
    raise RuntimeError(f"Gumroad product media was still incomplete after {attempts} attempt(s). {details}")


def read_content_tab_state(page: CdpPage, zip_path: Path) -> dict[str, Any]:
    zip_stem = zip_path.stem.lower()
    state = page.evaluate(
        f"""
(() => {{
  const text = document.body.innerText || '';
  const lower = text.toLowerCase();
  const controls = [...document.querySelectorAll('button, a, [role="button"]')]
    .map((node) => (node.innerText || node.getAttribute('aria-label') || '').trim().toLowerCase())
    .filter(Boolean);
  return {{
    hasStem: lower.includes({js_string(zip_stem)}),
    hasDownload: controls.some((value) => value === 'download' || value.includes('download')),
    hasCancel: controls.some((value) => value === 'cancel' || value.includes('cancel')),
    isEmpty: lower.includes('enter the content you want to sell'),
    bodySnippet: text.slice(0, 1200)
  }};
}})()
"""
    )
    if not isinstance(state, dict):
        return {
            "hasStem": False,
            "hasDownload": False,
            "hasCancel": False,
            "isEmpty": True,
            "bodySnippet": "",
        }
    return state


def content_tab_ready(state: dict[str, Any]) -> bool:
    return bool(state.get("hasStem")) and bool(state.get("hasDownload")) and not bool(state.get("hasCancel"))


def wait_for_content_upload(page: CdpPage, zip_path: Path, *, timeout: float | None = None) -> dict[str, Any]:
    if timeout is None:
        size_mb = zip_path.stat().st_size / (1024 * 1024)
        timeout = max(180.0, min(420.0, 120.0 + (size_mb * 3.0)))
    deadline = time.time() + timeout
    last_state: dict[str, Any] | None = None
    while time.time() < deadline:
        last_state = read_content_tab_state(page, zip_path)
        if content_tab_ready(last_state):
            return last_state
        time.sleep(1.0)
    details = last_state.get("bodySnippet", "") if last_state else ""
    raise RuntimeError(f"Timed out waiting for Gumroad to finish processing the uploaded file. {details}")


def ensure_content_tab(page: CdpPage, edit_url: str, zip_path: Path, *, attempts: int = 3) -> dict[str, Any]:
    page.navigate(f"{edit_url}/content")
    wait_until(page, "location.pathname.endsWith('/edit/content') && !!document.querySelector('input[type=file]')", timeout=30)
    initial_state = read_content_tab_state(page, zip_path)
    if content_tab_ready(initial_state):
        return {"changed": False, "state": initial_state, "attempts": 0}

    last_state = initial_state
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        page.navigate(f"{edit_url}/content")
        wait_until(
            page,
            "location.pathname.endsWith('/edit/content') && !!document.querySelector('input[type=file]')",
            timeout=30,
        )
        try:
            page.upload_files("input[type=file]", 0, [str(zip_path.resolve())])
            last_state = wait_for_content_upload(page, zip_path)
        except Exception as error:
            last_error = error
            time.sleep(2)
            continue
        action = click_primary_action(page)
        if action is None:
            raise RuntimeError("Could not save Gumroad content.")
        time.sleep(3)
        page.navigate(f"{edit_url}/content")
        wait_until(
            page,
            "location.pathname.endsWith('/edit/content') && !!document.querySelector('input[type=file]')",
            timeout=30,
        )
        last_state = read_content_tab_state(page, zip_path)
        if content_tab_ready(last_state):
            return {"changed": True, "state": last_state, "attempts": attempt}

    details = last_state.get("bodySnippet", "") if isinstance(last_state, dict) else ""
    if last_error:
        raise RuntimeError(
            f"Gumroad content was still missing after {attempts} upload attempt(s). "
            f"{last_error} {details}"
        ) from last_error
    raise RuntimeError(f"Gumroad content was still missing after {attempts} upload attempt(s). {details}")


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
    if args.product_id and args.edit_url:
        raise SystemExit("Pass either --product-id or --edit-url, not both.")
    if args.content_only and args.media_only:
        raise SystemExit("Use either --content-only or --media-only, not both.")
    if (args.product_id or args.edit_url) and not (args.content_only or args.media_only):
        raise SystemExit("Existing Gumroad products are only supported with --content-only or --media-only.")

    pack_dir = Path(args.pack_dir).resolve()
    manifest = read_manifest(pack_dir)
    assets = collect_publish_assets(pack_dir, manifest)

    port = args.port or detect_mcp_chrome_port()
    edit_base_url = args.edit_url
    if not edit_base_url and args.product_id:
        edit_base_url = f"https://gumroad.com/products/{args.product_id}/edit"

    target_url = f"{edit_base_url}/content" if edit_base_url else "https://gumroad.com/products/new"
    tab = open_new_tab(port, target_url)
    page = CdpPage(tab["webSocketDebuggerUrl"])
    try:
        page.enable()
        content_result: dict[str, Any]
        media_result: dict[str, Any]
        if edit_base_url:
            if args.media_only:
                media_result = ensure_product_media(page, edit_base_url, assets["cover_files"], assets["thumbnail_file"])
                content_result = {"changed": False, "attempts": 0}
            else:
                content_result = ensure_content_tab(page, edit_base_url, assets["zip_path"])
                media_result = {"changed": False, "attempts": 0}
        else:
            edit_url = create_product(page, str(manifest["title"]), int(manifest["suggestedPrice"]))
            edit_base_url = edit_url.split("/content")[0].split("/receipt")[0].split("/share")[0]
            populate_product_tab(page, manifest, assets["cover_files"])
            media_result = ensure_product_media(page, edit_base_url, assets["cover_files"], assets["thumbnail_file"])
            content_result = ensure_content_tab(page, edit_base_url, assets["zip_path"])
            populate_receipt_tab(page, edit_base_url, compose_receipt(manifest))
            publish_if_needed(page, edit_base_url)

        if not args.media_only:
            page.navigate(f"{edit_base_url}/content")
            wait_until(
                page,
                "location.pathname.endsWith('/edit/content') && !!document.querySelector('input[type=file]')",
                timeout=30,
            )
            verification = read_content_tab_state(page, assets["zip_path"])
            if not content_tab_ready(verification):
                raise RuntimeError(
                    "Gumroad content verification failed after upload. "
                    f"{verification.get('bodySnippet', '')}"
                )

        page.navigate(edit_base_url)
        wait_until(page, "location.pathname.includes('/edit') && document.body.innerText.includes('Thumbnail')", timeout=30)
        media_verification = read_product_media_state(page)
        if not product_media_ready(
            media_verification,
            require_covers=bool(assets["cover_files"]),
            require_thumbnail=bool(assets["thumbnail_file"]),
        ):
            raise RuntimeError(
                "Gumroad product media verification failed after upload. "
                f"{media_verification.get('bodySnippet', '')}"
            )

        page.navigate(edit_base_url)
        wait_until(page, "location.pathname.includes('/edit') && document.querySelectorAll('button').length > 0")
        product_id, final_edit_url, product_url = extract_product_urls(page)
        print(
            json.dumps(
                {
                    "status": "verified" if (args.content_only or args.media_only) else "published",
                    "packId": manifest["id"],
                    "productId": product_id,
                    "productUrl": product_url,
                    "editUrl": final_edit_url,
                    "zipPath": str(assets["zip_path"]),
                    "sourceZipPath": str(assets["source_zip_path"]),
                    "mediaChanged": bool(media_result.get("changed")),
                    "mediaAttempts": int(media_result.get("attempts", 0)),
                    "contentChanged": bool(content_result.get("changed")),
                    "uploadAttempts": int(content_result.get("attempts", 0)),
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
        shutil.rmtree(assets["temp_dir"], ignore_errors=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
