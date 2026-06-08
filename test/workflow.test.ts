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

function cleanReview(chapterNumber: number): string {
  return JSON.stringify({
    chapterNumber,
    status: 'clean',
    acceptance: {
      requiredBeats: { status: 'pass', evidence: 'required beats are present', missingBeats: [] },
      narrativeProgress: { status: 'pass', evidence: 'the chapter advances the scene goal' },
      characterProgress: { status: 'pass', evidence: 'the protagonist state changes or is confirmed' },
      foreshadowProgress: { status: 'pass', evidence: 'the open thread remains coherent' },
      storyBibleConsistency: { status: 'pass', evidence: 'no story bible conflict' },
      proseRhythm: { status: 'pass', evidence: 'prose rhythm follows the style guide' },
      endingHook: { status: 'pass', evidence: 'the ending leaves a clear hook' },
      repetition: { status: 'pass', evidence: 'no repeated prior beat' },
    },
    issues: [],
  });
}

function styleGuide(): string {
  return JSON.stringify({
    narrativeVoice: '第三人称有限视角，克制清晰',
    pacing: '开章快入场景，章末保留钩子',
    diction: '用词稳定，避免设定堆砌',
    dialogueRules: ['对白符合人物身份，避免解释性台词'],
    prohibitedPatterns: ['不要现代网络梗', '不要空洞抒情', '不要总结腔'],
    proseRhythm: {
      sentenceRhythm: '短句只用于转折、危险或情绪落点，常规叙述以自然句群推进',
      paragraphing: '避免连续单句短段，段落应形成完整叙事单元',
      interiorityMode: '心理活动通过动作、迟疑和感官反应折射，避免频繁直白解释',
      emphasisBudget: '重复句、破折号和孤立短句少量使用',
      antiPatterns: ['连续 3 个以上单句短段', '用大量短句模拟紧张感', '每个动作后立刻解释心理', '重复同一句式制造伪节奏'],
    },
    sampleParagraph: '雨声落在旧站台上，陈序把伞沿压低，像把一段迟来的旧事也压回阴影里。',
    consistencyChecks: ['叙事视角稳定', '句式密度稳定', '章末钩子清晰'],
  });
}

async function submitStyleGuide(projectPath: string): Promise<void> {
  await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide() });
}

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

    const oldProjectPath = state.projectPath;
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
    assert.notEqual(next.state.projectPath, oldProjectPath);
    assert.match(next.state.projectPath, /灰烬证词-[a-f0-9]{6}$/);
    assert.match(await readFile(join(next.state.projectPath, 'novel.json'), 'utf8'), /灰烬证词/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('story bible submission advances to style guide before architecture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 2,
    });

    const metadata = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '云上问道',
        genre: '修仙',
        premise: '少年从山门杂役踏上问道之路。',
        language: 'zh-CN',
        style: '古典克制',
        coreCast: [{ name: '沈砚', role: 'protagonist', description: '山门杂役' }],
      }),
    });
    const projectPath = metadata.state.projectPath;

    const result = await submitStepResult({
      projectPath,
      step: 'story_bible',
      content: '# 故事圣经\n',
    });

    assert.equal(result.state.currentStep, 'style_guide');
    assert.equal(result.next?.expectedFormat, 'JSON matching StyleGuideSchema');
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
    const afterChapter = await submitStepResult({ projectPath, step: 'chapter', content: '# 旧车站\n\n陈序下车。' });
    assert.equal(afterChapter.state.currentStep, 'chapter_review');
    const afterReview = await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: cleanReview(1),
    });
    assert.equal(afterReview.state.currentStep, 'memory_card');
    const afterMemory = await submitStepResult({
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

    assert.equal(afterMemory.state.currentStep, 'continuity_review');
    const final = await submitStepResult({
      projectPath,
      step: 'continuity_review',
      content: JSON.stringify({ range: { start: 1, end: 1 }, status: 'clean', issues: [] }),
    });
    assert.equal(final.state.currentStep, 'complete');
    assert.equal((await loadState(projectPath)).currentStep, 'complete');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter review fails the gate when prose rhythm acceptance fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 1,
    });

    const metadata = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '云上问道',
        genre: '修仙',
        premise: '少年从山门杂役踏上问道之路。',
        language: 'zh-CN',
        style: '古典克制',
        coreCast: [{ name: '沈砚', role: 'protagonist', description: '山门杂役' }],
      }),
    });
    const projectPath = metadata.state.projectPath;
    await submitStepResult({ projectPath, step: 'story_bible', content: '# 故事圣经\n' });
    await submitStyleGuide(projectPath);
    await submitStepResult({
      projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '沈砚踏上问道之路。',
        volumes: [{ id: 'v1', title: '山门', summary: '入道', order: 1 }],
        chapters: [{ chapterNumber: 1, title: '山门夜雨', volumeId: 'v1', summary: '沈砚发现灵石异常', requiredBeats: ['发现灵石异常'] }],
      }),
    });
    await submitStepResult({ projectPath, step: 'chapter', content: '# 山门夜雨\n\n雨停了。\n他醒了。\n石头亮了。\n他怕了。' });

    const afterReview = await submitStepResult({
      projectPath,
      step: 'chapter_review',
      content: JSON.stringify({
        chapterNumber: 1,
        status: 'clean',
        acceptance: {
          requiredBeats: { status: 'pass', evidence: '发现灵石异常', missingBeats: [] },
          narrativeProgress: { status: 'pass', evidence: '主线启动' },
          characterProgress: { status: 'pass', evidence: '沈砚开始面对异常' },
          foreshadowProgress: { status: 'pass', evidence: '灵石异常成为伏笔' },
          storyBibleConsistency: { status: 'pass', evidence: '不冲突' },
          proseRhythm: { status: 'fail', evidence: '连续单句短段，用换行制造伪节奏' },
          endingHook: { status: 'pass', evidence: '灵石异常构成钩子' },
          repetition: { status: 'pass', evidence: '无重复桥段' },
        },
        issues: [],
      }),
    });

    assert.equal(afterReview.state.currentStep, 'chapter_revision');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workflow requests architecture extension when written chapters reach planning boundary before whole-book target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本长篇悬疑小说',
      outputDir: 'novels',
      targetChapters: 1,
      plannedTotalChapters: 2,
    });

    const metadata = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '雾港来信',
        genre: '悬疑',
        premise: '调查员在雾港追查一封改变多人命运的旧信。',
        language: 'zh-CN',
        style: '冷峻、悬疑',
        coreCast: [{ name: '林岚', role: 'protagonist', description: '调查员' }],
      }),
    });
    const projectPath = metadata.state.projectPath;
    await submitStepResult({ projectPath, step: 'story_bible', content: '# 故事圣经\n' });
    await submitStyleGuide(projectPath);
    await submitStepResult({
      projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '林岚追查旧信，最终揭开雾港真相。',
        volumes: [{ id: 'v1', title: '旧信', summary: '找到旧信源头', order: 1 }],
        chapters: [{ chapterNumber: 1, title: '雾中邮局', volumeId: 'v1', summary: '林岚收到旧信线索', requiredBeats: ['收到旧信线索'] }],
      }),
    });

    await submitStepResult({ projectPath, step: 'chapter', content: '# 雾中邮局\n\n林岚在邮局找到旧信。' });
    await submitStepResult({ projectPath, step: 'chapter_review', content: cleanReview(1) });
    const afterFirstMemory = await submitStepResult({
      projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '林岚找到旧信。',
        keyEvents: ['林岚找到旧信'],
        entities: [{ name: '林岚', type: 'person', state: '掌握旧信' }],
        facts: [{ subject: '林岚', predicate: '找到', object: '旧信' }],
        stateChanges: [{ entity: '林岚', before: '没有线索', after: '掌握旧信' }],
        openThreads: ['旧信是谁寄出的'],
      }),
    });

    assert.equal(afterFirstMemory.state.currentStep, 'architecture_extension');
    assert.equal(afterFirstMemory.state.currentChapter, 2);
    assert.match(afterFirstMemory.next?.instruction ?? '', /从第 2 章开始/);

    const afterExtension = await submitStepResult({
      projectPath,
      step: 'architecture_extension',
      content: JSON.stringify({
        chapters: [{ chapterNumber: 2, title: '灯塔回声', volumeId: 'v1', summary: '林岚追到灯塔并发现寄信人痕迹', requiredBeats: ['抵达灯塔', '发现寄信人痕迹'] }],
      }),
    });

    assert.equal(afterExtension.state.currentStep, 'chapter');
    const chapters = JSON.parse(await readFile(join(projectPath, 'architecture/chapters.json'), 'utf8')) as Array<{ chapterNumber: number }>;
    assert.deepEqual(chapters.map((chapter) => chapter.chapterNumber), [1, 2]);

    await submitStepResult({ projectPath, step: 'chapter', content: '# 灯塔回声\n\n林岚在灯塔发现寄信人的痕迹。' });
    await submitStepResult({ projectPath, step: 'chapter_review', content: cleanReview(2) });
    const afterSecondMemory = await submitStepResult({
      projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '林岚发现寄信人的痕迹。',
        keyEvents: ['林岚抵达灯塔'],
        entities: [{ name: '灯塔', type: 'location', state: '暴露线索' }],
        facts: [{ subject: '灯塔', predicate: '藏有', object: '寄信人痕迹' }],
        stateChanges: [{ entity: '林岚', before: '只有旧信', after: '接近寄信人' }],
        openThreads: ['寄信人真实身份'],
      }),
    });

    assert.equal(afterSecondMemory.state.currentStep, 'continuity_review');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
