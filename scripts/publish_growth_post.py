from __future__ import annotations

import argparse
import json
import mimetypes
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from chrome_cdp import CdpPage, close_tab, detect_mcp_chrome_port, open_new_tab


DEFAULT_META_ASSET_ID = "1042144572314434"
DEFAULT_META_GRAPH_API_VERSION = "v23.0"


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


def load_env_file() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


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


def resolve_facebook_page_id(profiles: list[dict[str, Any]], business_id: str) -> str:
    for profile in profiles:
        if profile.get("businessId") != business_id:
            continue
        if profile.get("platform") != "facebook_page":
            continue
        external_id = str(profile.get("externalId") or "").strip()
        if external_id:
            return external_id
        profile_url = str(profile.get("profileUrl") or "")
        if "id=" in profile_url:
            return profile_url.split("id=", 1)[1].split("&", 1)[0]

    page_id = str(os.getenv("META_PAGE_ID") or os.getenv("META_FACEBOOK_PAGE_ID") or "").strip()
    if page_id:
        return page_id
    return ""


def resolve_profile_url(
    profiles: list[dict[str, Any]],
    business_id: str,
    platform: str,
) -> str:
    for profile in profiles:
        if profile.get("businessId") == business_id and profile.get("platform") == platform:
            return str(profile.get("profileUrl") or "").strip()
    return ""


def resolve_profile_identity(
    profiles: list[dict[str, Any]],
    business_id: str,
    platform: str,
) -> str:
    for profile in profiles:
        if profile.get("businessId") != business_id or profile.get("platform") != platform:
            continue
        handle = str(profile.get("handle") or "").strip()
        if handle:
            return handle
        brand_name = str(profile.get("brandName") or "").strip()
        if brand_name:
            return brand_name
    return ""


def resolve_facebook_page_profile_url(profiles: list[dict[str, Any]], business_id: str) -> str:
    profile_url = resolve_profile_url(profiles, business_id, "facebook_page")
    if profile_url:
        return profile_url
    page_id = resolve_facebook_page_id(profiles, business_id)
    if page_id:
        return f"https://www.facebook.com/profile.php?id={page_id}"
    return ""


def resolve_meta_page_access_token() -> str:
    return str(
        os.getenv("META_PAGE_ACCESS_TOKEN")
        or os.getenv("META_GRAPH_PAGE_ACCESS_TOKEN")
        or ""
    ).strip()


def resolve_meta_instagram_access_token() -> str:
    return str(
        os.getenv("META_INSTAGRAM_ACCESS_TOKEN")
        or os.getenv("INSTAGRAM_ACCESS_TOKEN")
        or resolve_meta_page_access_token()
        or ""
    ).strip()


def resolve_meta_graph_api_version() -> str:
    return str(os.getenv("META_GRAPH_API_VERSION") or DEFAULT_META_GRAPH_API_VERSION).strip() or DEFAULT_META_GRAPH_API_VERSION


def resolve_instagram_business_account_id(
    profiles: list[dict[str, Any]],
    business_id: str,
    *,
    graph_version: str,
    access_token: str,
) -> str:
    env_id = str(
        os.getenv("META_INSTAGRAM_ACCOUNT_ID")
        or os.getenv("META_INSTAGRAM_BUSINESS_ACCOUNT_ID")
        or os.getenv("INSTAGRAM_ACCOUNT_ID")
        or ""
    ).strip()
    if env_id:
        return env_id

    for profile in profiles:
        if profile.get("businessId") != business_id:
            continue
        if profile.get("platform") != "instagram_account":
            continue
        external_id = str(profile.get("externalId") or "").strip()
        if external_id:
            return external_id

    page_id = resolve_facebook_page_id(profiles, business_id)
    if not page_id:
        return ""

    response = http_get_json(
        f"https://graph.facebook.com/{graph_version}/{page_id}",
        params={
            "access_token": access_token,
            "fields": "instagram_business_account{id,username}",
        },
    )
    instagram_account = response.get("instagram_business_account") or {}
    return str(instagram_account.get("id") or "").strip()


def append_destination_url(caption: str, destination_url: str) -> str:
    destination = destination_url.strip()
    if not destination:
        return caption
    if destination in caption:
        return caption
    if not caption.strip():
        return destination
    return f"{caption.rstrip()}\n\n{destination}"


def resolve_public_asset_url(asset_path: str, asset_url: str, destination_url: str) -> str:
    explicit_url = asset_url.strip()
    if explicit_url:
        return explicit_url

    resolved_destination = destination_url.strip()
    if not asset_path.strip() or not resolved_destination:
        return ""

    parsed = urllib.parse.urlsplit(resolved_destination)
    if not parsed.scheme or not parsed.netloc:
        return ""

    origin = f"{parsed.scheme}://{parsed.netloc}"
    normalized_asset = Path(asset_path).resolve().as_posix()
    for marker in ("/runtime/agency-site/", "/runtime/storefront-site/"):
        if marker not in normalized_asset:
            continue
        relative = normalized_asset.split(marker, 1)[1].lstrip("/")
        return f"{origin}/{relative}"
    return ""


def wait_for_instagram_media_ready(
    creation_id: str,
    *,
    access_token: str,
    graph_version: str,
    timeout: float = 60.0,
    interval: float = 2.0,
) -> None:
    deadline = time.time() + timeout
    last_status = "unknown"
    while time.time() < deadline:
        response = http_get_json(
            f"https://graph.facebook.com/{graph_version}/{creation_id}",
            params={
                "access_token": access_token,
                "fields": "status_code,status",
            },
        )
        status_code = str(response.get("status_code") or response.get("status") or "").upper()
        last_status = status_code or last_status
        if status_code in {"FINISHED", "PUBLISHED"}:
            return
        if status_code in {"ERROR", "EXPIRED"}:
            raise RuntimeError(f"Instagram media processing failed with status {status_code}.")
        time.sleep(interval)
    raise RuntimeError(f"Timed out waiting for Instagram media processing. Last status: {last_status}")


def encode_multipart_formdata(
    fields: dict[str, str],
    files: list[tuple[str, str, str, bytes]],
) -> tuple[str, bytes]:
    boundary = f"----ImonEngineBoundary{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for key, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )

    for field_name, file_name, content_type, content in files:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                (
                    f'Content-Disposition: form-data; name="{field_name}"; filename="{file_name}"\r\n'
                ).encode("utf-8"),
                f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
                content,
                b"\r\n",
            ]
        )

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(chunks)


def http_post_json(
    url: str,
    *,
    fields: dict[str, str],
    files: list[tuple[str, str, str, bytes]] | None = None,
) -> dict[str, Any]:
    headers = {"User-Agent": "ImonEngine/1.0"}
    data: bytes
    if files:
        boundary, data = encode_multipart_formdata(fields, files)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    else:
        data = urllib.parse.urlencode(fields).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
            error_message = (
                parsed.get("error", {}).get("message")
                or parsed.get("message")
                or body
            )
        except Exception:
            error_message = body or error.reason
        raise RuntimeError(
            f"Meta Graph API request failed ({error.code}): {error_message}"
        ) from error


def http_get_json(url: str, *, params: dict[str, str]) -> dict[str, Any]:
    request_url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        request_url,
        headers={"User-Agent": "ImonEngine/1.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
            error_message = (
                parsed.get("error", {}).get("message")
                or parsed.get("message")
                or body
            )
        except Exception:
            error_message = body or error.reason
        raise RuntimeError(
            f"Meta Graph API request failed ({error.code}): {error_message}"
        ) from error


def build_facebook_post_url(page_id: str, graph_post_id: str, fallback_url: str) -> str:
    if "_" in graph_post_id:
        _, post_id = graph_post_id.split("_", 1)
        return f"https://www.facebook.com/{page_id}/posts/{post_id}"
    return fallback_url


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


def ensure_facebook_page_context(
    page: CdpPage,
    *,
    business_id: str,
    social_profiles: list[dict[str, Any]],
) -> tuple[str, str]:
    page_name = resolve_profile_identity(social_profiles, business_id, "facebook_page") or resolve_brand_name(
        social_profiles, business_id
    )
    page_url = resolve_facebook_page_profile_url(social_profiles, business_id)
    if not page_url:
        raise RuntimeError(
            "Could not resolve the Facebook Page URL. Add a facebook_page profileUrl or page id for this business."
        )

    page.navigate(page_url)
    wait_until(
        page,
        f"(() => (document.body.innerText || '').includes({js_string(page_name)}))()",
        timeout=30.0,
    )

    page_text = body_text(page)
    if f"Switch into {page_name}'s Page" in page_text or "Switch profiles" in page_text:
        if "Switch profiles" not in page_text:
            if not click_selector_center(page, '[aria-label="Switch"][role="button"]', index=0):
                raise RuntimeError("Could not open the Facebook Page switch prompt.")
            wait_until(page, "(() => (document.body.innerText || '').includes('Switch profiles'))()", timeout=20.0)

        if not click_selector_center(page, '[aria-label="Switch"][role="button"]', index=1):
            raise RuntimeError("Could not switch into the Facebook Page context.")

        wait_until(
            page,
            f"""(() => {{
  const body = document.body.innerText || '';
  return body.includes({js_string(page_name)}) &&
    (body.includes({js_string("What's on your mind?")}) || /acting as|Manage Page/i.test(body));
}})()""",
            timeout=30.0,
        )
        time.sleep(2.0)

    return page_name, page_url


def post_to_facebook_page(
    page: CdpPage,
    *,
    caption: str,
    destination_url: str,
    business_id: str,
    social_profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    full_caption = append_destination_url(caption, destination_url)
    page_name, page_url = ensure_facebook_page_context(
        page,
        business_id=business_id,
        social_profiles=social_profiles,
    )

    if not click_exact_text(page, "What's on your mind?", real_click=True):
        raise RuntimeError("Could not open the Facebook Page composer.")

    wait_until(
        page,
        f"(() => !!document.querySelector('[contenteditable=true]') && (document.body.innerText || '').includes({js_string('Create post')}) && (document.body.innerText || '').includes({js_string(page_name)}))()",
        timeout=20.0,
    )

    clear_and_insert_editor_text(page, full_caption)
    wait_until(
        page,
        "(() => { const body = document.body.innerText || ''; return body.includes('Next') || body.includes('Post'); })()",
        timeout=15.0,
    )

    composer_text = body_text(page)
    if "Post settings" not in composer_text:
        clicked_next = click_selector_center(page, '[aria-label="Next"][role="button"]', index=0)
        if not clicked_next:
            clicked_next = click_exact_text(page, "Next", real_click=True)

        if clicked_next:
            wait_until(
                page,
                "(() => { const body = document.body.innerText || ''; return body.includes('Post settings') || !!document.querySelector('[aria-label=\"Post\"][role=\"button\"]') || [...document.querySelectorAll('button,[role=button],a,div,span')].some((node) => ((node.innerText || node.getAttribute('aria-label') || '').trim()) === 'Post'); })()",
                timeout=20.0,
            )

    wait_until(
        page,
        "(() => !!document.querySelector('[aria-label=\"Post\"][role=\"button\"]') || [...document.querySelectorAll('button,[role=button],a,div,span')].some((node) => ((node.innerText || node.getAttribute('aria-label') || '').trim()) === 'Post'))()",
        timeout=20.0,
    )

    if not click_selector_center(page, '[aria-label="Post"][role="button"]', index=0):
        if not click_exact_text(page, "Post", real_click=True):
            raise RuntimeError("Could not find the Facebook Page Post action.")

    wait_until(
        page,
        "(() => { const body = document.body.innerText || ''; return !body.includes('Post settings') && !body.includes('Create post'); })()",
        timeout=45.0,
    )

    page.navigate(page_url)
    summary_line = next((line.strip() for line in full_caption.splitlines() if line.strip()), page_name)
    wait_until(
        page,
        f"(() => (document.body.innerText || '').includes({js_string(summary_line)}) && (document.body.innerText || '').includes({js_string(page_name)}))()",
        timeout=45.0,
    )
    time.sleep(2.0)
    return {
        "status": "posted",
        "channel": "facebook_page",
        "postedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pageUrl": page_url,
        "bodySnippet": str(page.evaluate("(document.body.innerText || '').slice(0, 1200)")),
        "delivery": "facebook_page_browser",
    }


def post_to_facebook_business_suite(
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
    if not click_exact_text(page, "Publish", real_click=True):
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
        "delivery": "meta_business_suite_browser",
    }


def post_to_facebook(
    page: CdpPage,
    *,
    caption: str,
    destination_url: str,
    business_id: str,
    social_profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    if resolve_facebook_page_profile_url(social_profiles, business_id):
        return post_to_facebook_page(
            page,
            caption=caption,
            destination_url=destination_url,
            business_id=business_id,
            social_profiles=social_profiles,
        )

    return post_to_facebook_business_suite(
        page,
        caption=caption,
        business_id=business_id,
        social_profiles=social_profiles,
    )


def post_to_facebook_api(
    *,
    caption: str,
    asset_path: str,
    destination_url: str,
    business_id: str,
    social_profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    page_id = resolve_facebook_page_id(social_profiles, business_id)
    if not page_id:
        raise RuntimeError(
            "Could not resolve the Facebook Page id. Set META_PAGE_ID or store the page externalId in socialProfiles.json."
        )

    access_token = resolve_meta_page_access_token()
    if not access_token:
        raise RuntimeError(
            "META_PAGE_ACCESS_TOKEN is not configured. Add a Page access token with pages_manage_posts before using Meta API posting."
        )

    graph_version = resolve_meta_graph_api_version()
    profile_url = resolve_profile_url(social_profiles, business_id, "facebook_page")
    full_caption = append_destination_url(caption, destination_url)
    posted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    asset = Path(asset_path)
    if asset_path and asset.exists():
        mime_type = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
        response = http_post_json(
            f"https://graph.facebook.com/{graph_version}/{page_id}/photos",
            fields={
                "access_token": access_token,
                "caption": full_caption,
                "published": "true",
            },
            files=[("source", asset.name, mime_type, asset.read_bytes())],
        )
        graph_object_id = str(response.get("id") or "")
        graph_post_id = str(response.get("post_id") or graph_object_id)
    else:
        feed_fields = {
            "access_token": access_token,
            "message": full_caption,
        }
        if destination_url.strip():
            feed_fields["link"] = destination_url.strip()
        response = http_post_json(
            f"https://graph.facebook.com/{graph_version}/{page_id}/feed",
            fields=feed_fields,
        )
        graph_object_id = str(response.get("id") or "")
        graph_post_id = graph_object_id

    return {
        "status": "posted",
        "channel": "facebook_page",
        "postedAt": posted_at,
        "pageUrl": build_facebook_post_url(page_id, graph_post_id, profile_url),
        "pageId": page_id,
        "graphObjectId": graph_object_id,
        "graphPostId": graph_post_id,
        "delivery": "meta_graph_api",
    }


def post_to_instagram_api(
    *,
    caption: str,
    asset_path: str,
    asset_url: str,
    destination_url: str,
    business_id: str,
    social_profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    access_token = resolve_meta_instagram_access_token()
    if not access_token:
        raise RuntimeError(
            "META_INSTAGRAM_ACCESS_TOKEN or META_PAGE_ACCESS_TOKEN is not configured. Add a token with instagram_content_publish before using Instagram automation."
        )

    graph_version = resolve_meta_graph_api_version()
    instagram_account_id = resolve_instagram_business_account_id(
        social_profiles,
        business_id,
        graph_version=graph_version,
        access_token=access_token,
    )
    if not instagram_account_id:
        raise RuntimeError(
            "Could not resolve the Instagram business account id. Set META_INSTAGRAM_ACCOUNT_ID or connect the account to the configured Facebook Page."
        )

    public_asset_url = resolve_public_asset_url(asset_path, asset_url, destination_url)
    if not public_asset_url:
        raise RuntimeError(
            "Instagram publishing requires a public image URL. Generate a teaser under runtime/agency-site or provide assetUrl in the queue item."
        )

    full_caption = append_destination_url(caption, destination_url)
    creation = http_post_json(
        f"https://graph.facebook.com/{graph_version}/{instagram_account_id}/media",
        fields={
            "access_token": access_token,
            "image_url": public_asset_url,
            "caption": full_caption,
        },
    )
    creation_id = str(creation.get("id") or "").strip()
    if not creation_id:
        raise RuntimeError("Instagram media creation did not return a creation id.")

    wait_for_instagram_media_ready(
        creation_id,
        access_token=access_token,
        graph_version=graph_version,
    )
    publish = http_post_json(
        f"https://graph.facebook.com/{graph_version}/{instagram_account_id}/media_publish",
        fields={
            "access_token": access_token,
            "creation_id": creation_id,
        },
    )
    media_id = str(publish.get("id") or "").strip()
    profile_url = resolve_profile_url(social_profiles, business_id, "instagram_account")
    posted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "status": "posted",
        "channel": "instagram_account",
        "postedAt": posted_at,
        "pageUrl": profile_url or destination_url,
        "instagramAccountId": instagram_account_id,
        "creationId": creation_id,
        "mediaId": media_id,
        "assetUrl": public_asset_url,
        "delivery": "meta_graph_api",
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
    load_env_file()
    args = parse_args()
    queue = load_json(args.queue_file)
    social_profiles = load_json(args.social_profiles_file)
    item = next((entry for entry in queue if entry.get("id") == args.item_id), None)
    if not item:
        raise SystemExit(f"Could not find growth queue item {args.item_id!r}.")

    channel = str(item.get("channel") or "")

    if channel == "facebook_page" and resolve_meta_page_access_token():
        result = post_to_facebook_api(
            caption=str(item.get("caption") or "").strip(),
            asset_path=str(item.get("assetPath") or "").strip(),
            destination_url=str(item.get("destinationUrl") or "").strip(),
            business_id=str(item.get("businessId") or ""),
            social_profiles=social_profiles,
        )
        print(json.dumps(result, indent=2))
        return

    if channel == "instagram_account":
        result = post_to_instagram_api(
            caption=str(item.get("caption") or "").strip(),
            asset_path=str(item.get("assetPath") or "").strip(),
            asset_url=str(item.get("assetUrl") or "").strip(),
            destination_url=str(item.get("destinationUrl") or "").strip(),
            business_id=str(item.get("businessId") or ""),
            social_profiles=social_profiles,
        )
        print(json.dumps(result, indent=2))
        return

    if channel == "facebook_page":
        start_url = "https://business.facebook.com/"
    elif channel == "pinterest":
        start_url = "https://www.pinterest.com/pin-builder/"
    else:
        raise SystemExit(f"Unsupported growth channel for live posting: {channel}")

    try:
        port = args.port or detect_mcp_chrome_port()
    except Exception as error:
        if channel == "facebook_page":
            raise SystemExit(
                "META_PAGE_ACCESS_TOKEN is not configured and no live Meta browser session is available."
            ) from error
        raise

    tab = open_new_tab(port, start_url)
    page = CdpPage(tab["webSocketDebuggerUrl"])
    page.enable()

    try:
        if channel == "facebook_page":
            result = post_to_facebook(
                page,
                caption=str(item.get("caption") or "").strip(),
                destination_url=str(item.get("destinationUrl") or "").strip(),
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
