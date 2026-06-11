import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  // Markdown-with-fenced-JSON format (verbose mode): extract the ```json ... ``` block.
  const fenced = text.match(/```json\n([\s\S]*?)\n```/);
  if (fenced) return JSON.parse(fenced[1]);
  // Legacy pure-JSON format.
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

test('MCP tools reject project paths outside the configured workspace when NOVELFORGE_STRICT_WORKSPACE=1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-mcp-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'nf-mcp-outside-'));
  const prev = process.env.NOVELFORGE_STRICT_WORKSPACE;
  process.env.NOVELFORGE_STRICT_WORKSPACE = '1';
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    await assert.rejects(
      () => toolHandler(server, 'get_next_step')({ projectPath: outside }),
      /Strict mode/i
    );
  } finally {
    if (prev === undefined) delete process.env.NOVELFORGE_STRICT_WORKSPACE;
    else process.env.NOVELFORGE_STRICT_WORKSPACE = prev;
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
      verbose: true,
    }));

    assert.equal(result.state.targetChapters, 5);
    assert.equal(result.state.lengthPreset, 'medium');
    assert.equal(result.state.plannedTotalChapters, 100);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP amend_novel_metadata renames project directory when title changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-mcp-amend-meta-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本修仙小说',
      outputDir: 'novels',
    });
    const metadata = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '旧书名',
        genre: '修仙',
        premise: '少年从外门起步。',
        language: 'zh-CN',
        style: '轻松连载',
        coreCast: [{ name: '林北', role: 'protagonist', description: '外门弟子' }],
      }),
    });

    const oldProjectPath = metadata.state.projectPath;
    const server = createNovelAgentServer({ workspaceRoot: root });
    const result = parseTextResult(await toolHandler(server, 'amend_novel_metadata')({
      projectPath: oldProjectPath,
      title: '灵石会下崽',
      verbose: true,
    }));

    assert.equal(result.renamed, true);
    assert.notEqual(result.projectPath, oldProjectPath);
    assert.match(result.projectPath, /灵石会下崽-[a-f0-9]{6}/);
    await assert.rejects(() => stat(oldProjectPath));

    const nextState = await loadState(result.projectPath);
    assert.equal(nextState.projectPath, result.projectPath);
    assert.equal(nextState.files.novel, 'novel.json');
    assert.match(await readFile(join(result.projectPath, 'novel.json'), 'utf8'), /灵石会下崽/);
    assert.match(await readFile(join(result.projectPath, 'novel.json'), 'utf8'), /少年从外门起步。/);
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
    const metadata = await submitStepResult({
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
    const projectPath = metadata.state.projectPath;
    await submitStepResult({ projectPath, step: 'story_bible', content: '# 故事圣经\n' });
    await submitStyleGuide(projectPath);
    await submitStepResult({
      projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '一章完成返乡。',
        volumes: [{ id: 'v1', title: '归途', summary: '回乡', order: 1 }],
        chapters: [{ chapterNumber: 1, title: '旧车站', volumeId: 'v1', summary: '抵达', requiredBeats: ['抵达车站'] }],
      }),
    });

    const server = createNovelAgentServer({ workspaceRoot: root });
    const longContent = `${'陈序沿着站台往前走，雨声盖住旧钟。'.repeat(2000)}\n\nUNIQUE_LONG_CHAPTER_MARKER`;
    await writeFile(join(projectPath, '.agent-recovery/chapter-001-draft.md'), longContent, 'utf8');
    const saveRaw = (await toolHandler(server, 'save_chapter')({
      projectPath,
      chapterNumber: 1,
      title: '旧车站',
      contentPath: '.agent-recovery/chapter-001-draft.md',
      verbose: true,
    }) as { content: Array<{ text: string }> }).content[0].text;
    const saveResult = parseTextResult({ content: [{ text: saveRaw }] });

    assert.equal(saveResult.validation.ok, true);
    assert.equal(saveResult.state.currentStep, 'chapter_review');
    assert.equal(saveResult.next.currentStep, 'chapter_review');
    assert.equal(saveResult.next.contextLength > 0, true);
    assert.equal('context' in saveResult.next, false);
    assert.equal('instruction' in saveResult.next, false);
    assert.equal(saveRaw.includes('UNIQUE_LONG_CHAPTER_MARKER'), false);
    // verbose markdown summary + raw JSON
    assert.equal(saveRaw.length < 8000, true);

    const nextState = await loadState(projectPath);
    assert.equal(nextState.currentStep, 'chapter_review');
    assert.equal(nextState.files['chapter-1'], 'chapters/001.md');
    assert.match(await readFile(join(projectPath, 'chapters/001.md'), 'utf8'), /UNIQUE_LONG_CHAPTER_MARKER/);

    const nextRaw = (await toolHandler(server, 'get_next_step')({ projectPath, verbose: true }) as { content: Array<{ text: string }> }).content[0].text;
    const next = parseTextResult({ content: [{ text: nextRaw }] });
    assert.equal(next.currentStep, 'chapter_review');
    assert.equal(next.contextTruncated, true);
    assert.equal('context' in next, false);
    assert.equal(next.instructionTruncated, true);
    assert.equal('instruction' in next, false);
    assert.equal(typeof next.instructionPreview, 'string');
    assert.equal(typeof next.contextPreview, 'string');
    assert.equal(next.instructionPreview.length <= 8_000, true);
    assert.equal(next.contextPreview.length <= 8_000, true);
    // verbose=true appends markdown summary + raw JSON; allow some headroom.
    assert.equal(nextRaw.length < 40_000, true);

    const fullContext = JSON.parse(await readFile(next.fullContextPath, 'utf8'));
    assert.match(fullContext.instruction, /UNIQUE_LONG_CHAPTER_MARKER/);
    assert.match(fullContext.context, /UNIQUE_LONG_CHAPTER_MARKER/);

    const logRaw = await readFile(join(projectPath, '.agent-logs/events.jsonl'), 'utf8');
    assert.equal(logRaw.includes('UNIQUE_LONG_CHAPTER_MARKER'), false);

    const loggedEvents = logRaw.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(loggedEvents.some((event) => event.type === 'tool_call_start' && event.tool === 'save_chapter'), true);
    assert.equal(loggedEvents.some((event) => event.type === 'tool_call_end' && event.tool === 'save_chapter'), true);
    assert.equal(loggedEvents.some((event) => event.type === 'state_transition'), true);

    const recent = parseTextResult(await toolHandler(server, 'get_recent_events')({ projectPath, limit: 20 }));
    assert.equal(recent.events.some((event: any) => event.type === 'state_transition'), true);

    const runs = parseTextResult(await toolHandler(server, 'list_runs')({ projectPath, limit: 20 }));
    const saveRun = runs.runs.find((run: any) => run.tool === 'save_chapter');
    assert.equal(saveRun.status, 'ok');
    assert.equal(typeof saveRun.runId, 'string');

    const runLog = parseTextResult(await toolHandler(server, 'get_run_log')({ projectPath, runId: saveRun.runId }));
    assert.equal(runLog.events.some((event: any) => event.type === 'tool_call_start'), true);
    assert.equal(runLog.events.some((event: any) => event.type === 'tool_call_end'), true);

    const artifact = parseTextResult(await toolHandler(server, 'get_artifact_summary')({ projectPath, path: 'chapters/001.md' }));
    assert.equal(artifact.path, 'chapters/001.md');
    assert.equal(artifact.bytes > 0, true);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP submit_step_result returns compact mutation output without next context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-mcp-submit-'));
  try {
    const server = createNovelAgentServer({ workspaceRoot: root });
    const start = parseTextResult(await toolHandler(server, 'start_novel_project')({
      prompt: '写一本现实小说',
      targetChapters: 1,
      plannedTotalChapters: 1,
      verbose: true,
    }));

    const result = parseTextResult(await toolHandler(server, 'submit_step_result')({
      projectPath: start.state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '归途',
        genre: '现实',
        premise: '一个人回乡处理旧事。',
        language: 'zh-CN',
        style: '细腻',
        coreCast: [{ name: '陈序', role: 'protagonist', description: '返乡者' }],
      }),
      verbose: true,
    }));

    assert.equal(result.validation.ok, true);
    assert.equal(result.state.currentStep, 'story_bible');
    assert.equal(result.next.currentStep, 'story_bible');
    assert.equal('context' in result.next, false);
    assert.equal('instruction' in result.next, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
