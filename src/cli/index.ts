#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  buildContext,
  createProject,
  getNextStep,
  getProjectStatus,
  listProjects,
  requestSideTrack,
  retrieve,
  submitStepResult,
} from '../core/index.js';

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseLanguage(value: string): 'zh-CN' | 'en-US' {
  if (value === 'zh-CN' || value === 'en-US') return value;
  throw new Error('Invalid --language. Use zh-CN or en-US');
}

export async function runCli(argv = process.argv.slice(2), cwd = process.cwd()): Promise<void> {
  const [command, projectPath] = argv;

  if (command === 'start') {
    const prompt = valueAfter(argv, '--prompt') || '';
    if (!prompt.trim()) throw new Error('Missing --prompt');
    const language = parseLanguage(valueAfter(argv, '--language') || 'zh-CN');
    const chapters = Number(valueAfter(argv, '--chapters') || 3);
    const outputDir = valueAfter(argv, '--output') || 'novels';
    const result = await createProject({ workspaceRoot: cwd, prompt, language, outputDir, targetChapters: chapters });
    const next = await getNextStep(result.state.projectPath);
    console.log(JSON.stringify({ state: result.state, next }, null, 2));
    return;
  }

  if (command === 'next') {
    if (!projectPath) throw new Error('Missing projectPath');
    console.log(JSON.stringify(await getNextStep(projectPath), null, 2));
    return;
  }

  if (command === 'submit') {
    if (!projectPath) throw new Error('Missing projectPath');
    const step = valueAfter(argv, '--step');
    const file = valueAfter(argv, '--file');
    if (!step || !file) throw new Error('Missing --step or --file');
    const content = await readFile(file, 'utf8');
    console.log(JSON.stringify(await submitStepResult({ projectPath, step: step as any, content }), null, 2));
    return;
  }

  if (command === 'context') {
    if (!projectPath) throw new Error('Missing projectPath');
    const purpose = valueAfter(argv, '--purpose') || 'chapter_generation';
    const chapter = valueAfter(argv, '--chapter');
    const start = valueAfter(argv, '--start');
    const end = valueAfter(argv, '--end');
    console.log(await buildContext({
      projectPath,
      purpose: purpose as any,
      chapterNumber: chapter ? Number(chapter) : undefined,
      range: start && end ? { start: Number(start), end: Number(end) } : undefined,
    }));
    return;
  }

  if (command === 'review') {
    if (!projectPath) throw new Error('Missing projectPath');
    const chapter = valueAfter(argv, '--chapter');
    if (!chapter) throw new Error('Missing --chapter');
    console.log(JSON.stringify(
      await requestSideTrack({ projectPath, step: 'chapter_review', chapterNumber: Number(chapter) }),
      null,
      2
    ));
    return;
  }

  if (command === 'revise') {
    if (!projectPath) throw new Error('Missing projectPath');
    const chapter = valueAfter(argv, '--chapter');
    if (!chapter) throw new Error('Missing --chapter');
    const feedbackFile = valueAfter(argv, '--feedback-file');
    const feedback = feedbackFile ? await readFile(feedbackFile, 'utf8') : valueAfter(argv, '--feedback');
    console.log(JSON.stringify(
      await requestSideTrack({ projectPath, step: 'chapter_revision', chapterNumber: Number(chapter), feedback }),
      null,
      2
    ));
    return;
  }

  if (command === 'cross-review') {
    if (!projectPath) throw new Error('Missing projectPath');
    const start = valueAfter(argv, '--start');
    const end = valueAfter(argv, '--end');
    const range = start && end ? { start: Number(start), end: Number(end) } : undefined;
    console.log(JSON.stringify(
      await requestSideTrack({ projectPath, step: 'cross_chapter_review', range }),
      null,
      2
    ));
    return;
  }

  if (command === 'list') {
    const outputDir = valueAfter(argv, '--output') || 'novels';
    console.log(JSON.stringify(await listProjects({ workspaceRoot: cwd, outputDir }), null, 2));
    return;
  }

  if (command === 'status') {
    if (!projectPath) throw new Error('Missing projectPath');
    console.log(JSON.stringify(await getProjectStatus(projectPath), null, 2));
    return;
  }

  if (command === 'retrieve') {
    if (!projectPath) throw new Error('Missing projectPath');
    const query = valueAfter(argv, '--query');
    if (!query) throw new Error('Missing --query');
    const topK = valueAfter(argv, '--top-k');
    const start = valueAfter(argv, '--start');
    const end = valueAfter(argv, '--end');
    const typesArg = valueAfter(argv, '--types');
    const types = typesArg ? (typesArg.split(',') as Array<'chapter' | 'bible' | 'memory'>) : undefined;
    const hits = await retrieve(projectPath, query, {
      topK: topK ? Number(topK) : undefined,
      types,
      chapterRange: start && end ? { start: Number(start), end: Number(end) } : undefined,
    });
    console.log(JSON.stringify({ query, hits }, null, 2));
    return;
  }

  throw new Error('Usage: novelforge-agent start|list|status|next|submit|context|review|revise|cross-review|retrieve');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
