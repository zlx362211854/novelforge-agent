import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  loadState,
  saveJsonFile,
  saveMarkdownFile,
} from '../src/core/index.js';

test('createProject initializes file layout and state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const result = await createProject({
      workspaceRoot: root,
      prompt: '写一本星际悬疑小说',
      outputDir: 'novels',
      targetChapters: 3,
    });

    assert.match(result.state.projectPath, /novels/);
    assert.equal(result.state.currentStep, 'novel_metadata');
    assert.equal(result.state.targetChapters, 3);
    assert.equal(result.state.plannedTotalChapters, 3);

    const loaded = await loadState(result.state.projectPath);
    assert.equal(loaded.projectId, result.state.projectId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createProject defaults to a small planning batch and larger whole-book target when no chapter count is supplied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const result = await createProject({
      workspaceRoot: root,
      prompt: '写一本默认长度小说',
      outputDir: 'novels',
    });

    assert.equal(result.state.targetChapters, 5);
    assert.equal(result.state.plannedTotalChapters, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createProject stores prompt language preference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: 'Write an English space opera',
      language: 'en-US',
      outputDir: 'novels',
      targetChapters: 1,
    });

    const saved = await loadState(state.projectPath);
    assert.equal(saved.language, 'en-US');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('save helpers write readable markdown and formatted json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const project = await createProject({
      workspaceRoot: root,
      prompt: '写一本赛博修仙小说',
      outputDir: 'novels',
      targetChapters: 1,
    });
    const jsonPath = await saveJsonFile(project.state.projectPath, 'novel.json', { title: '霓虹飞升' });
    const mdPath = await saveMarkdownFile(project.state.projectPath, 'story-bible.md', '# 故事圣经\n');

    assert.equal(await readFile(mdPath, 'utf8'), '# 故事圣经\n');
    assert.match(await readFile(jsonPath, 'utf8'), /"title": "霓虹飞升"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createProject rejects path traversal outputDir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    await assert.rejects(
      () => createProject({
        workspaceRoot: root,
        prompt: '写一本小说',
        outputDir: '../outside',
        targetChapters: 1,
      }),
      /outside workspace/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
