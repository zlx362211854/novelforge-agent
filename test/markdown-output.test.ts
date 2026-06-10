import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNovelAgentServer } from '../src/mcp/tools.js';

function toolHandler(server: any, name: string) {
  return (server as { _registeredTools: Record<string, { handler: (input: unknown) => Promise<unknown> }> })
    ._registeredTools[name].handler;
}

function textOf(value: unknown): string {
  return (value as { content: Array<{ text: string }> }).content[0].text;
}

test('start_novel_project default returns concise markdown, not a JSON dump', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-md-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const text = textOf(await toolHandler(server, 'start_novel_project')({
      prompt: '一本极短测试小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
    }));

    // It must be markdown (starts with ✓ heading), not raw JSON.
    assert.ok(text.startsWith('✓ **Project created**'), `expected markdown header, got: ${text.slice(0, 60)}`);
    assert.match(text, /📁 \*\*Path\*\*:/);
    assert.match(text, /⏭ \*\*Next step\*\*: `novel_metadata`/);
    assert.match(text, /### Instruction/);
    // The non-verbose default must NOT include a "### Raw" JSON block.
    assert.equal(text.includes('### Raw'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start_novel_project verbose=true appends a "### Raw" JSON block', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-md-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const text = textOf(await toolHandler(server, 'start_novel_project')({
      prompt: '一本极短测试小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
      verbose: true,
    }));
    assert.match(text, /### Raw/);
    assert.match(text, /```json/);
    // Sanity-check that the embedded JSON is parseable.
    const fenced = text.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(fenced, 'expected a json fenced block');
    const parsed = JSON.parse(fenced![1]);
    assert.equal(typeof parsed.state.projectPath, 'string');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('list_projects renders an empty info message when there are no projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-md-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const text = textOf(await toolHandler(server, 'list_projects')({ outputDir: 'novels' }));
    assert.ok(text.startsWith('ℹ️ **No projects'), `got: ${text.slice(0, 50)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('list_projects renders a markdown table when projects exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-md-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    await toolHandler(server, 'start_novel_project')({
      prompt: '一本极短测试小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
    });
    const text = textOf(await toolHandler(server, 'list_projects')({ outputDir: 'novels' }));
    assert.ok(text.startsWith('ℹ️ **Found '), `got: ${text.slice(0, 60)}`);
    assert.match(text, /\| Title \| Step \| Progress \| Path \|/);
    assert.match(text, /novel_metadata/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('markdown summary is smaller than legacy JSON dump for start_novel_project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-md-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const markdownText = textOf(await toolHandler(server, 'start_novel_project')({
      prompt: '一本极短测试小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
    }));
    const verboseText = textOf(await toolHandler(server, 'start_novel_project')({
      prompt: '一本极短测试小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
      verbose: true,
    }));
    // verbose mode includes the same JSON dump the old format used to send → strictly larger.
    assert.ok(verboseText.length > markdownText.length, 'verbose output must be larger than default');
    // The default markdown output must not include the duplicate JSON tail.
    assert.equal(markdownText.includes('### Raw'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('submit_step_result failure renders a clean ❌ error block', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-md-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const startText = textOf(await toolHandler(server, 'start_novel_project')({
      prompt: '一本极短测试小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
      verbose: true,
    }));
    const fenced = startText.match(/```json\n([\s\S]*?)\n```/);
    const start = JSON.parse(fenced![1]);

    // Submit invalid JSON to the metadata step.
    const text = textOf(await toolHandler(server, 'submit_step_result')({
      projectPath: start.state.projectPath,
      step: 'novel_metadata',
      content: '{ invalid json',
    }));
    assert.ok(text.startsWith('❌ **submit_step_result rejected'), `got: ${text.slice(0, 80)}`);
    assert.match(text, /⛔ \*\*Reason\*\*:/);
    assert.match(text, /💾 \*\*Recovery\*\*:/);
    assert.match(text, /🔄 \*\*Action\*\*:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('get_next_step renders modelHint and instruction in markdown form', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-md-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const startText = textOf(await toolHandler(server, 'start_novel_project')({
      prompt: '一本极短测试小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
      verbose: true,
    }));
    const fenced = startText.match(/```json\n([\s\S]*?)\n```/);
    const start = JSON.parse(fenced![1]);
    const text = textOf(await toolHandler(server, 'get_next_step')({ projectPath: start.state.projectPath }));
    assert.ok(text.startsWith('ℹ️ **Next step**'), `got: ${text.slice(0, 60)}`);
    assert.match(text, /⏭ \*\*Step\*\*: `novel_metadata`/);
    assert.match(text, /🤖 \*\*modelHint\*\*: standard/);
    assert.match(text, /### Instruction/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
