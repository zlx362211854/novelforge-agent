import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptForStep, strictJsonOutputRules, AgentState } from '../src/core/index.js';
import { zhCNPromptPack } from '../src/core/prompts/zh-CN.js';
import { enUSPromptPack } from '../src/core/prompts/en-US.js';

function baseState(currentStep: AgentState['currentStep']): AgentState {
  return {
    projectId: 'project-1',
    projectPath: '/tmp/novel',
    initialPrompt: '写一本赛博修仙小说',
    language: 'zh-CN',
    targetChapters: 3,
    currentStep,
    currentChapter: 2,
    completedSteps: [],
    files: {},
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}

test('metadata prompt carries old bootstrap-style JSON rules', () => {
  const result = buildPromptForStep({ state: baseState('novel_metadata') });

  assert.equal(result.expectedFormat, 'JSON matching NovelMetadataSchema');
  assert.match(result.prompt, /长篇网络小说总策划/);
  assert.match(result.prompt, /coreCast/);
  assert.match(result.prompt, /只输出合法 JSON/);
});

test('chapter prompt includes continuity and style rules with supplied context', () => {
  const result = buildPromptForStep({
    state: baseState('chapter'),
    context: '## Current Chapter Architecture\n{"chapterNumber":2}',
  });

  assert.equal(result.expectedFormat, 'Markdown');
  assert.match(result.prompt, /执行优先级/);
  assert.match(result.prompt, /上一章承接/);
  assert.match(result.prompt, /Current Chapter Architecture/);
  assert.match(result.prompt, /# 章标题/);
});

test('strictJsonOutputRules rejects markdown wrapper behavior', () => {
  const rules = strictJsonOutputRules();

  assert.match(rules, /不要输出 Markdown/);
  assert.match(rules, /数组字段必须输出真实数组/);
});

test('English prompt branch returns English instructions', () => {
  const state = {
    ...baseState('architecture'),
    initialPrompt: 'Write a post-apocalyptic detective serial',
    language: 'en-US' as const,
  };
  const result = buildPromptForStep({ state });

  assert.equal(result.expectedFormat, 'JSON matching ArchitecturePayloadSchema');
  assert.match(result.prompt, /chief architect for a long-form novel/);
  assert.match(result.prompt, /Output valid JSON only/);
  assert.doesNotMatch(result.prompt, /长篇小说总架构师/);
});

test('locale prompt packs are independently selectable', () => {
  const zh = zhCNPromptPack.buildPromptForStep({ state: baseState('novel_metadata') });
  const en = enUSPromptPack.buildPromptForStep({
    state: {
      ...baseState('novel_metadata'),
      initialPrompt: 'Write a haunted lighthouse mystery',
      language: 'en-US',
    },
  });

  assert.match(zh.prompt, /长篇网络小说总策划/);
  assert.match(en.prompt, /lead planner for a long-form serialized novel/);
});
