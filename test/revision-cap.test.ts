import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  forceAdvanceChapter,
  getProjectStatus,
  loadState,
  submitStepResult,
} from '../src/core/index.js';

function issuesReview(chapterNumber: number, missingBeats: string[] = ['玉佩亮起']): string {
  return JSON.stringify({
    chapterNumber,
    status: 'issues_found',
    acceptance: {
      requiredBeats: { status: 'fail', evidence: '关键 beat 缺失', missingBeats },
      narrativeProgress: { status: 'pass', evidence: 'ok' },
      characterProgress: { status: 'pass', evidence: 'ok' },
      foreshadowProgress: { status: 'pass', evidence: 'ok' },
      storyBibleConsistency: { status: 'pass', evidence: 'ok' },
      proseRhythm: { status: 'pass', evidence: 'ok' },
      endingHook: { status: 'pass', evidence: 'ok' },
      repetition: { status: 'pass', evidence: 'ok' },
    },
    issues: [{
      severity: 'high',
      category: 'architecture',
      description: 'missing required beat 玉佩亮起',
      evidence: '正文未体现玉佩亮起',
      suggestion: '补回该 beat',
    }],
  });
}

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
  sampleParagraph: '风过山门，少年握紧玉佩。',
  consistencyChecks: ['身份一致'],
});

async function seedToChapter1Review(workspaceRoot: string): Promise<string> {
  const created = await createProject({
    workspaceRoot,
    prompt: '修仙短篇',
    outputDir: 'novels',
    targetChapters: 1,
  });
  const metadata = await submitStepResult({
    projectPath: created.state.projectPath,
    step: 'novel_metadata',
    content: JSON.stringify({
      title: '九霄云途',
      genre: '修仙',
      premise: '凡人觉醒上古剑灵。',
      language: 'zh-CN',
      style: '古典克制',
      coreCast: [{ name: '陈青云', role: 'protagonist', description: '少年剑修' }],
    }),
  });
  const projectPath = metadata.state.projectPath;
  await submitStepResult({
    projectPath,
    step: 'story_bible',
    content: '# 故事圣经\n\n## 核心人物\n- 陈青云：少年剑修。\n',
  });
  await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide });
  await submitStepResult({
    projectPath,
    step: 'architecture',
    content: JSON.stringify({
      full: '凡人成长为剑仙。',
      volumes: [{ id: 'v1', title: '初醒', summary: '觉醒剑灵', order: 1 }],
      chapters: [
        { chapterNumber: 1, title: '玉佩觉醒', volumeId: 'v1', summary: '陈青云觉醒昆吾剑灵', requiredBeats: ['玉佩亮起'] },
      ],
    }),
  });
  await submitStepResult({
    projectPath,
    step: 'chapter',
    content: '# 玉佩觉醒\n\n陈青云在祖屋醒来，昆吾剑灵第一次开口。',
  });
  return projectPath;
}

test('revision loop hits cap after 3 rounds and force-advances to memory_card', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-revcap-'));
  try {
    const projectPath = await seedToChapter1Review(root);
    // We are now at chapter_review (gate). Submit 3 failing reviews; each one
    // should kick chapter_revision then come back. Between reviews we submit a
    // dummy revised chapter to walk the gate forward.
    for (let round = 1; round <= 3; round += 1) {
      const reviewResult = await submitStepResult({
        projectPath,
        step: 'chapter_review',
        content: issuesReview(1),
      });
      assert.equal(reviewResult.validation.ok, true);
      assert.equal(reviewResult.state.currentStep, 'chapter_revision', `round ${round} should enter revision`);
      assert.equal(reviewResult.state.revisionCounts?.[1], round, `round ${round} counter`);

      const revisionResult = await submitStepResult({
        projectPath,
        step: 'chapter_revision',
        content: `# 玉佩觉醒\n\n第 ${round} 次修订：陈青云握住玉佩，听见昆吾剑发出第一声。`,
      });
      assert.equal(revisionResult.validation.ok, true);
      assert.equal(revisionResult.state.currentStep, 'chapter_review', `round ${round} should bounce back to review`);
    }

    // Fourth failing review should hit the cap and force-advance to memory_card.
    const fourth = await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: issuesReview(1),
    });
    assert.equal(fourth.validation.ok, true);
    assert.equal(fourth.state.currentStep, 'memory_card', 'cap exceeded → memory_card');
    assert.deepEqual(fourth.state.forceAdvanced, [1]);
    assert.equal(fourth.state.revisionCounts?.[1], undefined, 'counter cleared');

    const status = await getProjectStatus(projectPath);
    assert.deepEqual(status.forceAdvanced, [1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('clean review at any time clears the revision counter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-revcap-'));
  try {
    const projectPath = await seedToChapter1Review(root);
    // One failing round
    await submitStepResult({ projectPath, step: 'chapter_review', content: issuesReview(1) });
    await submitStepResult({
      projectPath,
      step: 'chapter_revision',
      content: '# 玉佩觉醒\n\n修订：陈青云握住玉佩，听见昆吾剑发出第一声。',
    });

    // Now a clean review
    const clean = await submitStepResult({
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
    assert.equal(clean.validation.ok, true);
    assert.equal(clean.state.currentStep, 'memory_card');
    assert.equal(clean.state.revisionCounts?.[1], undefined, 'counter cleared on clean');
    assert.deepEqual(clean.state.forceAdvanced ?? [], []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('forceAdvanceChapter manually exits the gate at any time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-revcap-'));
  try {
    const projectPath = await seedToChapter1Review(root);
    // One failing round → state at chapter_revision
    await submitStepResult({ projectPath, step: 'chapter_review', content: issuesReview(1) });
    const before = await loadState(projectPath);
    assert.equal(before.currentStep, 'chapter_revision');

    const result = await forceAdvanceChapter({ projectPath });
    assert.equal(result.currentStep, 'memory_card');
    assert.deepEqual(result.forceAdvanced, [1]);

    const after = await loadState(projectPath);
    assert.equal(after.currentStep, 'memory_card');
    assert.equal(after.pendingAction, undefined);
    assert.equal(after.revisionCounts?.[1], undefined);
    assert.deepEqual(after.forceAdvanced, [1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
