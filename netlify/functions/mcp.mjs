// The Claude link: Claude on claude.ai calls this on Nero's own plan. Never on a schedule.
import { handleMcp } from '../../lib/server.mjs';
import { blobStore } from '../../lib/blobs.mjs';

export default (req) => handleMcp(req, { store: blobStore() });

export const config = {
  path: '/mcp/*',
  rateLimit: { action: 'rate_limit', windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
