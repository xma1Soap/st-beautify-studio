// Small key-value storage in IndexedDB (room for avatars and big cards; localStorage only holds a few MB).
// Falls back to localStorage when IndexedDB is not available.
const DB = 'st-beautify-studio';
const STORE = 'kv';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

const hasIdb = () => typeof indexedDB !== 'undefined';

export async function kvGet<T>(key: string): Promise<T | undefined> {
  if (!hasIdb()) {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : undefined;
  }
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (!hasIdb()) {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
