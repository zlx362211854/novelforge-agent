import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  amendStoryBible,
  assertProjectPath,
  buildContext,
  createProject,
  deleteChapter,
  forkProject,
  getNextStep,
  getProjectStatus,
  listProjects,
  listStoryBibleVersions,
  loadState,
  loadThreads,
  redoStep,
  requestSideTrack,
  retrieve,
  submitStepResult,
  updateThread,
} from '../core/index.js';

function packageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version) return parsed.version;
    } catch {
      // keep walking upward until the package root is found
    }

    const parent = dirname(dir);
    if (parent === dir) return '0.0.0';
    dir = parent;
  }
}

const MCP_SERVER_VERSION = packageVersion();

export interface CreateNovelAgentServerOptions {
  workspaceRoot: string;
}

function textResult(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

export function createNovelAgentServer(options: CreateNovelAgentServerOptions): McpServer {
  function checkedProjectPath(projectPath: string): string {
    assertProjectPath(options.workspaceRoot, projectPath);
    return projectPath;
  }

  function checkedOutputDir(outputDir: string): string {
    assertProjectPath(options.workspaceRoot, resolve(options.workspaceRoot, outputDir));
    return outputDir;
  }

  const server = new McpServer({
    name: 'novelforge-agent',
    version: MCP_SERVER_VERSION,
  });

  server.tool(
    'start_novel_project',
    'Create a local novel project and return the first generation instruction.',
    {
      prompt: z.string().min(1),
      language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      outputDir: z.string().default('novels'),
      targetChapters: z.number().int().positive().default(5),
      plannedTotalChapters: z.number().int().positive().default(12),
    },
    async ({ prompt, language, outputDir, targetChapters, plannedTotalChapters }) => {
      const result = await createProject({
        workspaceRoot: options.workspaceRoot,
        prompt,
        language,
        outputDir,
        targetChapters,
        plannedTotalChapters,
      });
      return textResult({ state: result.state, next: await getNextStep(result.state.projectPath) });
    }
  );

  server.tool(
    'list_projects',
    'List all NovelForge projects under the workspace, sorted by most recently updated. Use this to find an existing projectPath instead of asking the user.',
    {
      outputDir: z.string().default('novels'),
    },
    async ({ outputDir }) =>
      textResult(await listProjects({ workspaceRoot: options.workspaceRoot, outputDir: checkedOutputDir(outputDir) }))
  );

  server.tool(
    'get_project_status',
    'Return a compact, one-screen summary of a project: current step, chapters written, open threads, latest review verdict, completion state.',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult(await getProjectStatus(checkedProjectPath(projectPath)))
  );

  server.tool(
    'get_next_step',
    'Return the next required generation step for a novel project.',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult(await getNextStep(checkedProjectPath(projectPath)))
  );

  server.tool(
    'submit_step_result',
    'Submit host-generated content for validation, saving, and workflow advancement.',
    {
      projectPath: z.string().min(1),
      step: z.enum([
        'novel_metadata',
        'story_bible',
        'style_guide',
        'architecture',
        'architecture_extension',
        'chapter',
        'memory_card',
        'continuity_review',
        'chapter_review',
        'chapter_revision',
        'cross_chapter_review',
        'complete',
      ]),
      content: z.string(),
    },
    async ({ projectPath, step, content }) =>
      textResult(await submitStepResult({ projectPath: checkedProjectPath(projectPath), step, content }))
  );

  server.tool(
    'get_context',
    'Build purpose-specific context for generation, memory extraction, review, or revision.',
    {
      projectPath: z.string().min(1),
      purpose: z.enum([
        'chapter_generation',
        'style_guide',
        'architecture_extension',
        'memory_extraction',
        'continuity_review',
        'revision',
        'chapter_review',
        'cross_chapter_review',
      ]),
      chapterNumber: z.number().int().positive().optional(),
      start: z.number().int().positive().optional(),
      end: z.number().int().positive().optional(),
    },
    async ({ projectPath, purpose, chapterNumber, start, end }) =>
      textResult(await buildContext({
        projectPath: checkedProjectPath(projectPath),
        purpose,
        chapterNumber,
        range: start && end ? { start, end } : undefined,
      }))
  );

  server.tool(
    'save_chapter',
    'Submit a generated chapter Markdown draft through the workflow state machine. This requires currentStep="chapter" and advances to chapter_review.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      title: z.string().min(1),
      content: z.string().min(1),
    },
    async ({ projectPath, chapterNumber, title, content }) => {
      const checked = checkedProjectPath(projectPath);
      const state = await loadState(checked);
      if (state.currentStep !== 'chapter' || state.currentChapter !== chapterNumber) {
        throw new Error(
          `save_chapter requires currentStep="chapter" and currentChapter=${chapterNumber}; got currentStep="${state.currentStep}", currentChapter=${state.currentChapter}`
        );
      }
      return textResult(await submitStepResult({
        projectPath: checked,
        step: 'chapter',
        content: `# ${title}\n\n${content}`,
      }));
    }
  );

  server.tool(
    'generate_chapter',
    'Build the chapter-generation context and instruction for a specific chapter without changing workflow state.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) =>
      textResult({
        context: await buildContext({ projectPath: checkedProjectPath(projectPath), purpose: 'chapter_generation', chapterNumber }),
        hint: 'Persist the result via submit_step_result(step="chapter") when the workflow currentStep is "chapter"; the workflow then requires chapter_review before memory_card.',
      })
  );

  server.tool(
    'extract_memory_card',
    'Build the memory-extraction context for a specific chapter without changing workflow state.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) =>
      textResult({
        context: await buildContext({ projectPath: checkedProjectPath(projectPath), purpose: 'memory_extraction', chapterNumber }),
        hint: 'Submit the extracted memory card via submit_step_result with step="memory_card" when the workflow currentStep matches.',
      })
  );

  server.tool(
    'review_chapter',
    'Ask the host to review a specific chapter. Switches the workflow into chapter_review side-track and returns the review prompt + packed context. Resume original step after submit_step_result(step="chapter_review").',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) =>
      textResult(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'chapter_review', chapterNumber }))
  );

  server.tool(
    'revise_chapter',
    'Ask the host to rewrite a specific chapter based on prior review feedback and optional extra instructions. Previous version is archived under chapters/.versions/.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      feedback: z.string().optional(),
    },
    async ({ projectPath, chapterNumber, feedback }) =>
      textResult(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'chapter_revision', chapterNumber, feedback }))
  );

  server.tool(
    'retrieve',
    'Lexical BM25-style retrieval over indexed chapter paragraphs, story-bible sections, and memory cards. Returns ranked snippets with chapter attribution.',
    {
      projectPath: z.string().min(1),
      query: z.string().min(1),
      topK: z.number().int().positive().max(50).default(6),
      types: z.array(z.enum(['chapter', 'bible', 'memory'])).optional(),
      chapterStart: z.number().int().positive().optional(),
      chapterEnd: z.number().int().positive().optional(),
    },
    async ({ projectPath, query, topK, types, chapterStart, chapterEnd }) => {
      const chapterRange = chapterStart && chapterEnd ? { start: chapterStart, end: chapterEnd } : undefined;
      const hits = await retrieve(checkedProjectPath(projectPath), query, { topK, types, chapterRange });
      return textResult({ query, hits });
    }
  );

  server.tool(
    'cross_chapter_review',
    'Ask the host to review a chapter range for cross-chapter continuity conflicts. Defaults to all generated chapters.',
    {
      projectPath: z.string().min(1),
      start: z.number().int().positive().optional(),
      end: z.number().int().positive().optional(),
    },
    async ({ projectPath, start, end }) => {
      const range = start && end ? { start, end } : undefined;
      return textResult(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'cross_chapter_review', range }));
    }
  );

  // ----- v0.2 tools -----

  server.tool(
    'amend_story_bible',
    'Replace the story bible with a revised version. Old version is auto-archived under story-bible-versions/ and the lexical index is rebuilt for the new content.',
    {
      projectPath: z.string().min(1),
      content: z.string().min(1),
      reason: z.string().optional(),
    },
    async ({ projectPath, content, reason }) =>
      textResult(await amendStoryBible({ projectPath: checkedProjectPath(projectPath), content, reason }))
  );

  server.tool(
    'list_bible_versions',
    'List archived story-bible versions for a project (filenames sorted oldest first).',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult({ versions: await listStoryBibleVersions(checkedProjectPath(projectPath)) })
  );

  server.tool(
    'list_threads',
    'List foreshadow threads for a project, optionally filtered by status. Threads are aggregated from memory_card.threadActions.',
    {
      projectPath: z.string().min(1),
      status: z.enum(['planted', 'building', 'paid', 'dropped']).optional(),
    },
    async ({ projectPath, status }) => {
      const all = await loadThreads(checkedProjectPath(projectPath));
      const filtered = status ? all.filter((t) => t.status === status) : all;
      return textResult({ threads: filtered });
    }
  );

  server.tool(
    'update_thread',
    'Update a single foreshadow thread (override status, plannedPayoffAt, paidOffAt, droppedAt, description, notes).',
    {
      projectPath: z.string().min(1),
      id: z.string().min(1),
      status: z.enum(['planted', 'building', 'paid', 'dropped']).optional(),
      plannedPayoffAt: z.number().int().positive().nullable().optional(),
      paidOffAt: z.number().int().positive().nullable().optional(),
      droppedAt: z.number().int().positive().nullable().optional(),
      description: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
    },
    async ({ projectPath, id, ...patch }) =>
      textResult(await updateThread(checkedProjectPath(projectPath), id, patch))
  );

  server.tool(
    'fork_project',
    'Copy an existing project to a new sibling directory with a new projectId. Use to try alternate plot branches without losing the original.',
    {
      sourceProjectPath: z.string().min(1),
      label: z.string().optional(),
    },
    async ({ sourceProjectPath, label }) =>
      textResult(await forkProject({ sourceProjectPath: checkedProjectPath(sourceProjectPath), label }))
  );

  server.tool(
    'delete_chapter',
    'Delete a chapter, its memory card, its single-chapter review, and all archived versions. Removes the chapter from the lexical index and rewinds the workflow if needed.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) =>
      textResult(await deleteChapter({ projectPath: checkedProjectPath(projectPath), chapterNumber }))
  );

  server.tool(
    'redo_step',
    'Roll the workflow back to a specific step. Files produced by that step (and dependent chapter content for chapter/memory_card steps) are removed; the host must regenerate.',
    {
      projectPath: z.string().min(1),
      step: z.enum([
        'novel_metadata',
        'story_bible',
        'style_guide',
        'architecture',
        'chapter',
        'memory_card',
        'continuity_review',
      ]),
      chapterNumber: z.number().int().positive().optional(),
    },
    async ({ projectPath, step, chapterNumber }) =>
      textResult(await redoStep({ projectPath: checkedProjectPath(projectPath), step, chapterNumber }))
  );

  // ===== MCP Prompts (slash commands) =====

  server.prompt(
    'nf-start',
    'Start a brand new novel project under the configured workspace.',
    {
      prompt: z.string().describe('User idea / premise / genre, in any language.'),
      chapters: z.string().optional().describe('Planning batch size as a string. Defaults to 5.'),
      totalChapters: z.string().optional().describe('Whole-book target chapter count as a string. Defaults to 12.'),
    },
    ({ prompt, chapters, totalChapters }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. Call start_novel_project with prompt="${prompt}", targetChapters=${chapters ?? '5'}, plannedTotalChapters=${totalChapters ?? '12'}, then enter the autonomous loop: read next.instruction, generate the requested content, call submit_step_result, repeat until currentStep is "complete". Show me the projectPath after start_novel_project returns.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-next',
    'Continue the current novelforge workflow by one step.',
    {
      projectPath: z.string().describe('Absolute path to the project.'),
    },
    ({ projectPath }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. Call get_next_step with projectPath="${projectPath}". Read the returned instruction + context and produce the requested artifact, then call submit_step_result. Show me what step was advanced.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-list',
    'List all novelforge projects in the workspace.',
    {},
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: 'Use the novelforge MCP server: call list_projects with no arguments. Show me the result in a compact table (title, currentStep, chaptersWritten/plannedTotalChapters, updatedAt, projectPath).',
        },
      }],
    })
  );

  server.prompt(
    'nf-status',
    'Show a one-screen status for a novelforge project.',
    {
      projectPath: z.string(),
    },
    ({ projectPath }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call get_project_status with projectPath="${projectPath}". Summarize: title, current step, chapters written, open threads count, latest review verdict.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-review-chapter',
    'Run a single-chapter editorial review.',
    {
      projectPath: z.string(),
      chapterNumber: z.string(),
    },
    ({ projectPath, chapterNumber }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call review_chapter with projectPath="${projectPath}", chapterNumber=${chapterNumber}. Read the returned instruction + context, produce the JSON chapter review, then call submit_step_result with step="chapter_review". Summarize the findings for me.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-revise-chapter',
    'Revise a chapter based on review feedback or new instructions.',
    {
      projectPath: z.string(),
      chapterNumber: z.string(),
      feedback: z.string().optional(),
    },
    ({ projectPath, chapterNumber, feedback }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call revise_chapter with projectPath="${projectPath}", chapterNumber=${chapterNumber}${feedback ? `, feedback=${JSON.stringify(feedback)}` : ''}. Read the returned instruction + context, produce the revised Markdown chapter, then call submit_step_result with step="chapter_revision". Confirm the previous version was archived.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-cross-review',
    'Cross-chapter continuity review over a range.',
    {
      projectPath: z.string(),
      start: z.string().optional(),
      end: z.string().optional(),
    },
    ({ projectPath, start, end }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call cross_chapter_review with projectPath="${projectPath}"${start && end ? `, start=${start}, end=${end}` : ''}. Read the returned instruction + context, produce the JSON cross-chapter review, then call submit_step_result with step="cross_chapter_review". Summarize verdict and any issues.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-retrieve',
    'Lexical retrieval over a project (BM25-style).',
    {
      projectPath: z.string(),
      query: z.string(),
    },
    ({ projectPath, query }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call retrieve with projectPath="${projectPath}", query=${JSON.stringify(query)}, topK=8. List the hits with chapter attribution and short excerpts.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-amend-bible',
    'Amend the story bible with new content (previous version auto-archived).',
    {
      projectPath: z.string(),
      reason: z.string().optional(),
    },
    ({ projectPath, reason }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. First call get_project_status with projectPath="${projectPath}" to confirm the project exists, then read the current story-bible.md (you may use the host's filesystem tools). Apply the following amendment intent and produce a complete revised story bible Markdown:\n\n${reason ?? '(no specific reason supplied — ask the user what to change)'}\n\nThen call amend_story_bible with projectPath="${projectPath}" and the new content. Confirm the archived version path.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-threads',
    'Show active foreshadow threads for a project.',
    {
      projectPath: z.string(),
      status: z.enum(['planted', 'building', 'paid', 'dropped']).optional(),
    },
    ({ projectPath, status }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call list_threads with projectPath="${projectPath}"${status ? `, status="${status}"` : ''}. Show me the threads as a compact list: id, status, plantedAt, plannedPayoffAt (if set), description.`,
        },
      }],
    })
  );

  return server;
}
