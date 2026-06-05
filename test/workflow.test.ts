import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  getNextStep,
  submitStepResult,
  loadState,
} from '../src/core/index.js';

test('workflow advances from metadata to story bible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本废土侦探小说',
      outputDir: 'novels',
      targetChapters: 2,
    });

    const first = await getNextStep(state.projectPath);
    assert.equal(first.currentStep, 'novel_metadata');
    assert.match(first.instruction, /长篇网络小说总策划/);
    assert.match(first.instruction, /coreCast/);

    const next = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '灰烬证词',
        genre: '废土悬疑',
        premise: '侦探追查一座废弃城市的集体失忆。',
        language: 'zh-CN',
        style: '冷峻、强悬疑',
        coreCast: [{ name: '周临', role: 'protagonist', description: '废土侦探' }],
      }),
    });

    assert.equal(next.state.currentStep, 'story_bible');
    assert.match(await readFile(join(state.projectPath, 'novel.json'), 'utf8'), /灰烬证词/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('getNextStep returns English prompt when project language is en-US', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: 'Write a mystery serial about a forgotten orbital city',
      language: 'en-US',
      outputDir: 'novels',
      targetChapters: 2,
    });

    const first = await getNextStep(state.projectPath);

    assert.equal(first.currentStep, 'novel_metadata');
    assert.match(first.instruction, /lead planner for a long-form serialized novel/);
    assert.match(first.instruction, /Output valid JSON only/);
    assert.doesNotMatch(first.instruction, /长篇网络小说总策划/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid json submission is saved to recovery and does not advance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本小说',
      outputDir: 'novels',
      targetChapters: 1,
    });

    const result = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: '{ invalid json',
    });

    assert.equal(result.validation.ok, false);
    assert.equal(result.state.currentStep, 'novel_metadata');
    assert.ok(result.recoveryPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter and memory submissions advance until continuity review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本短篇小说',
      outputDir: 'novels',
      targetChapters: 1,
    });

    await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '一日归途',
        genre: '现实',
        premise: '一个人回乡处理旧事。',
        language: 'zh-CN',
        style: '细腻',
        coreCast: [{ name: '陈序', role: 'protagonist', description: '返乡者' }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'story_bible', content: '# 故事圣经\n' });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '一日内完成返乡和和解。',
        volumes: [{ id: 'v1', title: '归途', summary: '回乡', order: 1 }],
        chapters: [{ chapterNumber: 1, title: '旧车站', volumeId: 'v1', summary: '抵达', requiredBeats: ['抵达车站'] }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'chapter', content: '# 旧车站\n\n陈序下车。' });
    const afterMemory = await submitStepResult({
      projectPath: state.projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '陈序抵达旧车站。',
        keyEvents: ['陈序下车'],
        entities: [{ name: '陈序', type: 'person', state: '抵达故乡' }],
        facts: [{ subject: '陈序', predicate: '抵达', object: '旧车站' }],
        stateChanges: [{ entity: '陈序', before: '在路上', after: '到达故乡' }],
        openThreads: ['陈序为何返乡'],
      }),
    });

    assert.equal(afterMemory.state.currentStep, 'continuity_review');
    const final = await submitStepResult({
      projectPath: state.projectPath,
      step: 'continuity_review',
      content: JSON.stringify({ range: { start: 1, end: 1 }, status: 'clean', issues: [] }),
    });
    assert.equal(final.state.currentStep, 'complete');
    assert.equal((await loadState(state.projectPath)).currentStep, 'complete');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
