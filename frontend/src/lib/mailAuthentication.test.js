const { TextEncoder, TextDecoder } = require("util");
const { webcrypto, generateKeyPairSync, sign, createHash, createHmac } = require("crypto");
const { execFileSync } = require("child_process");
const path = require("path");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
// Node WebCrypto requires buffers from Node's realm rather than jsdom's realm.
global.Uint8Array = new TextEncoder().encode("").constructor;
global.ArrayBuffer = new Uint8Array().buffer.constructor;
global.crypto = webcrypto;

jest.mock("./api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
const api = require("./api").default;
const { checkMailBackendConnection, sendGradebookMailsViaBackend, sendBackupMailViaBackend } = require("./mailBackend");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const host = "school.example";
const secret = "correct-$-secret-with-unicode-ä";
let local, packageKey, packageStatus, sends;
const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });

beforeEach(() => {
  jest.clearAllMocks();
  local = { name: "Lehrkraft", email: "test@rbbk-do.de", password: "test-password", mail_backend_host: host,
    mail_backend_pre_shared_key: secret, backend_identity_public_key: publicKey };
  packageKey = publicKey;
  packageStatus = 200;
  sends = [];
  api.get.mockImplementation(async () => ({ data: { ...local } }));
  api.post.mockImplementation(async (_, data) => { local = { ...data }; return { data: local }; });
  global.fetch = jest.fn(async (url, options = {}) => {
    const target = new URL(url);
    if (target.pathname === "/health") return reply(200, { ok: true });
    if (target.pathname === "/api/identity") {
      const payload = { app: "n.b.", challenge: target.searchParams.get("challenge"), issuedAt: Math.floor(Date.now() / 1000),
        publicKeySha256: createHash("sha256").update(publicKey).digest("hex"), serverName: host };
      return reply(200, { payload, signature: sign("sha256", Buffer.from(JSON.stringify(payload)), keys.privateKey).toString("base64") });
    }
    if (target.pathname.endsWith("mail-backend-config.json")) return reply(packageStatus, { preSharedKey: secret, backendIdentityPublicKey: packageKey });
    if (options.method === "POST") {
      const headers = options.headers;
      const signed = headers["X-NB-Timestamp"] + "." + headers["X-NB-Nonce"] + "." + options.body;
      if (createHmac("sha256", secret).update(signed).digest("hex") !== headers["X-NB-Signature"]) {
        return reply(401, { ok: false, code: "HMAC_INVALID", detail: "HMAC-Signatur ist ungültig." });
      }
      if (target.pathname === "/api/auth-check") {
        expect(options.body).toBe("{}");
        return reply(200, { ok: true, authenticated: true });
      }
      sends.push(options);
      return reply(200, { ok: true, sent: 1 });
    }
    throw new Error("Unexpected request: " + target.pathname);
  });
});

test("status verifies the shared secret without sending mail or SMTP credentials", async () => {
  const result = await checkMailBackendConnection(host);
  expect(result.ok).toBe(true);
  expect(result.message).toContain("HMAC-Schluessel bestaetigt");
  expect(sends).toHaveLength(0);
});

test("repairs a stale local secret using the same trusted identity, before sending once", async () => {
  local.mail_backend_pre_shared_key = "old-secret";
  await sendGradebookMailsViaBackend(local, [{ to: "test@rbbk-do.de", text: "Hallo" }]);
  expect(local.mail_backend_pre_shared_key).toBe(secret);
  expect(local.password).toBe("test-password");
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(sends).toHaveLength(1);
});

test("does not automatically replace a trusted identity", async () => {
  local.mail_backend_pre_shared_key = "old-secret";
  packageKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" });
  await expect(sendGradebookMailsViaBackend(local, [])).rejects.toThrow(/Identitaet im Installationspaket/);
  expect(api.post).not.toHaveBeenCalled();
  expect(sends).toHaveLength(0);
});

test("explains how to recover when the Home Screen app cannot refresh credentials", async () => {
  local.mail_backend_pre_shared_key = "old-secret";
  packageStatus = 401;
  const result = await checkMailBackendConnection(host);
  expect(result.ok).toBe(false);
  expect(result.message).toContain("HMAC-Schluessel");
  expect(result.message).toContain("Credentials");
  expect(sends).toHaveLength(0);
});

test("the real Python verifier accepts WebCrypto signatures for Unicode gradebook and backup bodies", async () => {
  await sendGradebookMailsViaBackend(local, [{ to: "test@rbbk-do.de", html: "<table><tr><td>Grüße 2+ – 1,7</td></tr></table>" }]);
  await sendBackupMailViaBackend(local, { filename: "backup.zip", data: "UEsDBAo=", contentType: "application/zip", size: 8 });
  expect(sends).toHaveLength(2);
  const python = "import json,sys;sys.path.insert(0,sys.argv[1]);import server;data=json.load(sys.stdin);server.PSK=data['secret'];server.verify_signature(data['headers'],data['body'].encode('utf-8'));print('verified')";
  for (const request of sends) {
    const result = execFileSync("python3", ["-c", python, path.resolve(__dirname, "../../../mail-backend/app")], {
      input: JSON.stringify({ secret, headers: request.headers, body: request.body }), encoding: "utf8",
    });
    expect(result.trim()).toBe("verified");
  }
});
