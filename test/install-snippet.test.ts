import test from 'node:test';
import assert from 'node:assert/strict';
import { runInstall } from '../src/cli/install.js';

// Regression test for the v0.10.4 fix: install snippets must reference the
// package name with `-p`, not the bin name as a phantom package, otherwise
// first-time users hit `404 Not Found - GET .../novelforge-agent-mcp`.

test('claude-code snippet uses -p novelforge-agent@latest, not bare bin name', async () => {
  const result = await runInstall({ host: 'claude-code', workspace: '/tmp/_nf-install-test', printOnly: true });
  assert.ok(result.manualSnippet, 'expected a snippet');
  const cfg = JSON.parse(result.manualSnippet!);
  const args = cfg.mcpServers.novelforge.args as string[];
  assert.deepEqual(args, ['-y', '-p', 'novelforge-agent@latest', 'novelforge-agent-mcp'],
    `args must be -y -p novelforge-agent@latest novelforge-agent-mcp; got ${JSON.stringify(args)}`);
  // Anti-pattern check: must NOT match the old broken form.
  const broken = args.length === 2 && args[0] === '-y' && args[1] === 'novelforge-agent-mcp';
  assert.equal(broken, false, 'must not generate the legacy broken form');
});

test('codex TOML snippet uses -p novelforge-agent@latest', async () => {
  const result = await runInstall({ host: 'codex', workspace: '/tmp/_nf-install-test', printOnly: true });
  assert.ok(result.manualSnippet);
  assert.match(result.manualSnippet!, /args = \["-y", "-p", "novelforge-agent@latest", "novelforge-agent-mcp"\]/);
});

test('cursor snippet uses -p novelforge-agent@latest', async () => {
  const result = await runInstall({ host: 'cursor', workspace: '/tmp/_nf-install-test', printOnly: true });
  assert.ok(result.manualSnippet);
  const cfg = JSON.parse(result.manualSnippet!);
  const args = cfg.mcpServers.novelforge.args as string[];
  assert.deepEqual(args, ['-y', '-p', 'novelforge-agent@latest', 'novelforge-agent-mcp']);
});
