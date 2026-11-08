const { TextEncoder, TextDecoder } = require("util");
const { webcrypto } = require("crypto");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.Uint8Array = new TextEncoder().encode("").constructor;
global.ArrayBuffer = new Uint8Array().buffer.constructor;
global.crypto = webcrypto;

let failWrite;
let store;
beforeEach(async () => {
  jest.resetModules();
  failWrite = false;
  const records = new Map();
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: (name) => {
      const tx = {};
      tx.objectStore = () => ({
        get: (key) => {
          const req = {};
          Promise.resolve().then(() => { req.result = records.get(`${name}:${key}`); req.onsuccess(); });
          return req;
        },
        put: (value, key) => {
          Promise.resolve().then(() => {
            if (failWrite) { tx.error = new Error("quota"); tx.onabort(); }
            else { records.set(`${name}:${key}`, value); tx.oncomplete(); }
          });
        },
      });
      return tx;
    },
  };
  global.indexedDB = { open: () => {
    const req = {};
    Promise.resolve().then(() => { req.result = db; req.onsuccess(); });
    return req;
  } };
  store = require("./cryptoStore");
  await store.createVault("test-vault-password");
});

test("rejected mutations are rolled back and later writes still work", async () => {
  await expect(store.mutateState((state) => { state.classes.push({ id: "bad" }); throw new Error("invalid import"); })).rejects.toThrow("invalid import");
  expect((await store.getState()).classes).toEqual([]);
  await store.mutateState((state) => state.classes.push({ id: "good" }));
  expect((await store.getState()).classes).toEqual([{ id: "good" }]);
});

test("failed disk writes do not publish partial imports and can be retried", async () => {
  failWrite = true;
  await expect(store.mutateState((state) => state.grades.push({ value: "1" }))).rejects.toThrow("quota");
  expect((await store.getState()).grades).toEqual([]);
  failWrite = false;
  await store.mutateState((state) => state.grades.push({ value: "2" }));
  expect((await store.getState()).grades).toEqual([{ value: "2" }]);
});
