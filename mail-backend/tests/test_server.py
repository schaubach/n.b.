import pathlib
import sys
import unittest
from unittest.mock import patch


APP_DIR = pathlib.Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_DIR))
import server


class FakeSmtp:
    sent = []

    def __init__(self, *args, **kwargs):
        self.login_user = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def starttls(self, context=None):
        return 220, b"ready"

    def login(self, username, password):
        self.login_user = username
        return 235, b"ok"

    def send_message(self, message):
        self.sent.append(message)


class FakeImap:
    def __init__(self, append_status="OK"):
        self.append_status = append_status
        self.appended = []
        self.logged_out = False

    def append(self, mailbox, flags, internal_date, raw):
        self.appended.append((mailbox, flags, internal_date, raw))
        return self.append_status, [b"stored" if self.append_status == "OK" else b"failed"]

    def logout(self):
        self.logged_out = True


class MailBackendTests(unittest.TestCase):
    def setUp(self):
        FakeSmtp.sent = []

    def test_sent_mailbox_prefers_special_use_flag(self):
        sent, mailboxes = server.find_sent_mailbox([
            b'(\\HasNoChildren) "/" "Sent Items"',
            b'(\\HasNoChildren \\Sent) "/" "INBOX/Sent"',
        ])

        self.assertEqual(len(mailboxes), 2)
        self.assertEqual(sent["mailbox"], "INBOX/Sent")

    def test_sent_mailbox_recognizes_german_name(self):
        sent, _ = server.find_sent_mailbox([
            b'(\\HasNoChildren) "/" "INBOX"',
            b'(\\HasNoChildren) "/" "Gesendet"',
        ])

        self.assertEqual(sent["display"], "Gesendet")

    def test_payload_enables_sent_copy_only_for_json_boolean(self):
        base = {
            "teacher": {"email": "lehrkraft@rbbk-do.de", "password": "secret", "copy_to_sent": True},
            "messages": [{"to": "lernend@rbbk-do.de", "subject": "Notenstand", "text": "Hallo"}],
        }

        self.assertTrue(server.validate_payload(base)[3])
        base["teacher"]["copy_to_sent"] = "true"
        self.assertFalse(server.validate_payload(base)[3])

    def test_imap_preflight_failure_prevents_smtp_delivery(self):
        messages = [{
            "to": "lernend@rbbk-do.de",
            "subject": "Notenstand",
            "html": "",
            "text": "Hallo",
            "attachments": [],
        }]

        with patch.object(server, "connect_sent_mailbox", side_effect=server.RequestError(502, "Kein Gesendet-Ordner")), patch.object(server.smtplib, "SMTP", FakeSmtp):
            with self.assertRaisesRegex(server.RequestError, "Kein Gesendet-Ordner"):
                server.send_messages("lehrkraft@rbbk-do.de", "secret", messages, True)

        self.assertEqual(FakeSmtp.sent, [])

    def test_sent_copy_appends_same_message_after_smtp_delivery(self):
        fake_imap = FakeImap()
        messages = [{
            "to": "lernend@rbbk-do.de",
            "subject": "Notenstand",
            "html": "<p>Hallo</p>",
            "text": "Hallo",
            "attachments": [],
        }]

        with patch.object(server, "connect_sent_mailbox", return_value=(fake_imap, {"mailbox": "Gesendet", "display": "Gesendet"})), patch.object(server.smtplib, "SMTP", FakeSmtp):
            results, copy_result = server.send_messages("lehrkraft@rbbk-do.de", "secret", messages, True)

        self.assertEqual(results[0]["status"], "sent")
        self.assertEqual(results[0]["sent_copy"], "stored")
        self.assertEqual(copy_result, {"copied_to_sent": 1, "copy_failed": 0, "sent_mailbox": "Gesendet"})
        self.assertEqual(len(FakeSmtp.sent), 1)
        self.assertEqual(len(fake_imap.appended), 1)
        self.assertEqual(fake_imap.appended[0][0:2], ("Gesendet", "(\\Seen)"))
        self.assertIn(b"Subject: Notenstand", fake_imap.appended[0][3])
        self.assertTrue(fake_imap.logged_out)

    def test_append_failure_does_not_report_delivered_mail_as_smtp_failure(self):
        fake_imap = FakeImap(append_status="NO")
        messages = [{
            "to": "lernend@rbbk-do.de",
            "subject": "Notenstand",
            "html": "",
            "text": "Hallo",
            "attachments": [],
        }]

        with patch.object(server, "connect_sent_mailbox", return_value=(fake_imap, {"mailbox": "Sent", "display": "Sent"})), patch.object(server.smtplib, "SMTP", FakeSmtp):
            results, copy_result = server.send_messages("lehrkraft@rbbk-do.de", "secret", messages, True)

        self.assertEqual(results[0]["status"], "sent")
        self.assertEqual(results[0]["sent_copy"], "failed")
        self.assertEqual(copy_result["copy_failed"], 1)
        self.assertEqual(copy_result["copied_to_sent"], 0)


if __name__ == "__main__":
    unittest.main()
