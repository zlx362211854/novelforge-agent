import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('CLI module exports runCli for adapter tests', async () => {
  const mod = await import(pathToFileURL(resolve('dist/src/cli/index.js')).href);
  assert.equal(typeof mod.runCli, 'function');
});
