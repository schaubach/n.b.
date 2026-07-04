import api from "./localApi";

export const API = "local-encrypted-indexeddb";
export { isUnlocked, lockVault } from "./cryptoStore";
export default api;
