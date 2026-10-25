// Netlify Blobs: nothing stays awake, nothing is billed while idle.
// The store is opened per request on purpose. A store kept at module level outlives its
// short-lived token in a warm function and fails with "Token expired" (lesson of 2026-10-25).
import { getStore } from '@netlify/blobs';

export function blobStore() {
  const s = getStore({ name: 'laventina', consistency: 'strong' });
  return {
    async get(key) {
      const r = await s.getWithMetadata(key, { type: 'json' });
      return r ? { data: r.data, etag: r.etag } : null;
    },
    async put(key, data, { etag, create } = {}) {
      const opts = create ? { onlyIfNew: true } : etag ? { onlyIfMatch: etag } : {};
      const r = await s.setJSON(key, data, opts);
      return r.modified;
    },
  };
}
