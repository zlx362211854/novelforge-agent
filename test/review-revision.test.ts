import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  loadState,
  requestSideTrack,
  submitStepResult,
} from '../src/core/index.js';

function cleanReview(chapterNumber: number): string {
  return JSON.stringify({
    chapterNumber,
    status: 'clean',
    acceptance: {
      requiredBeats: { status: 'pass', evidence: 'required beats are present', missingBeats: [] },
      narrativeProgress: { status: 'pass', evidence: 'the chapter advances the story' },
      characterProgress: { status: 'pass', evidence: 'the protagonist state is established' },
      foreshadowProgress: { status: 'pass', evidence: 'the open thread remains coherent' },
      storyBibleConsistency: { status: 'pass', evidence: 'no story bible conflict' },
      proseRhythm: { status: 'pass', evidence: 'prose rhythm follows the style guide' },
      endingHook: { status: 'pass', evidence: 'the ending leaves a hook' },
      repetition: { status: 'pass', evidence: 'no repeated prior beat' },
    },
    issues: [],
  });
}

function failedReview(chapterNumber: number): string {
  return JSON.stringify({
    chapterNumber,
    status: 'issues_found',
    acceptance: {
      requiredBeats: { status: 'fail', evidence: 'missing required arrival beat', missingBeats: ['抵达车站'] },
      narrativeProgress: { status: 'fail', evidence: 'the chapter does not advance the main line' },
      characterProgress: { status: 'fail', evidence: 'the protagonist state is unchanged' },
      foreshadowProgress: { status: 'pass', evidence: 'no active foreshadow is contradicted' },
      storyBibleConsistency: { status: 'pass', evidence: 'no story bible conflict' },
      proseRhythm: { status: 'pass', evidence: 'prose rhythm follows the style guide' },
      endingHook: { status: 'fail', evidence: 'the ending has no hook' },
      repetition: { status: 'pass', evidence: 'no repeated prior beat' },
    },
    issues: [{
      severity: 'medium',
      category: 'architecture',
      description: '未完成本章 requiredBeats',
      evidence: '正文只有“陈序下车”',
      suggestion: '补足抵达车站和章末钩子',
    }],
  });
}

function styleGuide(): string {
  return JSON.stringify({
    narrativeVoice: '第三人称有限视角，细腻克制',
    pacing: '开章承接明确，章末留情绪钩子',
    diction: '现实质感，句式不过度华丽',
    dialogueRules: ['对白自然，避免说明式台词'],
    prohibitedPatterns: ['不要现代网络梗', '不要空洞抒情', '不要总结腔'],
    proseRhythm: {
      sentenceRhythm: '短句只用于转折、危险或情绪落点，常规叙述以自然句群推进',
      paragraphing: '避免连续单句短段，段落应形成完整叙事单元',
      interiorityMode: '心理活动通过动作、迟疑和感官反应折射，避免频繁直白解释',
      emphasisBudget: '重复句、破折号和孤立短句少量使用',
      antiPatterns: ['连续 3 个以上单句短段', '用大量短句模拟紧张感', '每个动作后立刻解释心理', '重复同一句式制造伪节奏'],
    },
    sampleParagraph: '旧车站的灯忽明忽暗，陈序站在雨里，忽然觉得故乡从来没有真正放过他。',
    consistencyChecks: ['现实语感稳定', '对白自然', '章末钩子存在'],
  });
}

async function submitStyleGuide(projectPath: string): Promise<void> {
  await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide() });
}

async function seedProjectToChapter1(workspaceRoot: string) {
  const { state } = await createProject({
    workspaceRoot,
    prompt: '写一本短篇小说',
    outputDir: 'novels',
    targetChapters: 1,
    lengthPreset: 'short',
    plannedTotalChapters: 1,
  });

  const metadata = await submitStepResult({
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
  const projectPath = metadata.state.projectPath;
  await submitStepResult({ projectPath, step: 'story_bible', content: '# 故事圣经\n' });
  await submitStyleGuide(projectPath);
  await submitStepResult({
    projectPath,
    step: 'architecture',
    content: JSON.stringify({
      full: '一日内完成返乡和和解。',
      volumes: [{ id: 'v1', title: '归途', summary: '回乡', order: 1 }],
      chapters: [{ chapterNumber: 1, title: '旧车站', volumeId: 'v1', summary: '抵达', requiredBeats: ['抵达车站'] }],
    }),
  });
  await submitStepResult({
    projectPath,
    step: 'chapter',
    content: '# 旧车站\n\n陈序下车。',
  });
  await submitStepResult({
    projectPath,
    step: 'chapter_review',
    content: cleanReview(1),
  });
  await submitStepResult({
    projectPath,
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
  return projectPath;
}

test('chapter_review side-track saves report and resumes original step', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rev-'));
  try {
    const projectPath = await seedProjectToChapter1(root);
    const beforeState = await loadState(projectPath);
    assert.equal(beforeState.currentStep, 'continuity_review');

    const sideTrack = await requestSideTrack({ projectPath, step: 'chapter_review', chapterNumber: 1 });
    assert.equal(sideTrack.currentStep, 'chapter_review');
    assert.match(sideTrack.instruction, /审稿编辑|strict editor/);
    assert.match(sideTrack.context, /陈序下车/);

    const submitted = await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: JSON.stringify({
        chapterNumber: 1,
        status: 'issues_found',
        acceptance: {
          requiredBeats: { status: 'fail', evidence: '抵达车站没有足够展开', missingBeats: ['补充抵达环境'] },
          narrativeProgress: { status: 'fail', evidence: '主线推进不足' },
          characterProgress: { status: 'fail', evidence: '人物状态变化不足' },
          foreshadowProgress: { status: 'pass', evidence: '没有破坏伏笔' },
          storyBibleConsistency: { status: 'pass', evidence: '不冲突' },
          proseRhythm: { status: 'pass', evidence: 'prose rhythm follows the style guide' },
          endingHook: { status: 'fail', evidence: '章末没有钩子' },
          repetition: { status: 'pass', evidence: '无重复桥段' },
        },
        issues: [{
          severity: 'medium',
          category: 'pacing',
          description: '抵达过于平淡',
          evidence: '只有 \"陈序下车\"',
          suggestion: '补充环境与心绪描写',
        }],
      }),
    });

    assert.equal(submitted.validation.ok, true);
    assert.equal(submitted.state.currentStep, 'continuity_review');
    assert.equal(submitted.state.pendingAction, undefined);

    const reviewPath = join(projectPath, 'reviews/chapter/chapter-001.json');
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    assert.equal(review.chapterNumber, 1);
    assert.equal(review.status, 'issues_found');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('automatic chapter gate forces revision until clean review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rev-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本短篇小说',
      outputDir: 'novels',
      targetChapters: 1,
    });
    const metadata = await submitStepResult({
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
    const projectPath = metadata.state.projectPath;
    await submitStepResult({ projectPath, step: 'story_bible', content: '# 故事圣经\n' });
    await submitStyleGuide(projectPath);
    await submitStepResult({
      projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '一日内完成返乡和和解。',
        volumes: [{ id: 'v1', title: '归途', summary: '回乡', order: 1 }],
        chapters: [{ chapterNumber: 1, title: '旧车站', volumeId: 'v1', summary: '抵达', requiredBeats: ['抵达车站'] }],
      }),
    });

    const afterChapter = await submitStepResult({
      projectPath,
      step: 'chapter',
      content: '# 旧车站\n\n陈序下车。',
    });
    assert.equal(afterChapter.state.currentStep, 'chapter_review');

    const afterFailedReview = await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: failedReview(1),
    });
    assert.equal(afterFailedReview.state.currentStep, 'chapter_revision');

    const afterRevision = await submitStepResult({
      projectPath,
      step: 'chapter_revision',
      content: '# 旧车站\n\n陈序下车，旧车站的钟声把他十年前逃离的秘密重新敲醒。',
    });
    assert.equal(afterRevision.state.currentStep, 'chapter_review');

    const afterCleanReview = await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: cleanReview(1),
    });
    assert.equal(afterCleanReview.state.currentStep, 'memory_card');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter_revision archives previous version and overwrites current chapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rev-'));
  try {
    const projectPath = await seedProjectToChapter1(root);
    await requestSideTrack({
      projectPath,
      step: 'chapter_revision',
      chapterNumber: 1,
      feedback: '让抵达更有重量感',
    });

    const submitted = await submitStepResult({
      projectPath,
      step: 'chapter_revision',
      content: '# 旧车站\n\n陈序下车，月台尽头的风吹动他十年未触的衣角。',
    });

    assert.equal(submitted.validation.ok, true);
    const chapter = await readFile(join(projectPath, 'chapters/001.md'), 'utf8');
    assert.match(chapter, /月台尽头/);

    const versions = await readdir(join(projectPath, 'chapters/.versions'));
    assert.equal(versions.length, 1, 'previous chapter version should be archived');
    const archived = await readFile(join(projectPath, 'chapters/.versions', versions[0]), 'utf8');
    assert.match(archived, /陈序下车\.?\n?$|陈序下车/);
    assert.doesNotMatch(archived, /月台尽头/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cross_chapter_review defaults range to generated chapters and persists report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rev-'));
  try {
    const projectPath = await seedProjectToChapter1(root);
    const sideTrack = await requestSideTrack({ projectPath, step: 'cross_chapter_review' });
    assert.equal(sideTrack.currentStep, 'cross_chapter_review');
    assert.match(sideTrack.instruction, /1-1/);

    const submitted = await submitStepResult({
      projectPath,
      step: 'cross_chapter_review',
      content: JSON.stringify({
        range: { start: 1, end: 1 },
        status: 'clean',
        issues: [],
      }),
    });

    assert.equal(submitted.validation.ok, true);
    assert.equal(submitted.state.currentStep, 'continuity_review');
    const report = JSON.parse(await readFile(join(projectPath, 'reviews/cross/cross-001-001.json'), 'utf8'));
    assert.equal(report.status, 'clean');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema-mismatched review submission is recovered and does not advance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rev-'));
  try {
    const projectPath = await seedProjectToChapter1(root);
    await requestSideTrack({ projectPath, step: 'chapter_review', chapterNumber: 1 });

    const submitted = await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: JSON.stringify({ chapterNumber: 1, status: 'nope', issues: [] }),
    });

    assert.equal(submitted.validation.ok, false);
    assert.equal(submitted.state.currentStep, 'chapter_review');
    assert.ok(submitted.recoveryPath, 'recovery file should be written');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
