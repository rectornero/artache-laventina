// The same interface as lib/blobs.mjs, in memory, for tests and the local preview.
export function memoryStore() {
  const m = new Map();
  let n = 0;
  return {
    m,
    async get(key) {
      const r = m.get(key);
      return r ? { data: structuredClone(r.data), etag: r.etag } : null;
    },
    async put(key, data, { etag, create } = {}) {
      const cur = m.get(key);
      if (create && cur) return false;
      if (etag && (!cur || cur.etag !== etag)) return false;
      m.set(key, { data: structuredClone(data), etag: `e${++n}` });
      return true;
    },
  };
}
