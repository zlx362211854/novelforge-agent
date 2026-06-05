#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNovelAgentServer } from './tools.js';

async function main(): Promise<void> {
  const workspaceRoot = process.env.NOVELFORGE_WORKSPACE || process.cwd();
  const server = createNovelAgentServer({ workspaceRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
