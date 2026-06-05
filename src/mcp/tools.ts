import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildContext,
  chapterFileName,
  createProject,
  getNextStep,
  getProjectStatus,
  listProjects,
  requestSideTrack,
  retrieve,
  saveMarkdownFile,
  submitStepResult,
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
    version: '0.1.0',
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
      return textResult({ savedPath, suggestedNextStep: 'memory_card' });
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
        hint: 'Persist the result via save_chapter or submit_step_result(step="chapter") when the workflow currentStep is "chapter".',
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

  return server;
}
