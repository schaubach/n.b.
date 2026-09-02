import json
import hmac
import base64
import hashlib
import imaplib
import logging
import os
import re
import smtplib
import ssl
import subprocess
import time
from collections import defaultdict, deque
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import formatdate, make_msgid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("nb-mail-backend")


def env_int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


PSK = os.getenv("NB_MAIL_PSK", "")
SMTP_HOST = os.getenv("SMTP_HOST", "rbbk-do.de")
SMTP_PORT = env_int("SMTP_PORT", 587)
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "true").lower() in {"1", "true", "yes", "on"}
IMAP_HOST = os.getenv("IMAP_HOST", SMTP_HOST)
IMAP_PORT = env_int("IMAP_PORT", 993)
IMAP_SSL = os.getenv("IMAP_SSL", "true").lower() in {"1", "true", "yes", "on"}
IMAP_STARTTLS = os.getenv("IMAP_STARTTLS", "false").lower() in {"1", "true", "yes", "on"}
ALLOWED_DOMAIN = os.getenv("ALLOWED_DOMAIN", "rbbk-do.de").lower().lstrip("@")
ALLOWED_SENDERS = {
    address.strip().lower()
    for address in os.getenv("ALLOWED_SENDERS", "").split(",")
    if address.strip()
}
MAX_RECIPIENTS = env_int("MAX_RECIPIENTS_PER_REQUEST", 35)
MAX_MESSAGE_BYTES = env_int("MAX_MESSAGE_BYTES", 12000000)
MAX_SUBJECT_LENGTH = env_int("MAX_SUBJECT_LENGTH", 180)
TIMESTAMP_WINDOW_SECONDS = env_int("TIMESTAMP_WINDOW_SECONDS", 300)
NONCE_TTL_SECONDS = env_int("NONCE_TTL_SECONDS", 900)
RATE_LIMIT_PER_MINUTE = env_int("RATE_LIMIT_PER_MINUTE", 80)
RATE_LIMIT_PER_HOUR = env_int("RATE_LIMIT_PER_HOUR", 400)
RATE_LIMIT_PER_DAY = env_int("RATE_LIMIT_PER_DAY", 1200)
ALLOWED_ORIGINS = {origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()}
SERVER_NAME = os.getenv("SERVER_NAME", "")
BACKEND_IDENTITY_KEY = os.getenv("BACKEND_IDENTITY_KEY", "/app/identity/private.pem")
BACKEND_IDENTITY_PUBLIC_KEY = os.getenv("BACKEND_IDENTITY_PUBLIC_KEY", "/app/identity/public.pem")

used_nonces = {}
rate_events = defaultdict(deque)


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    add_cors(handler)
    handler.end_headers()
    handler.wfile.write(body)


def add_cors(handler):
    origin = handler.headers.get("Origin")
    if origin and (origin in ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS):
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Vary", "Origin")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type, X-NB-Timestamp, X-NB-Nonce, X-NB-Signature")
        handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")


def client_key(handler, teacher_email=""):
    forwarded = handler.headers.get("X-Forwarded-For", "")
    ip = forwarded.split(",")[0].strip() or handler.client_address[0]
    return f"{ip}:{teacher_email.lower()}"


def cleanup_nonces(now):
    expired = [nonce for nonce, ts in used_nonces.items() if now - ts > NONCE_TTL_SECONDS]
    for nonce in expired:
        used_nonces.pop(nonce, None)


def check_rate_limit(key, now):
    events = rate_events[key]
    day_window = 24 * 60 * 60
    while events and now - events[0] > day_window:
        events.popleft()
    minute_count = sum(1 for item in events if now - item <= 60)
    hour_count = sum(1 for item in events if now - item <= 3600)
    if minute_count >= RATE_LIMIT_PER_MINUTE:
        raise RequestError(429, "Rate-Limit pro Minute erreicht.")
    if hour_count >= RATE_LIMIT_PER_HOUR:
        raise RequestError(429, "Rate-Limit pro Stunde erreicht.")
    if len(events) >= RATE_LIMIT_PER_DAY:
        raise RequestError(429, "Rate-Limit pro Tag erreicht.")
    events.append(now)


def domain_ok(address):
    return isinstance(address, str) and address.lower().endswith("@" + ALLOWED_DOMAIN)


def sender_ok(address):
    if not domain_ok(address):
        return False
    return not ALLOWED_SENDERS or address.lower() in ALLOWED_SENDERS


def smtp_login_candidates(sender):
    candidates = []
    sender = str(sender or "").strip().lower()
    if "@" in sender:
        local_part = sender.split("@", 1)[0].strip()
        if local_part:
            candidates.append(("Benutzername ohne Domain", local_part))
    if sender and sender not in {candidate[1] for candidate in candidates}:
        candidates.append(("Mailadresse", sender))
    return candidates


def smtp_error_text(error):
    code = getattr(error, "smtp_code", "unbekannt")
    detail = getattr(error, "smtp_error", "")
    if isinstance(detail, bytes):
        detail = detail.decode("utf-8", "replace")
    detail = " ".join(str(detail or "").split())
    if len(detail) > 260:
        detail = detail[:257] + "..."
    return code, detail or "keine SMTP-Detailantwort"


def smtp_auth_failure_message(attempts):
    tried = ", ".join(f"{item['label']}={item['username']}" for item in attempts) or "keine"
    last = attempts[-1] if attempts else {}
    code = last.get("code", "unbekannt")
    detail = last.get("detail", "keine SMTP-Detailantwort")
    starttls = "ja" if SMTP_STARTTLS else "nein"
    return (
        "SMTP-Anmeldung fehlgeschlagen. "
        f"Server={SMTP_HOST}, Port={SMTP_PORT}, STARTTLS={starttls}. "
        f"Versuchte Logins: {tried}. "
        f"Letzte SMTP-Antwort: {code} {detail}. "
        "Hinweis: Einige IServ-Installationen erwarten als SMTP-Benutzername nur den Accountnamen ohne @Domain."
    )


def login_smtp(smtp, sender, password):
    attempts = []
    for label, username in smtp_login_candidates(sender):
        try:
            smtp.login(username, password)
            if username != sender:
                logger.info("smtp login succeeded sender=%s username=%s", sender, username)
            return username
        except smtplib.SMTPAuthenticationError as error:
            code, detail = smtp_error_text(error)
            attempts.append({"label": label, "username": username, "code": code, "detail": detail})
            logger.warning("smtp authentication failed sender=%s username=%s code=%s detail=%s", sender, username, code, detail)
    raise RequestError(401, smtp_auth_failure_message(attempts))


def safe_protocol_detail(error):
    detail = " ".join(str(error or "").split()) or "keine Detailantwort"
    return detail[:257] + "..." if len(detail) > 260 else detail


def login_imap(imap, sender, password):
    attempts = []
    for label, username in smtp_login_candidates(sender):
        try:
            status, _ = imap.login(username, password)
            if status != "OK":
                raise imaplib.IMAP4.error(f"Status {status}")
            if username != sender:
                logger.info("imap login succeeded sender=%s username=%s", sender, username)
            return username
        except imaplib.IMAP4.error as error:
            detail = safe_protocol_detail(error)
            attempts.append({"label": label, "username": username, "detail": detail})
            logger.warning("imap authentication failed sender=%s username=%s detail=%s", sender, username, detail)
    tried = ", ".join(f"{item['label']}={item['username']}" for item in attempts) or "keine"
    detail = attempts[-1]["detail"] if attempts else "keine Detailantwort"
    raise RequestError(
        401,
        f"IMAP-Anmeldung fehlgeschlagen. Server={IMAP_HOST}, Port={IMAP_PORT}, "
        f"SSL={'ja' if IMAP_SSL else 'nein'}, STARTTLS={'ja' if IMAP_STARTTLS else 'nein'}. "
        f"Versuchte Logins: {tried}. Letzte IMAP-Antwort: {detail}.",
    )


def decode_modified_utf7(value):
    result = []
    index = 0
    while index < len(value):
        marker = value.find("&", index)
        if marker < 0:
            result.append(value[index:])
            break
        result.append(value[index:marker])
        end = value.find("-", marker)
        if end < 0:
            result.append(value[marker:])
            break
        encoded = value[marker + 1:end]
        if not encoded:
            result.append("&")
        else:
            padding = "=" * ((4 - len(encoded) % 4) % 4)
            try:
                raw = base64.b64decode(encoded.replace(",", "/") + padding)
                result.append(raw.decode("utf-16-be"))
            except (ValueError, UnicodeDecodeError):
                result.append(value[marker:end + 1])
        index = end + 1
    return "".join(result)


def unquote_imap_value(value):
    value = value.strip()
    if value.upper() == b"NIL":
        return ""
    if len(value) >= 2 and value[:1] == b'"' and value[-1:] == b'"':
        value = value[1:-1].replace(b'\\"', b'"').replace(b"\\\\", b"\\")
    return value.decode("ascii", "replace")


def parse_imap_mailbox(item):
    if not isinstance(item, bytes):
        return None
    match = re.match(rb'^\(([^)]*)\)\s+(NIL|"(?:\\.|[^"])*")\s+(.+)$', item.strip())
    if not match:
        return None
    flags = {flag.decode("ascii", "ignore").lower() for flag in match.group(1).split()}
    delimiter = unquote_imap_value(match.group(2))
    mailbox = unquote_imap_value(match.group(3))
    return {
        "flags": flags,
        "delimiter": delimiter,
        "mailbox": mailbox,
        "display": decode_modified_utf7(mailbox),
    }


def find_sent_mailbox(items):
    mailboxes = [parsed for parsed in (parse_imap_mailbox(item) for item in (items or [])) if parsed]
    for mailbox in mailboxes:
        if "\\sent" in mailbox["flags"]:
            return mailbox, mailboxes

    expected = {
        "sent", "sent items", "sent messages", "gesendet", "gesendete elemente",
        "gesendete objekte", "gesendete nachrichten",
    }
    for mailbox in mailboxes:
        display = mailbox["display"].strip()
        delimiter = mailbox["delimiter"]
        leaf = display.split(delimiter)[-1] if delimiter else display
        normalized = " ".join(leaf.lower().replace("_", " ").replace("-", " ").split())
        if normalized in expected:
            return mailbox, mailboxes
    return None, mailboxes


def connect_sent_mailbox(sender, password):
    context = ssl.create_default_context()
    try:
        if IMAP_SSL:
            imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context, timeout=30)
        else:
            imap = imaplib.IMAP4(IMAP_HOST, IMAP_PORT, timeout=30)
            if IMAP_STARTTLS:
                imap.starttls(ssl_context=context)
    except Exception as error:
        raise RequestError(502, f"IMAP-Verbindung fehlgeschlagen. Server={IMAP_HOST}, Port={IMAP_PORT}: {safe_protocol_detail(error)}")

    try:
        login_imap(imap, sender, password)
        status, items = imap.list()
        if status != "OK":
            raise RequestError(502, f"IMAP-Ordnerliste konnte nicht geladen werden: Status {status}.")
        sent, mailboxes = find_sent_mailbox(items)
        if not sent:
            available = ", ".join(mailbox["display"] for mailbox in mailboxes[:20]) or "keine lesbaren Ordner"
            raise RequestError(502, f"Gesendet-Ordner konnte per IMAP nicht ermittelt werden. Gefundene Ordner: {available}.")
        logger.info("imap sent mailbox selected sender=%s mailbox=%s", sender, sent["display"])
        return imap, sent
    except Exception:
        try:
            imap.logout()
        except Exception:
            pass
        raise


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def public_key_fingerprint():
    try:
        with open(BACKEND_IDENTITY_PUBLIC_KEY, "rb") as public_key_file:
            public_key = public_key_file.read()
    except OSError:
        raise RequestError(500, "Backend-Identitaet ist nicht vollstaendig konfiguriert.")
    return hashlib.sha256(public_key).hexdigest()


def signed_identity(challenge):
    if not challenge or len(challenge) > 160:
        raise RequestError(400, "Identity-Challenge fehlt oder ist zu lang.")
    payload = {
        "app": "n.b.",
        "challenge": challenge,
        "serverName": SERVER_NAME,
        "publicKeySha256": public_key_fingerprint(),
        "issuedAt": int(time.time()),
    }
    body = canonical_json(payload)
    try:
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", BACKEND_IDENTITY_KEY],
            input=body,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        raise RequestError(500, "Backend-Identitaet konnte nicht signiert werden.")
    return {
        "payload": payload,
        "signature": base64.b64encode(result.stdout).decode("ascii"),
        "algorithm": "RSASSA-PKCS1-v1_5/SHA-256",
    }


def verify_signature(headers, body):
    if not PSK:
        raise RequestError(500, "Mail-Backend ist nicht vollständig konfiguriert.")
    timestamp = headers.get("X-NB-Timestamp", "")
    nonce = headers.get("X-NB-Nonce", "")
    signature = headers.get("X-NB-Signature", "")
    if not timestamp or not nonce or not signature:
        raise RequestError(401, "Signatur-Header fehlen.")
    try:
        timestamp_value = int(timestamp)
    except ValueError:
        raise RequestError(401, "Zeitstempel ist ungültig.")
    now = int(time.time())
    if abs(now - timestamp_value) > TIMESTAMP_WINDOW_SECONDS:
        raise RequestError(401, "Zeitstempel liegt außerhalb des erlaubten Fensters.")
    cleanup_nonces(now)
    if nonce in used_nonces:
        raise RequestError(409, "Nonce wurde bereits verwendet.")
    signed = timestamp.encode("utf-8") + b"." + nonce.encode("utf-8") + b"." + body
    expected = hmac.new(PSK.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise RequestError(401, "HMAC-Signatur ist ungültig.")
    used_nonces[nonce] = now


def validate_payload(payload):
    if not isinstance(payload, dict):
        raise RequestError(400, "Request-Body muss ein JSON-Objekt sein.")
    teacher = payload.get("teacher") or {}
    messages = payload.get("messages") or []
    if not isinstance(teacher, dict) or not isinstance(messages, list):
        raise RequestError(400, "teacher und messages sind erforderlich.")
    sender = str(teacher.get("email") or "").strip().lower()
    password = str(teacher.get("password") or "")
    if not sender_ok(sender):
        raise RequestError(400, "Absenderadresse ist nicht erlaubt.")
    if not password:
        raise RequestError(400, "SMTP-Passwort fehlt.")
    if not messages:
        raise RequestError(400, "Keine Nachrichten enthalten.")
    if len(messages) > MAX_RECIPIENTS:
        raise RequestError(400, "Zu viele Empfänger in einem Request.")
    cleaned = []
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            raise RequestError(400, f"Nachricht {index + 1} ist ungültig.")
        to = str(message.get("to") or "").strip().lower()
        subject = str(message.get("subject") or "").strip()
        html = str(message.get("html") or "")
        text = str(message.get("text") or "")
        if not domain_ok(to):
            raise RequestError(400, f"Empfängeradresse ist nicht erlaubt: {to}")
        if not subject or len(subject) > MAX_SUBJECT_LENGTH:
            raise RequestError(400, "Betreff fehlt oder ist zu lang.")
        if not html and not text:
            raise RequestError(400, "Nachrichtentext fehlt.")
        attachments = message.get("attachments") or []
        if not isinstance(attachments, list):
            raise RequestError(400, "Attachments sind ungueltig.")
        cleaned_attachments = []
        message_bytes = len(html.encode("utf-8")) + len(text.encode("utf-8"))
        for attachment in attachments:
            if not isinstance(attachment, dict):
                raise RequestError(400, "Attachment ist ungueltig.")
            filename = str(attachment.get("filename") or "backup.zip").strip().replace("/", "_").replace("\\", "_")
            content_type = str(attachment.get("contentType") or "application/octet-stream").strip()
            data = str(attachment.get("data") or "")
            try:
                raw = base64.b64decode(data, validate=True)
            except Exception:
                raise RequestError(400, "Attachment ist nicht gueltig base64-codiert.")
            message_bytes += len(raw)
            cleaned_attachments.append({"filename": filename[:120], "content_type": content_type, "data": raw})
        if message_bytes > MAX_MESSAGE_BYTES:
            raise RequestError(400, "Nachricht ist zu groß.")
        cleaned.append({"to": to, "subject": subject, "html": html, "text": text, "attachments": cleaned_attachments})
    copy_to_sent = teacher.get("copy_to_sent") is True
    return sender, password, cleaned, copy_to_sent


def send_messages(sender, password, messages, copy_to_sent=False):
    results = []
    copied_to_sent = 0
    imap = None
    sent_mailbox = None
    if copy_to_sent:
        imap, sent_mailbox = connect_sent_mailbox(sender, password)
    context = ssl.create_default_context()
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            if SMTP_STARTTLS:
                smtp.starttls(context=context)
            login_smtp(smtp, sender, password)
            for message in messages:
                email = EmailMessage()
                email["From"] = sender
                email["To"] = message["to"]
                email["Subject"] = message["subject"]
                email["Date"] = formatdate(localtime=True)
                email["Message-ID"] = make_msgid(domain=sender.split("@", 1)[-1])
                email.set_content(message["text"] or "Diese Nachricht enthält einen HTML-Notenstand.")
                if message["html"]:
                    email.add_alternative(message["html"], subtype="html")
                for attachment in message.get("attachments", []):
                    maintype, _, subtype = attachment["content_type"].partition("/")
                    email.add_attachment(attachment["data"], maintype=maintype or "application", subtype=subtype or "octet-stream", filename=attachment["filename"])
                try:
                    smtp.send_message(email)
                except Exception as error:
                    results.append({"to": message["to"], "status": "failed", "error": str(error)})
                    logger.warning("mail failed to=%s subject=%r error=%s", message["to"], message["subject"], error)
                    continue

                result = {"to": message["to"], "status": "sent"}
                if copy_to_sent:
                    try:
                        status, detail = imap.append(
                            sent_mailbox["mailbox"],
                            "(\\Seen)",
                            imaplib.Time2Internaldate(time.time()),
                            email.as_bytes(policy=SMTP_POLICY),
                        )
                        if status == "OK":
                            copied_to_sent += 1
                            result["sent_copy"] = "stored"
                        else:
                            result["sent_copy"] = "failed"
                            result["sent_copy_error"] = safe_protocol_detail(detail)
                            logger.warning("imap append failed to=%s mailbox=%s detail=%s", message["to"], sent_mailbox["display"], detail)
                    except Exception as error:
                        result["sent_copy"] = "failed"
                        result["sent_copy_error"] = safe_protocol_detail(error)
                        logger.warning("imap append failed to=%s mailbox=%s error=%s", message["to"], sent_mailbox["display"], error)
                results.append(result)
                logger.info("mail sent to=%s subject=%r", message["to"], message["subject"])
    finally:
        if imap is not None:
            try:
                imap.logout()
            except Exception:
                pass
    return results, {
        "copied_to_sent": copied_to_sent,
        "copy_failed": sum(1 for item in results if item.get("sent_copy") == "failed"),
        "sent_mailbox": sent_mailbox["display"] if sent_mailbox else "",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "nb-mail-backend/1.0"

    def log_message(self, fmt, *args):
        logger.info("%s - %s", self.client_address[0], fmt % args)

    def do_OPTIONS(self):
        if urlparse(self.path).path != "/send-gradebook":
            self.send_error(404)
            return
        self.send_response(204)
        add_cors(self)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            json_response(self, 200, {"ok": True})
            return
        if parsed.path == "/identity":
            try:
                challenge = (parse_qs(parsed.query).get("challenge") or [""])[0]
                json_response(self, 200, signed_identity(challenge))
            except RequestError as error:
                json_response(self, error.status, {"ok": False, "detail": error.message})
            return
        self.send_error(404)

    def do_POST(self):
        if urlparse(self.path).path != "/send-gradebook":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_MESSAGE_BYTES * 2:
            json_response(self, 413, {"ok": False, "detail": "Request ist zu groß oder leer."})
            return
        body = self.rfile.read(length)
        try:
            verify_signature(self.headers, body)
            payload = json.loads(body.decode("utf-8"))
            sender, password, messages, copy_to_sent = validate_payload(payload)
            check_rate_limit(client_key(self, sender), int(time.time()))
            logger.info("accepted mail request sender=%s recipients=%s copy_to_sent=%s", sender, len(messages), copy_to_sent)
            results, copy_result = send_messages(sender, password, messages, copy_to_sent)
            failed = [item for item in results if item["status"] != "sent"]
            status = 200 if not failed else 502
            json_response(self, status, {"ok": not failed, "sent": len(results) - len(failed), "failed": len(failed), "results": results, **copy_result})
        except RequestError as error:
            logger.warning("rejected request status=%s detail=%s", error.status, error.message)
            json_response(self, error.status, {"ok": False, "detail": error.message})
        except json.JSONDecodeError:
            logger.warning("rejected request invalid json")
            json_response(self, 400, {"ok": False, "detail": "JSON ist ungültig."})
        except smtplib.SMTPAuthenticationError as error:
            code, detail = smtp_error_text(error)
            logger.warning("smtp authentication failed outside login helper code=%s detail=%s", code, detail)
            json_response(self, 401, {"ok": False, "detail": f"SMTP-Anmeldung fehlgeschlagen. Server={SMTP_HOST}, Port={SMTP_PORT}, STARTTLS={'ja' if SMTP_STARTTLS else 'nein'}. SMTP-Antwort: {code} {detail}."})
        except Exception as error:
            logger.exception("mail request failed")
            json_response(self, 500, {"ok": False, "detail": "Mailversand fehlgeschlagen.", "error": str(error)})


def main():
    if not PSK:
        logger.warning("NB_MAIL_PSK is not set. Signed requests will be rejected.")
    host = os.getenv("APP_HOST", "0.0.0.0")
    port = env_int("APP_PORT", 8080)
    server = ThreadingHTTPServer((host, port), Handler)
    logger.info("n.b. mail backend listening on %s:%s", host, port)
    server.serve_forever()


if __name__ == "__main__":
    main()
