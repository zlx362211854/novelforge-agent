import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  amendStoryBible,
  buildContext,
  chapterFileName,
  createProject,
  deleteChapter,
  forkProject,
  getNextStep,
  getProjectStatus,
  listProjects,
  listStoryBibleVersions,
  loadThreads,
  redoStep,
  requestSideTrack,
  retrieve,
  saveMarkdownFile,
  submitStepResult,
  updateThread,
} from '../core/index.js';

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
  const server = new McpServer({
    name: 'novelforge-agent',
    version: '0.2.0',
  });

  server.tool(
    'start_novel_project',
    'Create a local novel project and return the first generation instruction.',
    {
      prompt: z.string().min(1),
      language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      outputDir: z.string().default('novels'),
      targetChapters: z.number().int().positive().default(3),
    },
    async ({ prompt, language, outputDir, targetChapters }) => {
      const result = await createProject({
        workspaceRoot: options.workspaceRoot,
        prompt,
        language,
        outputDir,
        targetChapters,
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
    async ({ outputDir }) => textResult(await listProjects({ workspaceRoot: options.workspaceRoot, outputDir }))
  );

  server.tool(
    'get_project_status',
    'Return a compact, one-screen summary of a project: current step, chapters written, open threads, latest review verdict, completion state.',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult(await getProjectStatus(projectPath))
  );

  server.tool(
    'get_next_step',
    'Return the next required generation step for a novel project.',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult(await getNextStep(projectPath))
  );

  server.tool(
    'submit_step_result',
    'Submit host-generated content for validation, saving, and workflow advancement.',
    {
      projectPath: z.string().min(1),
      step: z.enum([
        'novel_metadata',
        'story_bible',
        'architecture',
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
    async ({ projectPath, step, content }) => textResult(await submitStepResult({ projectPath, step, content }))
  );

  server.tool(
    'get_context',
    'Build purpose-specific context for generation, memory extraction, review, or revision.',
    {
      projectPath: z.string().min(1),
      purpose: z.enum([
        'chapter_generation',
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
        projectPath,
        purpose,
        chapterNumber,
        range: start && end ? { start, end } : undefined,
      }))
  );

  server.tool(
    'save_chapter',
    'Save a generated chapter directly as Markdown.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      title: z.string().min(1),
      content: z.string().min(1),
    },
    async ({ projectPath, chapterNumber, title, content }) => {
      const fileName = `chapters/${chapterFileName(chapterNumber)}`;
      const savedPath = await saveMarkdownFile(projectPath, fileName, `# ${title}\n\n${content}`);
      return textResult({ savedPath, suggestedNextStep: 'chapter_review' });
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
        context: await buildContext({ projectPath, purpose: 'chapter_generation', chapterNumber }),
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
        context: await buildContext({ projectPath, purpose: 'memory_extraction', chapterNumber }),
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
      textResult(await requestSideTrack({ projectPath, step: 'chapter_review', chapterNumber }))
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
      textResult(await requestSideTrack({ projectPath, step: 'chapter_revision', chapterNumber, feedback }))
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
      const hits = await retrieve(projectPath, query, { topK, types, chapterRange });
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
      return textResult(await requestSideTrack({ projectPath, step: 'cross_chapter_review', range }));
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
      textResult(await amendStoryBible({ projectPath, content, reason }))
  );

  server.tool(
    'list_bible_versions',
    'List archived story-bible versions for a project (filenames sorted oldest first).',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult({ versions: await listStoryBibleVersions(projectPath) })
  );

  server.tool(
    'list_threads',
    'List foreshadow threads for a project, optionally filtered by status. Threads are aggregated from memory_card.threadActions.',
    {
      projectPath: z.string().min(1),
      status: z.enum(['planted', 'building', 'paid', 'dropped']).optional(),
    },
    async ({ projectPath, status }) => {
      const all = await loadThreads(projectPath);
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
      textResult(await updateThread(projectPath, id, patch))
  );

  server.tool(
    'fork_project',
    'Copy an existing project to a new sibling directory with a new projectId. Use to try alternate plot branches without losing the original.',
    {
      sourceProjectPath: z.string().min(1),
      label: z.string().optional(),
    },
    async ({ sourceProjectPath, label }) =>
      textResult(await forkProject({ sourceProjectPath, label }))
  );

  server.tool(
    'delete_chapter',
    'Delete a chapter, its memory card, its single-chapter review, and all archived versions. Removes the chapter from the lexical index and rewinds the workflow if needed.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) =>
      textResult(await deleteChapter({ projectPath, chapterNumber }))
  );

  server.tool(
    'redo_step',
    'Roll the workflow back to a specific step. Files produced by that step (and dependent chapter content for chapter/memory_card steps) are removed; the host must regenerate.',
    {
      projectPath: z.string().min(1),
      step: z.enum([
        'novel_metadata',
        'story_bible',
        'architecture',
        'chapter',
        'memory_card',
        'continuity_review',
      ]),
      chapterNumber: z.number().int().positive().optional(),
    },
    async ({ projectPath, step, chapterNumber }) =>
      textResult(await redoStep({ projectPath, step, chapterNumber }))
  );

  // ===== MCP Prompts (slash commands) =====

  server.prompt(
    'nf-start',
    'Start a brand new novel project under the configured workspace.',
    {
      prompt: z.string().describe('User idea / premise / genre, in any language.'),
      chapters: z.string().optional().describe('Target number of chapters as a string. Defaults to 5.'),
    },
    ({ prompt, chapters }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. Call start_novel_project with prompt="${prompt}", targetChapters=${chapters ?? '5'}, then enter the autonomous loop: read next.instruction, generate the requested content, call submit_step_result, repeat until currentStep is "complete". Show me the projectPath after start_novel_project returns.`,
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
          text: 'Use the novelforge MCP server: call list_projects with no arguments. Show me the result in a compact table (title, currentStep, chaptersWritten/targetChapters, updatedAt, projectPath).',
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
