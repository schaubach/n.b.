const { webcrypto } = require("crypto");
const { TextDecoder, TextEncoder } = require("util");

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
global.crypto = webcrypto;

const { __backupTest } = require("./backup");

const decoder = new TextDecoder();
const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);

test("creates password protected ZIP files that can be decrypted with the pre-shared key", () => {
  const zip = __backupTest.makeZip([{ name: "data/state.csv", data: "key,json\nclasses,[]" }], "secret-psk");

  expect(readU16(zip, 6) & 1).toBe(1);
  const files = __backupTest.unzipStored(zip, "secret-psk");

  expect(decoder.decode(files.get("data/state.csv"))).toBe("key,json\nclasses,[]");
  expect(() => __backupTest.unzipStored(zip, "wrong-psk")).toThrow(/Pre-Shared-Key/);
});
