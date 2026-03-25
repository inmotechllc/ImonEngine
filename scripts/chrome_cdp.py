from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

try:
    import websocket
except ImportError as exc:  # pragma: no cover - runtime dependency check
    raise SystemExit(
        "Missing dependency: websocket-client. Install with "
        "`python -m pip install --user websocket-client`."
    ) from exc


def _run_powershell(command: str) -> str:
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def _port_has_devtools(port: int) -> bool:
    try:
        http_json(port, "/json/version")
    except Exception:
        return False
    return True


def _candidate_ports() -> list[int]:
    ports: list[int] = []
    for env_name in (
        "CHROME_REMOTE_DEBUGGING_PORT",
        "VPS_CHROME_REMOTE_DEBUGGING_PORT",
        "REMOTE_DEBUG_PORT",
    ):
        value = os.environ.get(env_name)
        if value and value.isdigit():
            ports.append(int(value))

    if sys.platform == "win32":
        try:
            command = (
                "Get-CimInstance Win32_Process | "
                "Where-Object { $_.Name -eq 'chrome.exe' -and "
                "$_.CommandLine -match '--remote-debugging-port=' } | "
                "Select-Object -ExpandProperty CommandLine"
            )
            output = _run_powershell(command)
            for line in output.splitlines():
                match = re.search(r"--remote-debugging-port=(\d+)", line)
                if match:
                    ports.append(int(match.group(1)))
        except RuntimeError:
            pass

    ports.extend([9222, 9223, 9229])
    deduped: list[int] = []
    for port in ports:
        if port not in deduped:
            deduped.append(port)
    return deduped


def detect_mcp_chrome_port() -> int:
    for port in _candidate_ports():
        if _port_has_devtools(port):
            return port
    raise RuntimeError(
        "No active Chrome remote debugging port was found. "
        "Keep the automation browser open first."
    )


def http_json(port: int, path: str) -> Any:
    url = f"http://127.0.0.1:{port}{path}"
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.load(response)


def open_new_tab(port: int, url: str) -> dict[str, Any]:
    encoded = urllib.parse.quote(url, safe="")
    request = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?{encoded}", method="PUT")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def close_tab(port: int, tab_id: str) -> None:
    request = urllib.request.Request(f"http://127.0.0.1:{port}/json/close/{tab_id}", method="PUT")
    with urllib.request.urlopen(request, timeout=10):
        return


def find_tab(
    tabs: list[dict[str, Any]],
    *,
    tab_id: str | None,
    url_substring: str | None,
    title_substring: str | None,
) -> dict[str, Any]:
    pages = [tab for tab in tabs if tab.get("type") == "page"]
    if tab_id:
        for tab in pages:
            if tab.get("id") == tab_id:
                return tab
        raise RuntimeError(f"No tab found for id {tab_id!r}.")
    for tab in pages:
        if url_substring and url_substring in tab.get("url", ""):
            return tab
        if title_substring and title_substring in tab.get("title", ""):
            return tab
    if len(pages) == 1:
        return pages[0]
    raise RuntimeError(
        "Could not determine a target tab. Pass --tab-id, "
        "--tab-url-substring, or --tab-title-substring."
    )


class CdpPage:
    def __init__(self, ws_url: str) -> None:
        self._ws = websocket.create_connection(
            ws_url,
            timeout=20,
            suppress_origin=True,
        )
        self._next_id = 0

    def close(self) -> None:
        self._ws.close()

    def send(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._next_id += 1
        message_id = self._next_id
        self._ws.send(
            json.dumps(
                {"id": message_id, "method": method, "params": params or {}}
            )
        )
        while True:
            response = json.loads(self._ws.recv())
            if response.get("id") != message_id:
                continue
            if "error" in response:
                raise RuntimeError(str(response["error"]))
            return response.get("result", {})

    def evaluate(self, expression: str, *, by_value: bool = True) -> Any:
        result = self.send(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": by_value,
            },
        )
        return result.get("result", {}).get("value")

    def enable(self) -> None:
        self.send("Page.enable")
        self.send("Runtime.enable")
        self.send("DOM.enable")
        self.send("Page.bringToFront")

    def set_input_value(self, selector: str, value: str) -> str:
        expression = f"""
(() => {{
  const el = document.querySelector({json.dumps(selector)});
  if (!el) return 'missing';
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, {json.dumps(value)});
  else el.value = {json.dumps(value)};
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return el.value;
}})()
"""
        return self.evaluate(expression)

    def click_button_text(self, text: str) -> str:
        expression = f"""
(() => {{
  const button = [...document.querySelectorAll('button')]
    .find((btn) => (btn.innerText || '').trim() === {json.dumps(text)});
  if (!button) return 'missing';
  button.click();
  return 'clicked';
}})()
"""
        return self.evaluate(expression)

    def click_selector(self, selector: str) -> str:
        expression = f"""
(() => {{
  const el = document.querySelector({json.dumps(selector)});
  if (!el) return 'missing';
  el.click();
  return 'clicked';
}})()
"""
        return self.evaluate(expression)

    def navigate(self, url: str) -> None:
        self.send("Page.navigate", {"url": url})

    def upload_files(self, selector: str, index: int, files: list[str]) -> None:
        document = self.send("DOM.getDocument", {"depth": -1, "pierce": True})
        node_ids = self.send(
            "DOM.querySelectorAll",
            {"nodeId": document["root"]["nodeId"], "selector": selector},
        )["nodeIds"]
        if index >= len(node_ids):
            raise RuntimeError(
                f"Selector {selector!r} returned {len(node_ids)} elements, "
                f"but index {index} was requested."
            )
        self.send(
            "DOM.setFileInputFiles",
            {"nodeId": node_ids[index], "files": files},
        )

    def screenshot(self, output_path: Path) -> None:
        result = self.send("Page.captureScreenshot", {"format": "png", "fromSurface": True})
        output_path.write_bytes(base64.b64decode(result["data"]))


def add_tab_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--port", type=int, help="Chrome remote debugging port.")
    parser.add_argument("--tab-id")
    parser.add_argument("--tab-url-substring")
    parser.add_argument("--tab-title-substring")


def resolve_page(args: argparse.Namespace) -> tuple[int, dict[str, Any], CdpPage]:
    port = args.port or detect_mcp_chrome_port()
    tabs = http_json(port, "/json/list")
    tab = find_tab(
        tabs,
        tab_id=args.tab_id,
        url_substring=args.tab_url_substring,
        title_substring=args.tab_title_substring,
    )
    page = CdpPage(tab["webSocketDebuggerUrl"])
    page.enable()
    return port, tab, page


def cmd_list_tabs(args: argparse.Namespace) -> None:
    port = args.port or detect_mcp_chrome_port()
    tabs = http_json(port, "/json/list")
    print(json.dumps(tabs, indent=2))


def cmd_eval(args: argparse.Namespace) -> None:
    _, _, page = resolve_page(args)
    try:
        value = page.evaluate(args.expression)
        if isinstance(value, (dict, list)):
            print(json.dumps(value, indent=2))
        else:
            print(value)
    finally:
        page.close()


def cmd_set_input(args: argparse.Namespace) -> None:
    _, _, page = resolve_page(args)
    try:
        print(page.set_input_value(args.selector, args.value))
    finally:
        page.close()


def cmd_click_button(args: argparse.Namespace) -> None:
    _, _, page = resolve_page(args)
    try:
        print(page.click_button_text(args.text))
    finally:
        page.close()


def cmd_click_selector(args: argparse.Namespace) -> None:
    _, _, page = resolve_page(args)
    try:
        print(page.click_selector(args.selector))
    finally:
        page.close()


def cmd_navigate(args: argparse.Namespace) -> None:
    _, _, page = resolve_page(args)
    try:
        page.navigate(args.url)
        print(args.url)
    finally:
        page.close()


def cmd_upload(args: argparse.Namespace) -> None:
    _, _, page = resolve_page(args)
    try:
        files = [str(Path(path).resolve()) for path in args.files]
        page.upload_files(args.selector, args.index, files)
        print(json.dumps({"selector": args.selector, "index": args.index, "files": files}, indent=2))
    finally:
        page.close()


def cmd_screenshot(args: argparse.Namespace) -> None:
    _, _, page = resolve_page(args)
    try:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(output_path)
        print(str(output_path))
    finally:
        page.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Attach to the persistent Codex Chrome session through CDP."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_tabs = subparsers.add_parser("list-tabs")
    list_tabs.add_argument("--port", type=int)
    list_tabs.set_defaults(func=cmd_list_tabs)

    eval_cmd = subparsers.add_parser("eval")
    add_tab_args(eval_cmd)
    eval_cmd.add_argument("expression")
    eval_cmd.set_defaults(func=cmd_eval)

    set_input = subparsers.add_parser("set-input")
    add_tab_args(set_input)
    set_input.add_argument("--selector", required=True)
    set_input.add_argument("--value", required=True)
    set_input.set_defaults(func=cmd_set_input)

    click_button = subparsers.add_parser("click-button")
    add_tab_args(click_button)
    click_button.add_argument("--text", required=True)
    click_button.set_defaults(func=cmd_click_button)

    click_selector = subparsers.add_parser("click-selector")
    add_tab_args(click_selector)
    click_selector.add_argument("--selector", required=True)
    click_selector.set_defaults(func=cmd_click_selector)

    navigate = subparsers.add_parser("navigate")
    add_tab_args(navigate)
    navigate.add_argument("--url", required=True)
    navigate.set_defaults(func=cmd_navigate)

    upload = subparsers.add_parser("upload")
    add_tab_args(upload)
    upload.add_argument("--selector", required=True)
    upload.add_argument("--index", type=int, default=0)
    upload.add_argument("files", nargs="+")
    upload.set_defaults(func=cmd_upload)

    screenshot = subparsers.add_parser("screenshot")
    add_tab_args(screenshot)
    screenshot.add_argument("--output", required=True)
    screenshot.set_defaults(func=cmd_screenshot)

    return parser


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
