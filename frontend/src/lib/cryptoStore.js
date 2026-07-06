const DB_NAME = "swipenoten-local-vault";
const DB_VERSION = 1;
const META_STORE = "meta";
const DATA_STORE = "data";
const STATE_KEY = "state";
const VERIFIER_KEY = "verifier";
const SALT_KEY = "salt";
const ITERATIONS_KEY = "iterations";
const VERSION_KEY = "version";
const CURRENT_VERSION = 1;
const DEFAULT_ITERATIONS = 210000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let dbPromise = null;
let vaultKey = null;
let cachedState = null;
let unlocked = false;
let writeQueue = Promise.resolve();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(storeName, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key, value) {
  const iv = randomBytes(12);
  const plain = encoder.encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return { iv: bytesToBase64(iv), data: bytesToBase64(cipher) };
}

async function decryptJson(key, box) {
  const iv = base64ToBytes(box.iv);
  const data = base64ToBytes(box.data);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(decoder.decode(plain));
}

function emptyState() {
  return { classes: [], students: [], sessions: [], grades: [], gradebook_overrides: [], gradebook_weights: [], grade_scales: [], point_sessions: [] };
}

export async function hasVault() {
  return !!(await idbGet(META_STORE, VERIFIER_KEY));
}

export function isUnlocked() {
  return unlocked;
}

export async function createVault(password) {
  if (!password || password.length < 8) {
    throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein.");
  }
  const salt = randomBytes(16);
  const iterations = DEFAULT_ITERATIONS;
  const key = await deriveKey(password, salt, iterations);
  await idbSet(META_STORE, VERSION_KEY, CURRENT_VERSION);
  await idbSet(META_STORE, SALT_KEY, bytesToBase64(salt));
  await idbSet(META_STORE, ITERATIONS_KEY, iterations);
  await idbSet(META_STORE, VERIFIER_KEY, await encryptJson(key, { ok: "swipenoten-vault" }));
  vaultKey = key;
  cachedState = emptyState();
  unlocked = true;
  await saveState(cachedState);
}

export async function unlockVault(password) {
  const saltValue = await idbGet(META_STORE, SALT_KEY);
  const verifier = await idbGet(META_STORE, VERIFIER_KEY);
  const iterations = (await idbGet(META_STORE, ITERATIONS_KEY)) || DEFAULT_ITERATIONS;
  if (!saltValue || !verifier) throw new Error("Es gibt noch keinen lokalen Tresor.");
  const key = await deriveKey(password, base64ToBytes(saltValue), iterations);
  try {
    const check = await decryptJson(key, verifier);
    if (check.ok !== "swipenoten-vault") throw new Error("ungueltig");
  } catch (error) {
    throw new Error("Passwort stimmt nicht.");
  }
  vaultKey = key;
  cachedState = await loadStateWithKey(key);
  unlocked = true;
}

async function loadStateWithKey(key) {
  const box = await idbGet(DATA_STORE, STATE_KEY);
  if (!box) return emptyState();
  const state = await decryptJson(key, box);
  return { ...emptyState(), ...state };
}

export async function getState() {
  if (!unlocked || !vaultKey) throw new Error("Lokaler Tresor ist gesperrt.");
  await writeQueue;
  if (!cachedState) cachedState = await loadStateWithKey(vaultKey);
  return cachedState;
}

export async function saveState(nextState) {
  if (!vaultKey) throw new Error("Lokaler Tresor ist gesperrt.");
  cachedState = nextState;
  await idbSet(DATA_STORE, STATE_KEY, await encryptJson(vaultKey, nextState));
}

export function mutateState(mutator) {
  writeQueue = writeQueue.then(async () => {
    if (!unlocked || !vaultKey) throw new Error("Lokaler Tresor ist gesperrt.");
    if (!cachedState) cachedState = await loadStateWithKey(vaultKey);
    const result = await mutator(cachedState);
    await saveState(cachedState);
    return result;
  });
  return writeQueue;
}

export function lockVault() {
  vaultKey = null;
  cachedState = null;
  unlocked = false;
}

