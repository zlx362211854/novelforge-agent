import test from 'node:test';
import assert from 'node:assert/strict';
import { createNovelAgentServer } from '../src/mcp/tools.js';

test('createNovelAgentServer returns an MCP server object', () => {
  const server = createNovelAgentServer({ workspaceRoot: process.cwd() });
  assert.equal(typeof server.connect, 'function');
});
