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

function cleanReview(chapterNumber: number): string {
  return JSON.stringify({
    chapterNumber,
    status: 'clean',
    acceptance: {
      requiredBeats: { status: 'pass', evidence: 'required beats are present', missingBeats: [] },
      narrativeProgress: { status: 'pass', evidence: 'story advances' },
      characterProgress: { status: 'pass', evidence: 'character state is confirmed' },
      foreshadowProgress: { status: 'pass', evidence: 'threads remain coherent' },
      storyBibleConsistency: { status: 'pass', evidence: 'no conflict' },
      proseRhythm: { status: 'pass', evidence: 'prose rhythm follows the style guide' },
      endingHook: { status: 'pass', evidence: 'hook present' },
      repetition: { status: 'pass', evidence: 'no repeated beat' },
    },
    issues: [],
  });
}

function styleGuide(): string {
  return JSON.stringify({
    narrativeVoice: '第三人称有限视角，稳定克制',
    pacing: '场景推进清晰，章末留钩子',
    diction: '题材词汇适量，避免堆砌',
    dialogueRules: ['对白符合人物身份'],
    prohibitedPatterns: ['不要现代网络梗', '不要解释型旁白', '不要总结腔'],
    proseRhythm: {
      sentenceRhythm: '短句只用于转折、危险或情绪落点，常规叙述以自然句群推进',
      paragraphing: '避免连续单句短段，段落应形成完整叙事单元',
      interiorityMode: '心理活动通过动作、迟疑和感官反应折射，避免频繁直白解释',
      emphasisBudget: '重复句、破折号和孤立短句少量使用',
      antiPatterns: ['连续 3 个以上单句短段', '用大量短句模拟紧张感', '每个动作后立刻解释心理', '重复同一句式制造伪节奏'],
    },
    sampleParagraph: '雨线落在空城边缘，周临停下脚步，像听见某段被烧毁的证词又在灰里开口。',
    consistencyChecks: ['视角稳定', '对白身份一致', '无禁用模式'],
  });
}

async function submitStyleGuide(projectPath: string): Promise<void> {
  await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide() });
}

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
    const metadata = await submitStepResult({
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
    const projectPath = metadata.state.projectPath;
    await submitStepResult({ projectPath, step: 'story_bible', content: '# 故事圣经\n' });

    const status = await getProjectStatus(projectPath);
    assert.equal(status.title, '灰烬证词');
    assert.equal(status.currentStep, 'style_guide');
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
    const metadata = await submitStepResult({
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
    const projectPath = metadata.state.projectPath;
    await submitStepResult({ projectPath, step: 'story_bible', content: '# bible\n' });
    await submitStyleGuide(projectPath);
    await submitStepResult({
      projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '...',
        volumes: [{ id: 'v1', title: 'v1', summary: 's', order: 1 }],
        chapters: [{ chapterNumber: 1, title: 't', volumeId: 'v1', summary: 's', requiredBeats: ['b1'] }],
      }),
    });
    await submitStepResult({ projectPath, step: 'chapter', content: '# t\n\n内容。' });
    await submitStepResult({ projectPath, step: 'chapter_review', content: cleanReview(1) });
    await submitStepResult({
      projectPath,
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

    const status = await getProjectStatus(projectPath);
    assert.equal(status.chaptersWritten, 1);
    assert.deepEqual(status.openThreads, ['谁是真凶？']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
