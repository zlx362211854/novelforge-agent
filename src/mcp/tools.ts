import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildContext,
  chapterFileName,
  createProject,
  getNextStep,
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
      outputDir: z.string().default('novels'),
      targetChapters: z.number().int().positive().default(3),
    },
    async ({ prompt, outputDir, targetChapters }) => {
      const result = await createProject({
        workspaceRoot: options.workspaceRoot,
        prompt,
        outputDir,
        targetChapters,
      });
      return textResult({ state: result.state, next: await getNextStep(result.state.projectPath) });
    }
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
      step: z.enum(['novel_metadata', 'story_bible', 'architecture', 'chapter', 'memory_card', 'continuity_review', 'complete']),
      content: z.string(),
    },
    async ({ projectPath, step, content }) => textResult(await submitStepResult({ projectPath, step, content }))
  );

  server.tool(
    'get_context',
    'Build purpose-specific context for generation, memory extraction, review, or revision.',
    {
      projectPath: z.string().min(1),
      purpose: z.enum(['chapter_generation', 'memory_extraction', 'continuity_review', 'revision']),
      chapterNumber: z.number().int().positive().optional(),
    },
    async ({ projectPath, purpose, chapterNumber }) => textResult(await buildContext({ projectPath, purpose, chapterNumber }))
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

  return server;
}
