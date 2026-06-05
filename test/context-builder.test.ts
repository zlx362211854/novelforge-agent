import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildContext,
  createProject,
  saveJsonFile,
  saveMarkdownFile,
} from '../src/core/index.js';

test('buildContext returns chapter generation context without dumping every file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本悬疑小说',
      outputDir: 'novels',
      targetChapters: 2,
    });
    await saveJsonFile(state.projectPath, 'novel.json', {
      title: '雾城',
      genre: '悬疑',
      premise: '调查雾中失踪案。',
      language: 'zh-CN',
      style: '冷峻',
      coreCast: [{ name: '许南', role: 'protagonist', description: '调查员' }],
    });
    await saveMarkdownFile(state.projectPath, 'story-bible.md', '# 故事圣经\n雾会吞掉记忆。\n');
    await saveJsonFile(state.projectPath, 'architecture/chapters.json', [
      { chapterNumber: 1, title: '雾起', volumeId: 'v1', summary: '失踪案出现', requiredBeats: ['发现线索'] },
    ]);

    const context = await buildContext({
      projectPath: state.projectPath,
      purpose: 'chapter_generation',
      chapterNumber: 1,
    });

    assert.match(context, /雾城/);
    assert.match(context, /雾起/);
    assert.doesNotMatch(context, /agent-state/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
