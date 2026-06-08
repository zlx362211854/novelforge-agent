import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NovelMetadataSchema,
  MemoryCardSchema,
  ArchitectureExtensionPayloadSchema,
  StyleGuideSchema,
  ChapterReviewSchema,
  makeProjectSlug,
  chapterFileName,
  memoryFileName,
} from '../src/core/index.js';

test('NovelMetadataSchema accepts required novel metadata', () => {
  const parsed = NovelMetadataSchema.parse({
    title: '星火长夜',
    genre: '科幻',
    premise: '一个失忆工程师在轨道城寻找文明断层的真相。',
    language: 'zh-CN',
    style: '克制、悬疑、强情节',
    coreCast: [
      { name: '林澈', role: 'protagonist', description: '失忆工程师' },
    ],
  });

  assert.equal(parsed.title, '星火长夜');
  assert.equal(parsed.coreCast.length, 1);
});

test('MemoryCardSchema rejects stringified arrays', () => {
  assert.throws(() => {
    MemoryCardSchema.parse({
      summary: '第一章建立主角困境。',
      keyEvents: '[]',
      entities: [],
      facts: [],
      stateChanges: [],
      openThreads: [],
    });
  }, /Expected array|array/i);
});

test('ChapterReviewSchema requires structured acceptance gate', () => {
  const parsed = ChapterReviewSchema.parse({
    chapterNumber: 1,
    status: 'clean',
    acceptance: {
      requiredBeats: { status: 'pass', evidence: 'beat completed', missingBeats: [] },
      narrativeProgress: { status: 'pass', evidence: 'main line advanced' },
      characterProgress: { status: 'pass', evidence: 'goal changed' },
      foreshadowProgress: { status: 'pass', evidence: 'thread planted' },
      storyBibleConsistency: { status: 'pass', evidence: 'no conflict' },
      proseRhythm: { status: 'pass', evidence: 'prose rhythm follows the style guide' },
      endingHook: { status: 'pass', evidence: 'clear hook' },
      repetition: { status: 'pass', evidence: 'no repeated beat' },
    },
    issues: [],
  });

  assert.equal(parsed.acceptance.endingHook.status, 'pass');
  assert.equal(parsed.acceptance.proseRhythm.status, 'pass');
});

test('ArchitectureExtensionPayloadSchema accepts chapter extension batches', () => {
  const parsed = ArchitectureExtensionPayloadSchema.parse({
    chapters: [
      {
        chapterNumber: 4,
        title: '新线索',
        volumeId: 'v1',
        summary: '主角追踪新的线索。',
        requiredBeats: ['发现线索'],
      },
    ],
  });

  assert.equal(parsed.chapters[0].chapterNumber, 4);
});

test('StyleGuideSchema requires enforceable style fields', () => {
  const parsed = StyleGuideSchema.parse({
    narrativeVoice: '第三人称有限视角，古典克制',
    pacing: '开章快入冲突，章末留钩子',
    diction: '修仙术语克制使用',
    dialogueRules: ['主角对白短促直接'],
    prohibitedPatterns: ['不要现代网络梗', '不要解释型旁白', '不要设定堆砌'],
    proseRhythm: {
      sentenceRhythm: '短句只用于转折、危险或情绪落点，常规叙述以自然句群推进',
      paragraphing: '避免连续单句短段，段落应形成完整叙事单元',
      interiorityMode: '心理活动通过动作、迟疑和感官反应折射，避免频繁直白解释',
      emphasisBudget: '重复句、破折号和孤立短句少量使用',
      antiPatterns: ['连续 3 个以上单句短段', '用大量短句模拟紧张感', '每个动作后立刻解释心理', '重复同一句式制造伪节奏'],
    },
    sampleParagraph: '山门外云气如潮，少年握住剑柄，听见灵脉在石阶下缓慢醒来。',
    consistencyChecks: ['视角稳定', '术语不过量', '对白符合身份'],
  });

  assert.equal(parsed.prohibitedPatterns.length, 3);
  assert.equal(parsed.proseRhythm.antiPatterns.length, 4);
});

test('file name helpers are stable and padded', () => {
  assert.equal(makeProjectSlug(' 星火 长夜!! '), 'xing-huo-chang-ye');
  assert.equal(makeProjectSlug(' 青云问道!! '), '青云问道');
  assert.equal(chapterFileName(3), '003.md');
  assert.equal(memoryFileName(12), 'chapter-012.json');
});
