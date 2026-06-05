import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildContext,
  createProject,
  indexChapter,
  indexStoryBible,
  indexMemoryCard,
  retrieve,
  requestSideTrack,
  submitStepResult,
} from '../src/core/index.js';
import { tokenize } from '../src/core/retrieval/tokenizer.js';

test('CJK tokenizer emits unigrams and overlapping bigrams', () => {
  const tokens = tokenize('陈青云走');
  assert.deepEqual(tokens, ['陈', '陈青', '青', '青云', '云', '云走', '走']);

  const mixed = tokenize('Chen 走入 dao-gate');
  assert.ok(mixed.includes('chen'));
  assert.ok(mixed.includes('走'));
  assert.ok(mixed.includes('走入'));
  assert.ok(mixed.includes('dao'));
  assert.ok(mixed.includes('gate'));
});

test('indexChapter + retrieve returns the chapter that contains the query phrase', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rag-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 2,
    });

    await indexChapter(state.projectPath, 1, '# 第一章\n\n陈青云在祖屋醒来，玉佩温热如初。');
    await indexChapter(state.projectPath, 2, '# 第二章\n\n陈青云持剑下山，回望昆吾山的余晖。');

    const hits = await retrieve(state.projectPath, '昆吾');
    assert.ok(hits.length > 0, 'should retrieve hits for 昆吾');
    assert.equal(hits[0].chapterNumber, 2);
    assert.equal(hits[0].type, 'chapter');
    assert.match(hits[0].text, /昆吾/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexStoryBible chunks by H2 and retrieve hits the right section', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rag-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 1,
    });
    const bible = `# 故事圣经

## 核心人物
- 陈青云：背负血仇的少年。

## 世界规则
- 元婴境以上禁止干涉凡间。
- 灵气分为五行，相生相克。
`;
    await indexStoryBible(state.projectPath, bible);
    const hits = await retrieve(state.projectPath, '元婴', { types: ['bible'] });
    assert.ok(hits.length > 0);
    assert.equal(hits[0].section, '世界规则');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexMemoryCard is searchable by entity name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rag-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 1,
    });
    await indexMemoryCard(state.projectPath, 1, {
      summary: '陈青云觉醒玉佩中的剑灵。',
      keyEvents: ['玉佩亮起', '剑灵苏醒'],
      entities: [{ name: '昆吾剑', type: 'item', state: '初步认主' }],
      facts: [{ subject: '陈青云', predicate: '获得', object: '昆吾剑' }],
      stateChanges: [{ entity: '陈青云', before: '凡人', after: '认主玉佩' }],
      openThreads: ['玉佩出处未知'],
    });
    const hits = await retrieve(state.projectPath, '昆吾剑', { types: ['memory'] });
    assert.ok(hits.length > 0);
    assert.equal(hits[0].chapterNumber, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter revision re-indexes and old phrases no longer rank', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rag-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 1,
    });
    await indexChapter(state.projectPath, 1, '# 旧版\n\n陈青云在祖屋醒来，玉佩温热如初。');
    let hits = await retrieve(state.projectPath, '祖屋');
    assert.ok(hits.length > 0, 'old phrase indexed');

    await indexChapter(state.projectPath, 1, '# 新版\n\n陈青云在山巅望日，剑鸣回荡。');
    hits = await retrieve(state.projectPath, '祖屋');
    assert.equal(hits.length, 0, 'old phrase should be removed after re-index');

    const newHits = await retrieve(state.projectPath, '剑鸣');
    assert.ok(newHits.length > 0, 'new phrase indexed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter_generation context auto-injects retrieval snippets from prior chapters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rag-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 3,
    });

    // Seed up to chapter 2 so that chapter 3 generation context can retrieve.
    await submitStepResult({
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
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'story_bible',
      content: '# 故事圣经\n\n## 核心人物\n- 陈青云：少年剑修。\n',
    });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '凡人成长为剑仙。',
        volumes: [{ id: 'v1', title: '初醒', summary: '觉醒剑灵', order: 1 }],
        chapters: [
          { chapterNumber: 1, title: '玉佩觉醒', volumeId: 'v1', summary: '陈青云觉醒昆吾剑灵', requiredBeats: ['玉佩亮起'] },
          { chapterNumber: 2, title: '初下山门', volumeId: 'v1', summary: '陈青云持昆吾剑下山', requiredBeats: ['下山'] },
          { chapterNumber: 3, title: '昆吾剑鸣', volumeId: 'v1', summary: '昆吾剑鸣引出仇家', requiredBeats: ['仇家出现'] },
        ],
      }),
    });
    // Chapter 1
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'chapter',
      content: '# 玉佩觉醒\n\n陈青云在祖屋醒来，昆吾剑灵第一次开口。',
    });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '陈青云觉醒昆吾剑灵。',
        keyEvents: ['玉佩亮起', '剑灵苏醒'],
        entities: [{ name: '昆吾剑', type: 'item', state: '初步认主' }],
        facts: [{ subject: '陈青云', predicate: '获得', object: '昆吾剑' }],
        stateChanges: [{ entity: '陈青云', before: '凡人', after: '剑修' }],
        openThreads: ['剑灵身份未明'],
      }),
    });
    // Chapter 2
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'chapter',
      content: '# 初下山门\n\n陈青云持昆吾剑跨过山门，剑鸣回荡。',
    });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '陈青云持昆吾剑下山。',
        keyEvents: ['离开祖屋'],
        entities: [{ name: '昆吾剑', type: 'item', state: '随身' }],
        facts: [{ subject: '陈青云', predicate: '离开', object: '祖屋' }],
        stateChanges: [{ entity: '陈青云', before: '在山中', after: '步入江湖' }],
        openThreads: ['剑鸣引来何人'],
      }),
    });

    const context = await buildContext({
      projectPath: state.projectPath,
      purpose: 'chapter_generation',
      chapterNumber: 3,
    });

    assert.match(context, /Retrieved Relevant Snippets/);
    assert.match(context, /昆吾/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('retrieve respects chapterRange filter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-rag-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
      targetChapters: 3,
    });
    await indexChapter(state.projectPath, 1, '# 一\n\n陈青云在祖屋。');
    await indexChapter(state.projectPath, 2, '# 二\n\n陈青云下山。');
    await indexChapter(state.projectPath, 3, '# 三\n\n陈青云遇敌。');

    const hits = await retrieve(state.projectPath, '陈青云', { chapterRange: { start: 1, end: 2 } });
    assert.ok(hits.length > 0);
    for (const hit of hits) {
      assert.ok(hit.chapterNumber !== undefined && hit.chapterNumber <= 2);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
