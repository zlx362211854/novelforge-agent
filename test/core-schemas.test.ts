import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NovelMetadataSchema,
  MemoryCardSchema,
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
      endingHook: { status: 'pass', evidence: 'clear hook' },
      repetition: { status: 'pass', evidence: 'no repeated beat' },
    },
    issues: [],
  });

  assert.equal(parsed.acceptance.endingHook.status, 'pass');
});

test('file name helpers are stable and padded', () => {
  assert.equal(makeProjectSlug(' 星火 长夜!! '), 'xing-huo-chang-ye');
  assert.equal(chapterFileName(3), '003.md');
  assert.equal(memoryFileName(12), 'chapter-012.json');
});
