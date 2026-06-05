import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  getProjectStatus,
  listProjects,
  submitStepResult,
} from '../src/core/index.js';

test('listProjects returns empty array when workspace has no novels dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-disc-'));
  try {
    const items = await listProjects({ workspaceRoot: root });
    assert.deepEqual(items, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('listProjects returns summary for each project, newest first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-disc-'));
  try {
    const first = await createProject({ workspaceRoot: root, prompt: '一本武侠', outputDir: 'novels', targetChapters: 2 });
    await new Promise((r) => setTimeout(r, 10));
    const second = await createProject({ workspaceRoot: root, prompt: '一本科幻', outputDir: 'novels', targetChapters: 2 });

    const items = await listProjects({ workspaceRoot: root });
    assert.equal(items.length, 2);
    assert.equal(items[0].projectId, second.state.projectId, 'newest project first');
    assert.equal(items[1].projectId, first.state.projectId);
    assert.equal(items[0].currentStep, 'novel_metadata');
    assert.equal(items[0].targetChapters, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('two projects with identical prompt land in distinct directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-disc-'));
  try {
    const a = await createProject({ workspaceRoot: root, prompt: '一本修仙', outputDir: 'novels', targetChapters: 1 });
    const b = await createProject({ workspaceRoot: root, prompt: '一本修仙', outputDir: 'novels', targetChapters: 1 });
    assert.notEqual(a.state.projectPath, b.state.projectPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('getProjectStatus reports progress and pickups latest review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-disc-'));
  try {
    const { state } = await createProject({ workspaceRoot: root, prompt: '废土侦探', outputDir: 'novels', targetChapters: 1 });

    // Seed through metadata + bible
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '灰烬证词',
        genre: '废土悬疑',
        premise: '一名侦探调查废城集体失忆。',
        language: 'zh-CN',
        style: '冷峻',
        coreCast: [{ name: '周临', role: 'protagonist', description: '废土侦探' }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'story_bible', content: '# 故事圣经\n' });

    const status = await getProjectStatus(state.projectPath);
    assert.equal(status.title, '灰烬证词');
    assert.equal(status.currentStep, 'architecture');
    assert.equal(status.completedSteps, 2);
    assert.equal(status.chaptersWritten, 0);
    assert.equal(status.done, false);
    assert.ok(status.files.novel);
    assert.ok(status.files.storyBible);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('getProjectStatus surfaces openThreads from memory cards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-disc-'));
  try {
    const { state } = await createProject({ workspaceRoot: root, prompt: '短篇', outputDir: 'novels', targetChapters: 1 });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '短篇',
        genre: '现实',
        premise: '...',
        language: 'zh-CN',
        style: '...',
        coreCast: [{ name: 'A', role: 'protagonist', description: 'x' }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'story_bible', content: '# bible\n' });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '...',
        volumes: [{ id: 'v1', title: 'v1', summary: 's', order: 1 }],
        chapters: [{ chapterNumber: 1, title: 't', volumeId: 'v1', summary: 's', requiredBeats: ['b1'] }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'chapter', content: '# t\n\n内容。' });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '...',
        keyEvents: ['e1'],
        entities: [{ name: 'A', type: 'person', state: 's' }],
        facts: [{ subject: 'A', predicate: 'do', object: 'x' }],
        stateChanges: [{ entity: 'A', before: 'x', after: 'y' }],
        openThreads: ['谁是真凶？'],
      }),
    });

    const status = await getProjectStatus(state.projectPath);
    assert.equal(status.chaptersWritten, 1);
    assert.deepEqual(status.openThreads, ['谁是真凶？']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
