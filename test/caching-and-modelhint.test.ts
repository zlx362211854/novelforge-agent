import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject, getNextStep, submitStepResult } from '../src/core/index.js';

const styleGuide = JSON.stringify({
  narrativeVoice: '第三人称有限',
  pacing: '稳',
  diction: '克制',
  dialogueRules: ['身份一致'],
  prohibitedPatterns: ['不要网络梗'],
  proseRhythm: {
    sentenceRhythm: '自然',
    paragraphing: '完整段落',
    interiorityMode: '折射',
    emphasisBudget: '克制',
    antiPatterns: ['连续短段'],
  },
  sampleParagraph: '风过山门。',
  consistencyChecks: ['身份一致'],
});

async function seedToChapter1(workspaceRoot: string): Promise<string> {
  const created = await createProject({ workspaceRoot, prompt: '修真短篇', outputDir: 'novels', targetChapters: 1 });
  const meta = await submitStepResult({
    projectPath: created.state.projectPath,
    step: 'novel_metadata',
    content: JSON.stringify({
      title: '九霄云途',
      genre: '修真',
      premise: '凡人觉醒上古剑灵。',
      language: 'zh-CN',
      style: '古典克制',
      coreCast: [{ name: '陈青云', role: 'protagonist', description: '少年剑修' }],
    }),
  });
  const projectPath = meta.state.projectPath;
  await submitStepResult({ projectPath, step: 'story_bible', content: '# 故事圣经\n' });
  await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide });
  await submitStepResult({
    projectPath,
    step: 'architecture',
    content: JSON.stringify({
      full: '凡人成长为剑仙。',
      volumes: [{ id: 'v1', title: '初醒', summary: '觉醒剑灵', order: 1 }],
      chapters: [{ chapterNumber: 1, title: '玉佩觉醒', volumeId: 'v1', summary: '觉醒昆吾剑灵', requiredBeats: ['玉佩亮起'] }],
    }),
  });
  return projectPath;
}

test('every step instruction carries a modelHint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-cache-'));
  try {
    const created = await createProject({ workspaceRoot: root, prompt: '修真短篇', outputDir: 'novels', targetChapters: 1 });
    // novel_metadata step → standard
    const first = await getNextStep(created.state.projectPath);
    assert.equal(first.currentStep, 'novel_metadata');
    assert.equal(first.modelHint, 'standard');
    assert.ok(Array.isArray(first.segments) && first.segments.length >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter step is "premium" and chapter prompt splits into cacheable rules + volatile chapter_meta segments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-cache-'));
  try {
    const projectPath = await seedToChapter1(root);
    const next = await getNextStep(projectPath);
    assert.equal(next.currentStep, 'chapter');
    assert.equal(next.modelHint, 'premium');

    const ids = next.segments.map((s) => s.id);
    assert.ok(ids.includes('rules'), `expected 'rules' segment, got ${ids.join(',')}`);
    assert.ok(ids.includes('chapter_meta'), `expected 'chapter_meta' segment, got ${ids.join(',')}`);

    const rules = next.segments.find((s) => s.id === 'rules');
    const meta = next.segments.find((s) => s.id === 'chapter_meta');
    assert.equal(rules?.cacheable, true, 'rules segment must be cacheable');
    assert.equal(meta?.cacheable, false, 'chapter_meta must be volatile');

    // The rules segment should be substantial (it carries AI-tic catalog etc).
    assert.ok((rules?.text.length ?? 0) > 1000, 'rules segment should be large enough to benefit from caching');
    // Sanity: a key rule string should be present.
    assert.ok(rules?.text.includes('AI 句式禁忌') || rules?.text.includes('Forbidden AI Tics'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rules segment is stable across chapters; chapter_meta differs by chapter number', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-cache-'));
  try {
    const created = await createProject({ workspaceRoot: root, prompt: '修真短篇', outputDir: 'novels', targetChapters: 2 });
    const meta = await submitStepResult({
      projectPath: created.state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '九霄云途',
        genre: '修真',
        premise: '凡人觉醒上古剑灵。',
        language: 'zh-CN',
        style: '古典克制',
        coreCast: [{ name: '陈青云', role: 'protagonist', description: '少年剑修' }],
      }),
    });
    const projectPath = meta.state.projectPath;
    await submitStepResult({ projectPath, step: 'story_bible', content: '# bible\n' });
    await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide });
    await submitStepResult({
      projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '凡人成长为剑仙。',
        volumes: [{ id: 'v1', title: '初醒', summary: '觉醒剑灵', order: 1 }],
        chapters: [
          { chapterNumber: 1, title: '玉佩觉醒', volumeId: 'v1', summary: '觉醒昆吾剑灵', requiredBeats: ['玉佩亮起'] },
          { chapterNumber: 2, title: '初下山门', volumeId: 'v1', summary: '持剑下山', requiredBeats: ['离开'] },
        ],
      }),
    });

    // Capture chapter 1 segments
    const ch1 = await getNextStep(projectPath);
    const ch1Rules = ch1.segments.find((s) => s.id === 'rules');
    const ch1Meta = ch1.segments.find((s) => s.id === 'chapter_meta');

    // Walk forward to chapter 2 by submitting ch 1 + clean review + memory
    await submitStepResult({ projectPath, step: 'chapter', content: '# 玉佩觉醒\n\n内容。' });
    await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: JSON.stringify({
        chapterNumber: 1,
        status: 'clean',
        acceptance: {
          requiredBeats: { status: 'pass', evidence: 'ok', missingBeats: [] },
          narrativeProgress: { status: 'pass', evidence: 'ok' },
          characterProgress: { status: 'pass', evidence: 'ok' },
          foreshadowProgress: { status: 'pass', evidence: 'ok' },
          storyBibleConsistency: { status: 'pass', evidence: 'ok' },
          proseRhythm: { status: 'pass', evidence: 'ok' },
          endingHook: { status: 'pass', evidence: 'ok' },
          repetition: { status: 'pass', evidence: 'ok' },
        },
        issues: [],
      }),
    });
    await submitStepResult({
      projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '...',
        keyEvents: ['e'],
        entities: [],
        facts: [],
        stateChanges: [],
        openThreads: [],
      }),
    });

    const ch2 = await getNextStep(projectPath);
    const ch2Rules = ch2.segments.find((s) => s.id === 'rules');
    const ch2Meta = ch2.segments.find((s) => s.id === 'chapter_meta');

    assert.equal(ch1Rules?.text, ch2Rules?.text, 'rules segment must be byte-identical across chapters → fully cacheable');
    assert.notEqual(ch1Meta?.text, ch2Meta?.text, 'chapter_meta must differ between chapters');
    assert.ok(ch1Meta?.text.includes('第 1 章'));
    assert.ok(ch2Meta?.text.includes('第 2 章'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('memory_card step carries cheap modelHint (host can downgrade)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-cache-'));
  try {
    const projectPath = await seedToChapter1(root);
    await submitStepResult({ projectPath, step: 'chapter', content: '# 玉佩觉醒\n\n内容。' });
    await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: JSON.stringify({
        chapterNumber: 1,
        status: 'clean',
        acceptance: {
          requiredBeats: { status: 'pass', evidence: 'ok', missingBeats: [] },
          narrativeProgress: { status: 'pass', evidence: 'ok' },
          characterProgress: { status: 'pass', evidence: 'ok' },
          foreshadowProgress: { status: 'pass', evidence: 'ok' },
          storyBibleConsistency: { status: 'pass', evidence: 'ok' },
          proseRhythm: { status: 'pass', evidence: 'ok' },
          endingHook: { status: 'pass', evidence: 'ok' },
          repetition: { status: 'pass', evidence: 'ok' },
        },
        issues: [],
      }),
    });
    const memoryStep = await getNextStep(projectPath);
    assert.equal(memoryStep.currentStep, 'memory_card');
    assert.equal(memoryStep.modelHint, 'cheap');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter_review step is "standard" and review prompt also splits rules vs review_meta', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-cache-'));
  try {
    const projectPath = await seedToChapter1(root);
    await submitStepResult({ projectPath, step: 'chapter', content: '# 玉佩觉醒\n\n内容。' });
    const reviewStep = await getNextStep(projectPath);
    assert.equal(reviewStep.currentStep, 'chapter_review');
    assert.equal(reviewStep.modelHint, 'standard');
    const ids = reviewStep.segments.map((s) => s.id);
    assert.ok(ids.includes('rules'));
    assert.ok(ids.includes('review_meta'));
    const rules = reviewStep.segments.find((s) => s.id === 'rules');
    assert.equal(rules?.cacheable, true);
    // Audit table must be in the cacheable rules block (this is the whole point of caching).
    assert.ok(rules?.text.includes('AI 句式审计') || rules?.text.includes('AI-Tic Audit'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
