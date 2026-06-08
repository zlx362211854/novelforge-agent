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
    await saveJsonFile(state.projectPath, 'style-guide.json', {
      narrativeVoice: '第三人称有限视角，冷峻克制',
      pacing: '开章快速进入调查场景',
      diction: '悬疑词汇克制',
      dialogueRules: ['对白短促，带潜台词'],
      prohibitedPatterns: ['不要现代网络梗', '不要解释型旁白', '不要总结腔'],
      proseRhythm: {
        sentenceRhythm: '短句只用于转折、危险或情绪落点，常规叙述以自然句群推进',
        paragraphing: '避免连续单句短段，段落应形成完整叙事单元',
        interiorityMode: '心理活动通过动作、迟疑和感官反应折射，避免频繁直白解释',
        emphasisBudget: '重复句、破折号和孤立短句少量使用',
        antiPatterns: ['连续 3 个以上单句短段', '用大量短句模拟紧张感', '每个动作后立刻解释心理', '重复同一句式制造伪节奏'],
      },
      sampleParagraph: '雾从街角压过来，许南合上记录本，像合上一段不肯安静的失踪时间。',
      consistencyChecks: ['视角稳定', '对白克制', '无禁用模式'],
    });
    await saveJsonFile(state.projectPath, 'architecture/chapters.json', [
      { chapterNumber: 1, title: '雾起', volumeId: 'v1', summary: '失踪案出现', requiredBeats: ['发现线索'] },
    ]);
    await saveJsonFile(state.projectPath, 'architecture/volume-pacing.json', [
      {
        volumeId: 'v1',
        start: '雾城第一起失踪案',
        promise: '雾会吞掉记忆',
        keyTurns: ['调查员发现雾有意识'],
        midpoint: '失踪者其实留下坐标',
        climax: '雾中档案室打开',
        payoffs: ['雾城旧案'],
        lingeringMysteries: ['雾的源头'],
      },
    ]);
    await saveJsonFile(state.projectPath, 'characters.json', {
      characters: [{
        name: '许南',
        role: 'protagonist',
        goal: '查清失踪案',
        belief: '所有失踪都有现实原因',
        relationships: [],
        abilities: ['现场观察'],
        secrets: ['曾经在雾中失忆'],
        emotionalState: '克制紧绷',
        lastUpdatedAt: 0,
      }],
    });

    const context = await buildContext({
      projectPath: state.projectPath,
      purpose: 'chapter_generation',
      chapterNumber: 1,
    });

    assert.match(context, /雾城/);
    assert.match(context, /雾起/);
    assert.match(context, /Character State Table/);
    assert.match(context, /Style Guide/);
    assert.match(context, /冷峻克制/);
    assert.match(context, /Volume Pacing Board/);
    assert.match(context, /雾会吞掉记忆/);
    assert.doesNotMatch(context, /agent-state/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
