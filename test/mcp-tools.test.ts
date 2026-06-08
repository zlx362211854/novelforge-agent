import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNovelAgentServer } from '../src/mcp/tools.js';
import {
  createProject,
  loadState,
  submitStepResult,
} from '../src/core/index.js';

test('createNovelAgentServer returns an MCP server object', () => {
  const server = createNovelAgentServer({ workspaceRoot: process.cwd() });
  assert.equal(typeof server.connect, 'function');
});

test('MCP server version follows package.json', async () => {
  const server = createNovelAgentServer({ workspaceRoot: process.cwd() });
  const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
  const info = (server as unknown as { server: { _serverInfo: { version: string } } }).server._serverInfo;

  assert.equal(info.version, pkg.version);
});

function toolHandler(server: unknown, name: string): (args: Record<string, unknown>) => Promise<unknown> {
  return (server as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }> })
    ._registeredTools[name].handler;
}

function parseTextResult(value: unknown): any {
  const text = (value as { content: Array<{ text: string }> }).content[0].text;
  return JSON.parse(text);
}

function styleGuide(): string {
  return JSON.stringify({
    narrativeVoice: '第三人称有限视角，冷静克制',
    pacing: '快速进入场景，章末留疑问',
    diction: '现实质感，避免过度抒情',
    dialogueRules: ['对白短促自然'],
    prohibitedPatterns: ['不要现代网络梗', '不要解释型旁白', '不要总结腔'],
    proseRhythm: {
      sentenceRhythm: '短句只用于转折、危险或情绪落点，常规叙述以自然句群推进',
      paragraphing: '避免连续单句短段，段落应形成完整叙事单元',
      interiorityMode: '心理活动通过动作、迟疑和感官反应折射，避免频繁直白解释',
      emphasisBudget: '重复句、破折号和孤立短句少量使用',
      antiPatterns: ['连续 3 个以上单句短段', '用大量短句模拟紧张感', '每个动作后立刻解释心理', '重复同一句式制造伪节奏'],
    },
    sampleParagraph: '雨水顺着车站的铁皮檐落下，陈序站在旧钟下，听见故乡把名字重新还给他。',
    consistencyChecks: ['叙事声音稳定', '对白自然', '无禁用模式'],
  });
}

async function submitStyleGuide(projectPath: string): Promise<void> {
  await submitStepResult({ projectPath, step: 'style_guide', content: styleGuide() });
}

test('MCP tools reject project paths outside the configured workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-mcp-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'nf-mcp-outside-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    await assert.rejects(
      () => toolHandler(server, 'get_next_step')({ projectPath: outside }),
      /outside workspace/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('MCP start_novel_project defaults to batch planning with a larger whole-book target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-mcp-start-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const result = parseTextResult(await toolHandler(server, 'start_novel_project')({
      prompt: '写一本赛博悬疑小说',
    }));

    assert.equal(result.state.targetChapters, 5);
    assert.equal(result.state.plannedTotalChapters, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP save_chapter submits through workflow and advances to chapter_review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-mcp-save-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本短篇',
      outputDir: 'novels',
      targetChapters: 1,
    });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '短篇',
        genre: '现实',
        premise: '一个人回乡处理旧事。',
        language: 'zh-CN',
        style: '细腻',
        coreCast: [{ name: '陈序', role: 'protagonist', description: '返乡者' }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'story_bible', content: '# 故事圣经\n' });
    await submitStyleGuide(state.projectPath);
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '一章完成返乡。',
        volumes: [{ id: 'v1', title: '归途', summary: '回乡', order: 1 }],
        chapters: [{ chapterNumber: 1, title: '旧车站', volumeId: 'v1', summary: '抵达', requiredBeats: ['抵达车站'] }],
      }),
    });

    const server = createNovelAgentServer({ workspaceRoot: root });
    await toolHandler(server, 'save_chapter')({
      projectPath: state.projectPath,
      chapterNumber: 1,
      title: '旧车站',
      content: '陈序下车，旧钟声在雨里敲响。',
    });

    const nextState = await loadState(state.projectPath);
    assert.equal(nextState.currentStep, 'chapter_review');
    assert.equal(nextState.files['chapter-1'], 'chapters/001.md');
    assert.match(await readFile(join(state.projectPath, 'chapters/001.md'), 'utf8'), /旧钟声/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
