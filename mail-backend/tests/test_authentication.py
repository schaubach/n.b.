import hashlib
import hmac
import http.client
import importlib.util
import json
import pathlib
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))
import server

spec = importlib.util.spec_from_file_location("write_mail_config", ROOT / "scripts/write-mail-config.py")
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.secret_patch = patch.object(server, "PSK", "shared-test-secret")
        self.secret_patch.start()
        server.used_nonces.clear()
        self.smtp_patch = patch.object(server, "send_messages")
        self.smtp = self.smtp_patch.start()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.thread.join()
        self.http.server_close()
        self.secret_patch.stop()
        self.smtp_patch.stop()

    def request(self, secret="shared-test-secret", body=b"{}", nonce="probe"):
        timestamp = str(int(time.time()))
        signature = hmac.new(secret.encode(), timestamp.encode() + b"." + nonce.encode() + b"." + body, hashlib.sha256).hexdigest()
        connection = http.client.HTTPConnection(*self.http.server_address)
        connection.request("POST", "/auth-check", body, {
            "X-NB-Timestamp": timestamp, "X-NB-Nonce": nonce, "X-NB-Signature": signature,
        })
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_probe_verifies_secret_without_sending_mail(self):
        status, result = self.request()
        self.assertEqual(status, 200)
        self.assertTrue(result["authenticated"])
        self.smtp.assert_not_called()

    def test_wrong_secret_is_distinguished_and_cannot_send_mail(self):
        status, result = self.request(secret="wrong-secret")
        self.assertEqual(status, 401)
        self.assertEqual(result["code"], "HMAC_INVALID")
        self.smtp.assert_not_called()

    def test_replay_stays_rejected(self):
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request()[0], 409)

    def test_body_tampering_stays_rejected(self):
        now = str(int(time.time()))
        signed = now.encode() + b".test.{}"
        signature = hmac.new(b"shared-test-secret", signed, hashlib.sha256).hexdigest()
        with self.assertRaises(server.RequestError) as caught:
            server.verify_signature({"X-NB-Timestamp": now, "X-NB-Nonce": "test", "X-NB-Signature": signature}, b'{"changed":true}')
        self.assertEqual(caught.exception.code, "HMAC_INVALID")


class ConfigExportTests(unittest.TestCase):
    def test_exports_effective_compose_secret_with_json_escaping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "identity").mkdir()
            (root / "identity/public.pem").write_text("test-public-key\n")
            (root / ".env").write_text("NB_MAIL_PSK=ignored-raw-value\n")
            secret = 'effective-$-$$-secret-"quoted"-\\-ä'
            with patch.object(writer.subprocess, "run") as run:
                run.return_value.stdout = json.dumps({"services": {"mail-api": {"environment": {"NB_MAIL_PSK": secret.replace("$", "$$")}}}})
                writer.write_mail_config(root)
            exported = json.loads((root / "webapp/mail-backend-config.json").read_text())
            self.assertEqual(exported["preSharedKey"], secret)
            self.assertEqual(exported["backendIdentityPublicKey"], "test-public-key\n")
            self.assertEqual((root / "webapp/mail-backend-config.json").stat().st_mode & 0o777, 0o644)


if __name__ == "__main__":
    unittest.main()
