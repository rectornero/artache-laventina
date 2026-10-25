// The frost's lesson, enforced. If one of these fails, read CLAUDE.md "Cost safety" before changing the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? files(join(dir, d.name)) : /\.(m?js|toml|json|html)$/.test(d.name) ? [join(dir, d.name)] : []);
const code = ['lib', 'netlify', 'public', 'dev'].flatMap(files).concat(['netlify.toml', 'package.json'])
  .map((f) => ({ f, s: readFileSync(join(root, f), 'utf8') }));

test('nothing runs on its own: no scheduled functions, background jobs or edge functions', () => {
  for (const { f, s } of code) {
    assert.doesNotMatch(s, /\bschedule\s*[:=(]|@netlify\/functions.*schedule|\[functions\.[^\]]+\][^[]*schedule/s, `${f} schedules something`);
    assert.doesNotMatch(s, /-background\.m?js|edge_functions|\[\[edge_functions\]\]/, `${f} adds a background or edge function`);
  }
  const fns = readdirSync(join(root, 'netlify/functions'));
  assert.deepEqual(fns.sort(), ['api.mjs', 'mcp.mjs'], 'a new function needs a monthly cost estimate in CLAUDE.md first');
});

test('no polling and no timers in the page', () => {
  for (const { f, s } of code.filter((x) => x.f.startsWith('public'))) {
    assert.doesNotMatch(s, /setInterval|setTimeout|EventSource|WebSocket|serviceWorker/, `${f} would wake the server on its own`);
  }
});

test('nothing that bills while idle or spends Netlify credits on AI', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['@netlify/blobs'], 'a new dependency needs a cost check');
  for (const { f, s } of code) {
    assert.doesNotMatch(s, /@netlify\/database|@neondatabase|NETLIFY_DATABASE|postgres/i, `${f} uses a database that bills while awake`);
    assert.doesNotMatch(s, /@anthropic-ai|openai|ai-gateway|AI_GATEWAY|ANTHROPIC/i, `${f} calls AI from Netlify`);
    assert.doesNotMatch(s, /web-push|PushManager|VAPID/i, `${f} adds push (no bell, by Nero's rule)`);
  }
});

test('the Blobs store is opened per request, never kept at module level', () => {
  const s = readFileSync(join(root, 'lib/blobs.mjs'), 'utf8');
  const top = s.split('\n').filter((l) => /getStore\(/.test(l));
  assert.ok(top.every((l) => /^\s+/.test(l)), 'getStore at module level expires in warm functions');
});

test('production only builds when a commit asks for [deploy]', () => {
  const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
  assert.match(toml, /\[context\.production\]\s*\n\s*ignore = ".*\[deploy\]/);
});

test('every function is rate limited', () => {
  for (const f of ['api.mjs', 'mcp.mjs']) {
    assert.match(readFileSync(join(root, 'netlify/functions', f), 'utf8'), /rateLimit:/, `${f} has no rate limit`);
  }
});
