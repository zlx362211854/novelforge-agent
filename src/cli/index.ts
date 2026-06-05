#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  buildContext,
  createProject,
  getNextStep,
  submitStepResult,
} from '../core/index.js';

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runCli(argv = process.argv.slice(2), cwd = process.cwd()): Promise<void> {
  const [command, projectPath] = argv;

  if (command === 'start') {
    const prompt = valueAfter(argv, '--prompt') || '';
    if (!prompt.trim()) throw new Error('Missing --prompt');
    const chapters = Number(valueAfter(argv, '--chapters') || 3);
    const outputDir = valueAfter(argv, '--output') || 'novels';
    const result = await createProject({ workspaceRoot: cwd, prompt, outputDir, targetChapters: chapters });
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
    console.log(await buildContext({
      projectPath,
      purpose: purpose as any,
      chapterNumber: chapter ? Number(chapter) : undefined,
    }));
    return;
  }

  throw new Error('Usage: novelforge-agent start|next|submit|context');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
