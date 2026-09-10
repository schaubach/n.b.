const { TextEncoder, TextDecoder } = require("util");

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

jest.mock("./api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const api = require("./api").default;
const { checkMailBackendHealth, loadMailBackendConfig } = require("./mailBackend");

describe("mail backend diagnostics", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test("reports browser and origin details for a failed health request", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Load failed"));

    const result = await checkMailBackendHealth("10.97.7.124");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Healthcheck fehlgeschlagen");
    expect(result.message).toContain("Backend-Origin: https://10.97.7.124:8123");
    expect(result.message).toContain("Browserfehler: TypeError - Load failed");
    expect(result.message).toContain("Safari stellt JavaScript keine weitergehenden Zertifikatsdetails bereit");
  });

  test("uses backend credentials stored in the encrypted teacher config", async () => {
    api.get.mockResolvedValue({
      data: {
        mail_backend_pre_shared_key: "local-secret",
        backend_identity_public_key: "-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----",
      },
    });
    global.fetch = jest.fn();

    const config = await loadMailBackendConfig();

    expect(config.source).toBe("teacher-config");
    expect(config.preSharedKey).toBe("local-secret");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("explains missing Basic Auth credentials in the Home Screen instance", async () => {
    api.get.mockResolvedValue({ data: {} });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(loadMailBackendConfig()).rejects.toThrow(/Basic-Auth-Sitzung/);
  });
});
