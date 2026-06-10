#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  amendNovelMetadata,
  amendStoryBible,
  buildContext,
  createProject,
  deleteChapter,
  forkProject,
  getNextStep,
  getProjectStatus,
  listProjects,
  loadThreads,
  forceAdvanceChapter,
  redoStep,
  requestSideTrack,
  retrieve,
  submitStepResult,
  updateThread,
} from '../core/index.js';
import { formatInstallResult, runInstall, InstallHost } from './install.js';

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseLanguage(value: string): 'zh-CN' | 'en-US' {
  if (value === 'zh-CN' || value === 'en-US') return value;
  throw new Error('Invalid --language. Use zh-CN or en-US');
}

function parseLengthPreset(value: string | undefined): 'short' | 'medium' | 'long' {
  const v = value || 'medium';
  if (v === 'short' || v === 'medium' || v === 'long') return v;
  throw new Error('Invalid --length. Use short | medium | long');
}

function parseHost(value: string | undefined): InstallHost {
  const v = (value || 'claude-code').toLowerCase();
  if (v === 'claude-code' || v === 'claude') return 'claude-code';
  if (v === 'codex' || v === 'codex-cli') return 'codex';
  if (v === 'cursor') return 'cursor';
  throw new Error(`Unknown --host: ${value}. Use claude-code | codex | cursor.`);
}

export async function runCli(argv = process.argv.slice(2), cwd = process.cwd()): Promise<void> {
  const [command, projectPath] = argv;

  if (command === 'install') {
    const result = await runInstall({
      host: parseHost(valueAfter(argv, '--host')),
      workspace: valueAfter(argv, '--workspace'),
      name: valueAfter(argv, '--name'),
      printOnly: argv.includes('--print-only'),
    });
    console.log(formatInstallResult(result));
    return;
  }

  if (command === 'start') {
    const prompt = valueAfter(argv, '--prompt') || '';
    if (!prompt.trim()) throw new Error('Missing --prompt');
    const language = parseLanguage(valueAfter(argv, '--language') || 'zh-CN');
    const chapters = Number(valueAfter(argv, '--chapters') || 5);
    const totalChapters = valueAfter(argv, '--total-chapters');
    const lengthPreset = parseLengthPreset(valueAfter(argv, '--length'));
    const outputDir = valueAfter(argv, '--output') || 'novels';
    const result = await createProject({
      workspaceRoot: cwd,
      prompt,
      language,
      outputDir,
      targetChapters: chapters,
      lengthPreset,
      plannedTotalChapters: totalChapters ? Number(totalChapters) : undefined,
    });
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

  if (command === 'amend-bible') {
    if (!projectPath) throw new Error('Missing projectPath');
    const file = valueAfter(argv, '--file');
    const reason = valueAfter(argv, '--reason');
    if (!file) throw new Error('Missing --file with new bible Markdown');
    const content = await readFile(file, 'utf8');
    console.log(JSON.stringify(await amendStoryBible({ projectPath, content, reason }), null, 2));
    return;
  }

  if (command === 'amend-metadata') {
    if (!projectPath) throw new Error('Missing projectPath');
    const file = valueAfter(argv, '--file');
    const content = file ? await readFile(file, 'utf8') : undefined;
    console.log(JSON.stringify(await amendNovelMetadata({
      projectPath,
      content,
      title: valueAfter(argv, '--title'),
      genre: valueAfter(argv, '--genre'),
      premise: valueAfter(argv, '--premise'),
      language: valueAfter(argv, '--language'),
      style: valueAfter(argv, '--style'),
      reason: valueAfter(argv, '--reason'),
    }), null, 2));
    return;
  }

  if (command === 'threads') {
    if (!projectPath) throw new Error('Missing projectPath');
    const status = valueAfter(argv, '--status') as 'planted' | 'building' | 'paid' | 'dropped' | undefined;
    const all = await loadThreads(projectPath);
    const filtered = status ? all.filter((t) => t.status === status) : all;
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (command === 'update-thread') {
    if (!projectPath) throw new Error('Missing projectPath');
    const id = valueAfter(argv, '--id');
    if (!id) throw new Error('Missing --id');
    const status = valueAfter(argv, '--status') as 'planted' | 'building' | 'paid' | 'dropped' | undefined;
    const plannedPayoffAt = valueAfter(argv, '--planned-payoff');
    const description = valueAfter(argv, '--description');
    const notes = valueAfter(argv, '--notes');
    const updated = await updateThread(projectPath, id, {
      status,
      plannedPayoffAt: plannedPayoffAt ? Number(plannedPayoffAt) : undefined,
      description,
      notes,
    });
    console.log(JSON.stringify(updated, null, 2));
    return;
  }

  if (command === 'fork') {
    if (!projectPath) throw new Error('Missing projectPath');
    const label = valueAfter(argv, '--label');
    console.log(JSON.stringify(await forkProject({ sourceProjectPath: projectPath, label }), null, 2));
    return;
  }

  if (command === 'delete-chapter') {
    if (!projectPath) throw new Error('Missing projectPath');
    const chapter = valueAfter(argv, '--chapter');
    if (!chapter) throw new Error('Missing --chapter');
    console.log(JSON.stringify(await deleteChapter({ projectPath, chapterNumber: Number(chapter) }), null, 2));
    return;
  }

  if (command === 'force-advance') {
    if (!projectPath) throw new Error('Missing projectPath');
    const chapter = valueAfter(argv, '--chapter');
    const reason = valueAfter(argv, '--reason');
    console.log(JSON.stringify(await forceAdvanceChapter({
      projectPath,
      chapterNumber: chapter ? Number(chapter) : undefined,
      reason,
    }), null, 2));
    return;
  }

  if (command === 'redo') {
    if (!projectPath) throw new Error('Missing projectPath');
    const step = valueAfter(argv, '--step') as
      | 'novel_metadata' | 'story_bible' | 'style_guide' | 'architecture' | 'chapter' | 'memory_card' | 'continuity_review'
      | undefined;
    if (!step) throw new Error('Missing --step');
    const chapter = valueAfter(argv, '--chapter');
    console.log(JSON.stringify(await redoStep({
      projectPath,
      step,
      chapterNumber: chapter ? Number(chapter) : undefined,
    }), null, 2));
    return;
  }

  throw new Error('Usage: novelforge-agent install|start|list|status|next|submit|context|review|revise|cross-review|retrieve|amend-metadata|amend-bible|threads|update-thread|fork|delete-chapter|redo|force-advance');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
