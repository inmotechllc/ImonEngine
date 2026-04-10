from __future__ import annotations

import argparse
import imaplib
import json
import sys
from datetime import datetime, timedelta, timezone
from email import policy
from email.header import decode_header, make_header
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


DEFAULT_LOOKBACK_DAYS = 30
MAX_FETCH_MESSAGES = 250


class HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self._skip_depth += 1
        if self._skip_depth == 0 and tag in {"br", "p", "div", "li", "tr"}:
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._skip_depth > 0:
            self._skip_depth -= 1
        if self._skip_depth == 0 and tag in {"p", "div", "li", "tr"}:
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._chunks.append(data)

    def text(self) -> str:
        return normalize_space("".join(self._chunks))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec-file", required=True)
    return parser.parse_args()


def normalize_space(value: str) -> str:
    return " ".join(value.split())


def normalize_email(value: str | None) -> str:
    return normalize_space(value or "").strip("<>").lower()


def decode_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return str(value)


def normalize_subject(value: str | None) -> str:
    subject = normalize_space(decode_value(value)).lower()
    changed = True
    while changed:
        changed = False
        for prefix in ("re:", "fw:", "fwd:"):
            if subject.startswith(prefix):
                subject = normalize_space(subject[len(prefix) :])
                changed = True
    return subject


def subject_matches(candidate_subject: str, message_subject: str) -> bool:
    if not candidate_subject or not message_subject:
      return False
    return (
        candidate_subject == message_subject
        or candidate_subject in message_subject
        or message_subject in candidate_subject
    )


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_imap_since(value: datetime) -> str:
    return value.strftime("%d-%b-%Y")


def message_datetime(message: Any) -> datetime | None:
    raw_date = decode_value(message.get("Date"))
    if not raw_date:
        return None
    try:
        parsed = parsedate_to_datetime(raw_date)
    except Exception:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def message_addresses(message: Any, *header_names: str) -> list[str]:
    values: list[str] = []
    for header_name in header_names:
        values.extend(message.get_all(header_name, []))
    return [
        normalize_email(address)
        for _name, address in getaddresses([decode_value(value) for value in values])
        if normalize_email(address)
    ]


def message_target_addresses(message: Any) -> list[str]:
    return message_addresses(
        message,
        "To",
        "Cc",
        "Delivered-To",
        "X-Original-To",
        "Original-Recipient",
        "Envelope-To",
        "X-Envelope-To",
        "Resent-To"
    )


def message_thread_id(message: Any, fallback_uid: str) -> str:
    for header_name in ("References", "In-Reply-To", "Thread-Index", "Message-ID"):
        value = normalize_space(decode_value(message.get(header_name)))
        if value:
            return value
    return fallback_uid


def message_message_id(message: Any, fallback_uid: str) -> str:
    value = normalize_space(decode_value(message.get("Message-ID")))
    return value or fallback_uid


def extract_body_text(message: Any) -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []

    for part in message.walk() if message.is_multipart() else [message]:
        if part.get_content_disposition() == "attachment":
            continue
        content_type = part.get_content_type()
        try:
            payload = part.get_payload(decode=True)
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace") if payload is not None else part.get_content()
        except Exception:
            continue
        if not isinstance(text, str):
            text = str(text)
        if content_type == "text/plain":
            normalized = normalize_space(text)
            if normalized:
                plain_parts.append(normalized)
        elif content_type == "text/html":
            parser = HtmlTextExtractor()
            parser.feed(text)
            parser.close()
            normalized = parser.text()
            if normalized:
                html_parts.append(normalized)

    if plain_parts:
        return plain_parts[0]
    if html_parts:
        return html_parts[0]
    return ""


def load_spec(path: str) -> dict[str, Any]:
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(spec, dict):
        raise ValueError("Spec file must contain a top-level object.")
    if not isinstance(spec.get("candidates"), list):
        raise ValueError("Spec file must contain a top-level candidates array.")
    if not isinstance(spec.get("imap"), dict):
        raise ValueError("Spec file must contain a top-level imap object.")
    return spec


def connect_imap(imap_config: dict[str, Any]) -> imaplib.IMAP4:
    host = normalize_space(str(imap_config.get("host") or ""))
    user = normalize_space(str(imap_config.get("user") or ""))
    password = str(imap_config.get("pass") or "")
    secure = bool(imap_config.get("secure", True))
    port = int(imap_config.get("port") or (993 if secure else 143))

    if not host or not user or not password:
        raise ValueError("IMAP host, user, and pass are required.")

    client: imaplib.IMAP4
    if secure:
        client = imaplib.IMAP4_SSL(host, port)
    else:
        client = imaplib.IMAP4(host, port)
    client.login(user, password)
    return client


def find_reply_matches(spec: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = spec["candidates"]
    imap_config = spec["imap"]
    mailbox = normalize_space(str(imap_config.get("mailbox") or "INBOX")) or "INBOX"
    alias_address = normalize_email(spec.get("aliasAddress"))

    prepared: list[dict[str, Any]] = []
    valid_candidate_indexes: list[int] = []
    recipient_index: dict[str, list[int]] = {}
    earliest_sent_at: datetime | None = None

    for index, candidate in enumerate(candidates):
        lead_id = str(candidate.get("leadId") or "").strip()
        recipient = normalize_email(candidate.get("recipient"))
        subject = normalize_subject(candidate.get("subject"))
        sent_at = parse_iso_datetime(candidate.get("sentAt"))
        result = {
            "leadId": lead_id,
            "recipient": candidate.get("recipient"),
            "subject": candidate.get("subject")
        }
        if not lead_id or not recipient or not subject:
            prepared.append(
                {
                    **result,
                    "status": "error",
                    "reason": "Missing leadId, recipient, or subject in inbox sync candidate."
                }
            )
            continue
        prepared.append(
            {
                **result,
                "status": "no_reply"
            }
        )
        valid_candidate_indexes.append(index)
        recipient_index.setdefault(recipient, []).append(index)
        if sent_at is not None and (earliest_sent_at is None or sent_at < earliest_sent_at):
            earliest_sent_at = sent_at
        candidates[index]["_normalizedRecipient"] = recipient
        candidates[index]["_normalizedSubject"] = subject
        candidates[index]["_sentAtParsed"] = sent_at

    if not valid_candidate_indexes:
        return prepared

    since = (earliest_sent_at or datetime.now(timezone.utc) - timedelta(days=DEFAULT_LOOKBACK_DAYS)) - timedelta(days=1)
    recipient_pool = set(recipient_index.keys())

    client = connect_imap(imap_config)
    try:
        status, _ = client.select(mailbox, readonly=True)
        if status != "OK":
            raise RuntimeError(f"Could not open IMAP mailbox {mailbox}.")

        status, data = client.uid("search", None, "SINCE", format_imap_since(since))
        if status != "OK":
            raise RuntimeError("IMAP search did not complete successfully.")

        uids = [uid.decode("utf-8") for uid in (data[0] or b"").split() if uid]
        remaining = set(valid_candidate_indexes)

        for uid in reversed(uids[-MAX_FETCH_MESSAGES:]):
            if not remaining:
                break

            status, response = client.uid("fetch", uid, "(BODY.PEEK[])")
            if status != "OK":
                continue

            raw_message = next(
                (
                    part[1]
                    for part in response
                    if isinstance(part, tuple) and len(part) > 1 and isinstance(part[1], (bytes, bytearray))
                ),
                None,
            )
            if raw_message is None:
                continue

            try:
                message = BytesParser(policy=policy.default).parsebytes(raw_message)
            except Exception:
                continue

            sender_addresses = set(message_addresses(message, "From", "Reply-To", "Sender"))
            if not sender_addresses or sender_addresses.isdisjoint(recipient_pool):
                continue

            target_addresses = set(message_target_addresses(message))
            if alias_address and alias_address not in target_addresses:
                continue

            normalized_subject = normalize_subject(message.get("Subject"))
            if not normalized_subject:
                continue

            body = extract_body_text(message)
            if not body:
                continue

            received_at = message_datetime(message)
            received_at_iso = received_at.isoformat().replace("+00:00", "Z") if received_at else None
            from_address = next(iter(sender_addresses), "")
            thread_id = message_thread_id(message, uid)
            message_id = message_message_id(message, uid)
            raw_subject = normalize_space(decode_value(message.get("Subject"))) or candidates[0].get("subject")

            for sender_address in sender_addresses:
                for candidate_index in recipient_index.get(sender_address, []):
                    if candidate_index not in remaining:
                        continue
                    candidate = candidates[candidate_index]
                    if not subject_matches(candidate["_normalizedSubject"], normalized_subject):
                        continue
                    sent_at = candidate.get("_sentAtParsed")
                    if sent_at is not None and received_at is not None and received_at < sent_at:
                        continue

                    prepared[candidate_index] = {
                        "leadId": candidate.get("leadId"),
                        "status": "reply_found",
                        "recipient": candidate.get("recipient"),
                        "subject": raw_subject or candidate.get("subject"),
                        "externalThreadId": thread_id,
                        "externalMessageId": message_id,
                        "fromAddress": from_address,
                        "body": body,
                        "receivedAt": received_at_iso,
                    }
                    remaining.remove(candidate_index)
                    break
    finally:
        try:
            client.logout()
        except Exception:
            pass

    return prepared


def main() -> int:
    args = parse_args()
    try:
        spec = load_spec(args.spec_file)
        results = find_reply_matches(spec)
        print(
            json.dumps(
                {
                    "status": "ok",
                    "checked": len(results),
                    "results": results,
                },
                indent=2,
            )
        )
        return 0
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "error",
                    "reason": str(error),
                },
                indent=2,
            )
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())