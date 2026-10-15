import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkSite } from '../scripts/build.mjs';

test('published files: relative paths, resolvable imports, no secrets, sane viewport', () => {
  const dir = fileURLToPath(new URL('../public', import.meta.url));
  assert.deepEqual(checkSite(dir), []);
});
