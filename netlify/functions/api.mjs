// Runs only when the page calls it. Never on a schedule.
import { handleApi } from '../../lib/server.mjs';
import { blobStore } from '../../lib/blobs.mjs';

export default (req) => handleApi(req, { store: blobStore() });

export const config = {
  path: '/api/*',
  // A stranger hammering the API is turned away before any work is done.
  rateLimit: { action: 'rate_limit', windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
