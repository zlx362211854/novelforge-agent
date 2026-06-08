import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  amendStoryBible,
  applyThreadActions,
  buildContext,
  createProject,
  deleteChapter,
  forkProject,
  listStoryBibleVersions,
  loadState,
  loadCharacterStates,
  loadThreads,
  redoStep,
  retrieve,
  submitStepResult,
  updateThread,
} from '../src/core/index.js';

function cleanReview(chapterNumber: number): string {
  return JSON.stringify({
    chapterNumber,
    status: 'clean',
    acceptance: {
      requiredBeats: { status: 'pass', evidence: 'required beats are present', missingBeats: [] },
      narrativeProgress: { status: 'pass', evidence: 'the chapter advances the story' },
      characterProgress: { status: 'pass', evidence: 'the protagonist becomes a sword cultivator' },
      foreshadowProgress: { status: 'pass', evidence: 'new sword-spirit threads are coherent' },
      storyBibleConsistency: { status: 'pass', evidence: 'no story bible conflict' },
      proseRhythm: { status: 'pass', evidence: 'prose rhythm follows the style guide' },
      endingHook: { status: 'pass', evidence: 'the promise of the 九霄之路 is a hook' },
      repetition: { status: 'pass', evidence: 'no repeated prior beat' },
    },
    issues: [],
  });
}

function styleGuide(): string {
  return JSON.stringify({
    narrativeVoice: '第三人称有限视角，古典克制',
    pacing: '开章入冲突，章末留仙途承诺',
    diction: '修仙术语克制使用，避免堆砌',
    dialogueRules: ['少年对白短促坚定', '剑灵对白含蓄留白'],
    prohibitedPatterns: ['不要现代网络梗', '不要设定堆砌', '不要空洞抒情'],
    proseRhythm: {
      sentenceRhythm: '短句只用于转折、危险或情绪落点，常规叙述以自然句群推进',
      paragraphing: '避免连续单句短段，段落应形成完整叙事单元',
      interiorityMode: '心理活动通过动作、迟疑和感官反应折射，避免频繁直白解释',
      emphasisBudget: '重复句、破折号和孤立短句少量使用',
      antiPatterns: ['连续 3 个以上单句短段', '用大量短句模拟紧张感', '每个动作后立刻解释心理', '重复同一句式制造伪节奏'],
    },
    sampleParagraph: '山风掠过祖屋残檐，玉佩在陈青云掌心微微发热，像有一线沉睡千年的剑光正要醒来。',
    consistencyChecks: ['古典语感稳定', '修仙术语不过量', '对白符合身份'],
  });
}

async function submitStyleGuide(projectPath: string): Promise<void> {
  await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide() });
}

async function seedThroughChapter1(workspaceRoot: string): Promise<string> {
  const { state } = await createProject({
    workspaceRoot,
    prompt: '修仙短篇',
    outputDir: 'novels',
    targetChapters: 2,
  });

  const metadata = await submitStepResult({
    projectPath: state.projectPath,
    step: 'novel_metadata',
    content: JSON.stringify({
      title: '九霄云途',
      genre: '修仙',
      premise: '凡人觉醒上古剑灵，踏上九霄之路。',
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
  await submitStyleGuide(projectPath);
  await submitStepResult({
    projectPath,
    step: 'architecture',
    content: JSON.stringify({
      full: '凡人成长为剑仙。',
      volumes: [{ id: 'v1', title: '初醒', summary: '觉醒剑灵', order: 1 }],
      chapters: [
        { chapterNumber: 1, title: '玉佩觉醒', volumeId: 'v1', summary: '觉醒昆吾剑灵', requiredBeats: ['玉佩亮起'], targetWords: 2500 },
        { chapterNumber: 2, title: '初下山门', volumeId: 'v1', summary: '持昆吾剑下山', requiredBeats: ['离开祖屋'], endHookFocus: 'mystery' },
      ],
    }),
  });
  await submitStepResult({
    projectPath,
    step: 'chapter',
    content: '# 玉佩觉醒\n\n陈青云在祖屋醒来，昆吾剑灵第一次开口，承诺九霄之路。',
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
      summary: '陈青云觉醒昆吾剑灵。',
      keyEvents: ['玉佩亮起'],
      entities: [{ name: '昆吾剑', type: 'item', state: '初步认主' }],
      facts: [{ subject: '陈青云', predicate: '获得', object: '昆吾剑' }],
      stateChanges: [{ entity: '陈青云', before: '凡人', after: '剑修' }],
      openThreads: ['剑灵身份未明'],
      wordCount: 33,
      threadActions: [
        { kind: 'plant', description: '昆吾剑灵的真实来历' },
        { kind: 'plant', description: '陈青云祖屋为何会有此玉佩' },
      ],
      characterUpdates: [{
        name: '陈青云',
        goal: '查明昆吾剑灵的来历并踏上九霄之路',
        belief: '凡人也可以凭剑改变命运',
        relationships: [{ name: '昆吾剑灵', dynamic: '初步互信但仍有隐瞒' }],
        abilities: ['初步感应昆吾剑'],
        secrets: ['尚未理解祖屋玉佩的来源'],
        emotionalState: '震惊但被召唤感推动',
      }],
    }),
  });
  return projectPath;
}

test('threadStore: applyThreadActions plants, builds, pays, drops correctly', () => {
  let threads = applyThreadActions([], 1, [
    { kind: 'plant', description: 'A 谜' },
    { kind: 'plant', description: 'B 谜' },
  ]);
  assert.equal(threads.length, 2);
  assert.equal(threads[0].status, 'planted');
  assert.equal(threads[0].plantedAt, 1);

  const aId = threads[0].id;
  threads = applyThreadActions(threads, 2, [
    { kind: 'build', threadId: aId, description: 'A 推进' },
  ]);
  assert.equal(threads.find((t) => t.id === aId)?.status, 'building');
  assert.equal(threads.find((t) => t.id === aId)?.lastTouchedAt, 2);

  threads = applyThreadActions(threads, 3, [
    { kind: 'pay', threadId: aId, description: 'A 回收' },
  ]);
  const aPaid = threads.find((t) => t.id === aId)!;
  assert.equal(aPaid.status, 'paid');
  assert.equal(aPaid.paidOffAt, 3);

  // pay on unknown id → auto-create then mark paid
  threads = applyThreadActions(threads, 4, [
    { kind: 'pay', threadId: 't_unknown', description: 'Z 谜' },
  ]);
  const z = threads.find((t) => t.description === 'Z 谜');
  assert.ok(z);
  assert.equal(z?.status, 'paid');
});

test('memory_card submission ingests threadActions into threads.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    const threads = await loadThreads(projectPath);
    assert.equal(threads.length, 2);
    const descriptions = threads.map((t) => t.description).sort();
    assert.deepEqual(descriptions, ['昆吾剑灵的真实来历', '陈青云祖屋为何会有此玉佩']);
    assert.ok(threads.every((t) => t.status === 'planted'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('memory_card submission updates independent character state table', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    const characters = await loadCharacterStates(projectPath);
    const protagonist = characters.find((c) => c.name === '陈青云');
    assert.ok(protagonist);
    assert.equal(protagonist?.goal, '查明昆吾剑灵的来历并踏上九霄之路');
    assert.deepEqual(protagonist?.abilities, ['初步感应昆吾剑']);
    assert.equal(protagonist?.lastUpdatedAt, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter_generation context includes active foreshadow threads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    // After memoryCard, state advances; currentChapter is 2 now
    const ctx = await buildContext({
      projectPath,
      purpose: 'chapter_generation',
      chapterNumber: 2,
    });
    assert.match(ctx, /Active Foreshadow Threads/);
    assert.match(ctx, /昆吾剑灵的真实来历/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('amendStoryBible archives the old version and rebuilds the index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    const result = await amendStoryBible({
      projectPath,
      content: '# 故事圣经 v2\n\n## 核心人物\n- 陈青云：剑修少年，已觉醒昆吾剑灵。\n\n## 世界规则\n- 元婴境以上禁止干涉凡间。\n',
      reason: '加入世界规则',
    });
    assert.ok(result.archivedPath);
    const versions = await listStoryBibleVersions(projectPath);
    assert.equal(versions.length, 1);
    const current = await readFile(join(projectPath, 'story-bible.md'), 'utf8');
    assert.match(current, /元婴境以上禁止干涉凡间/);

    const hits = await retrieve(projectPath, '元婴境', { types: ['bible'] });
    assert.ok(hits.length > 0);
    assert.equal(hits[0].section, '世界规则');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('amendStoryBible refuses empty content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    await assert.rejects(
      () => amendStoryBible({ projectPath, content: '   ' }),
      /empty/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('forkProject creates an independent sibling project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    const fork = await forkProject({ sourceProjectPath: projectPath, label: 'branch-a' });
    assert.notEqual(fork.newProjectPath, projectPath);
    const original = await loadState(projectPath);
    const forked = await loadState(fork.newProjectPath);
    assert.notEqual(original.projectId, forked.projectId);
    // Files are the same content
    const ch1Orig = await readFile(join(projectPath, 'chapters/001.md'), 'utf8');
    const ch1Fork = await readFile(join(fork.newProjectPath, 'chapters/001.md'), 'utf8');
    assert.equal(ch1Orig, ch1Fork);

    // Modifying fork should not touch original
    await writeFile(join(fork.newProjectPath, 'chapters/001.md'), '# 分支一\n\n新内容。', 'utf8');
    const ch1OrigAfter = await readFile(join(projectPath, 'chapters/001.md'), 'utf8');
    assert.equal(ch1OrigAfter, ch1Orig);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deleteChapter removes files, prunes index, and rewinds state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    // We're currently at chapter 2 in state. Delete chapter 1.
    const result = await deleteChapter({ projectPath, chapterNumber: 1 });
    assert.ok(result.removed.length >= 2);
    assert.equal(result.newCurrentChapter, 1);
    assert.equal(result.newCurrentStep, 'chapter');

    await assert.rejects(() => stat(join(projectPath, 'chapters/001.md')));
    await assert.rejects(() => stat(join(projectPath, 'memory/chapter-001.json')));

    const hits = await retrieve(projectPath, '昆吾剑灵第一次开口');
    const chapterHits = hits.filter((h) => h.type === 'chapter');
    const memoryHits = hits.filter((h) => h.type === 'memory');
    assert.equal(chapterHits.length, 0, 'deleted chapter must leave no chapter-type hits');
    assert.equal(memoryHits.length, 0, 'deleted chapter must leave no memory-type hits');

    const state = await loadState(projectPath);
    assert.equal(state.files['chapter-1'], undefined);
    assert.equal(state.files['memory-1'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('redoStep rolls back metadata and clears the file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    const result = await redoStep({ projectPath, step: 'novel_metadata' });
    assert.ok(result.removed.includes('novel.json'));
    assert.equal(result.currentStep, 'novel_metadata');
    await assert.rejects(() => stat(join(projectPath, 'novel.json')));
    const state = await loadState(projectPath);
    assert.equal(state.files.novel, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('redoStep on chapter removes chapter + memory + index, rewinds to that chapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    const result = await redoStep({ projectPath, step: 'chapter', chapterNumber: 1 });
    assert.equal(result.currentStep, 'chapter');
    assert.equal(result.currentChapter, 1);
    await assert.rejects(() => stat(join(projectPath, 'chapters/001.md')));
    await assert.rejects(() => stat(join(projectPath, 'memory/chapter-001.json')));
    const hits = await retrieve(projectPath, '昆吾剑灵');
    assert.equal(hits.filter((h) => h.type === 'chapter').length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('updateThread merges patch and persists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    const before = await loadThreads(projectPath);
    const target = before[0];
    const updated = await updateThread(projectPath, target.id, {
      plannedPayoffAt: 5,
      notes: '伏笔回收预计第 5 章',
    });
    assert.equal(updated.plannedPayoffAt, 5);
    assert.equal(updated.notes, '伏笔回收预计第 5 章');

    const reloaded = await loadThreads(projectPath);
    const persisted = reloaded.find((t) => t.id === target.id);
    assert.equal(persisted?.plannedPayoffAt, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('updateThread throws on unknown id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v02-'));
  try {
    const projectPath = await seedThroughChapter1(root);
    await assert.rejects(
      () => updateThread(projectPath, 't_doesnotexist', { status: 'paid' }),
      /not found/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
