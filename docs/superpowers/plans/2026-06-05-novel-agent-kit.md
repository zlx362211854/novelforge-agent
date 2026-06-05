# Novel Agent Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Novel Agent Core with MCP and CLI adapters that guides Claude Code, Codex CLI, or another host assistant through novel generation while saving Markdown/JSON files.

**Architecture:** Create a new `novelforge-agent/` package. The core owns workflow state, schemas, validation, context assembly, and file writes. The MCP adapter and CLI adapter only map external calls into core functions.

**Tech Stack:** Node.js 20+, TypeScript, `node:test`, Zod, official MCP TypeScript SDK `@modelcontextprotocol/sdk`, stdio MCP transport.

---

## File Structure

- Create `novelforge-agent/package.json`: standalone package scripts and dependencies.
- Create `novelforge-agent/tsconfig.json`: TypeScript config for ESM output.
- Create `novelforge-agent/src/core/types.ts`: shared domain types.
- Create `novelforge-agent/src/core/schemas.ts`: Zod schemas and parse helpers.
- Create `novelforge-agent/src/core/fileNames.ts`: slug and path helpers.
- Create `novelforge-agent/src/core/projectStore.ts`: safe file read/write and project state persistence.
- Create `novelforge-agent/src/core/workflow.ts`: workflow step transitions and instructions.
- Create `novelforge-agent/src/core/contextBuilder.ts`: purpose-specific context assembly.
- Create `novelforge-agent/src/core/index.ts`: public core exports.
- Create `novelforge-agent/src/mcp/server.ts`: stdio MCP server entrypoint.
- Create `novelforge-agent/src/mcp/tools.ts`: MCP tool registration that calls core functions.
- Create `novelforge-agent/src/cli/index.ts`: CLI adapter for start, next, submit, context, export.
- Create `novelforge-agent/test/*.test.ts`: focused tests for core behavior and adapter boundaries.
- Create `novelforge-agent/templates/instructions/claude.md`: host assistant usage instructions.
- Create `novelforge-agent/templates/instructions/codex.md`: host assistant usage instructions.

## Task 1: Package Scaffold

**Files:**
- Create: `novelforge-agent/package.json`
- Create: `novelforge-agent/tsconfig.json`

- [ ] **Step 1: Create package manifest**

Create `novelforge-agent/package.json`:

```json
{
  "name": "novelforge-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "novelforge-agent": "./dist/cli/index.js",
    "novelforge-agent-mcp": "./dist/mcp/server.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "npm run build && node --test dist/test/*.test.js",
    "dev:mcp": "tsx src/mcp/server.ts",
    "dev:cli": "tsx src/cli/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^20.19.3",
    "tsx": "^4.20.3",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `novelforge-agent/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run:

```bash
cd novelforge-agent && npm install
```

Expected: `package-lock.json` is created and install exits with code 0.

- [ ] **Step 4: Verify empty package build fails with no inputs**

Run:

```bash
cd novelforge-agent && npm run build
```

Expected: TypeScript reports there are no source files or exits without emitting useful code. This is acceptable before Task 2.

- [ ] **Step 5: Commit scaffold**

```bash
git add novelforge-agent/package.json novelforge-agent/package-lock.json novelforge-agent/tsconfig.json
git commit -m "feat: scaffold novel agent package"
```

## Task 2: Core Types, Schemas, And File Names

**Files:**
- Create: `novelforge-agent/src/core/types.ts`
- Create: `novelforge-agent/src/core/schemas.ts`
- Create: `novelforge-agent/src/core/fileNames.ts`
- Create: `novelforge-agent/src/core/index.ts`
- Test: `novelforge-agent/test/core-schemas.test.ts`

- [ ] **Step 1: Write failing schema and file-name tests**

Create `novelforge-agent/test/core-schemas.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NovelMetadataSchema,
  MemoryCardSchema,
  makeProjectSlug,
  chapterFileName,
  memoryFileName,
} from '../src/core/index.js';

test('NovelMetadataSchema accepts required novel metadata', () => {
  const parsed = NovelMetadataSchema.parse({
    title: '星火长夜',
    genre: '科幻',
    premise: '一个失忆工程师在轨道城寻找文明断层的真相。',
    language: 'zh-CN',
    style: '克制、悬疑、强情节',
    coreCast: [
      { name: '林澈', role: 'protagonist', description: '失忆工程师' },
    ],
  });

  assert.equal(parsed.title, '星火长夜');
  assert.equal(parsed.coreCast.length, 1);
});

test('MemoryCardSchema rejects stringified arrays', () => {
  assert.throws(() => {
    MemoryCardSchema.parse({
      summary: '第一章建立主角困境。',
      keyEvents: '[]',
      entities: [],
      facts: [],
      stateChanges: [],
      openThreads: [],
    });
  }, /Expected array|array/i);
});

test('file name helpers are stable and padded', () => {
  assert.equal(makeProjectSlug(' 星火 长夜!! '), 'xing-huo-chang-ye');
  assert.equal(chapterFileName(3), '003.md');
  assert.equal(memoryFileName(12), 'chapter-012.json');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: FAIL with module not found for `../src/core/index.js`.

- [ ] **Step 3: Create shared types**

Create `novelforge-agent/src/core/types.ts`:

```ts
export type WorkflowStep =
  | 'novel_metadata'
  | 'story_bible'
  | 'architecture'
  | 'chapter'
  | 'memory_card'
  | 'continuity_review'
  | 'complete';

export interface CoreCastMember {
  name: string;
  role: string;
  description: string;
}

export interface NovelMetadata {
  title: string;
  genre: string;
  premise: string;
  language: string;
  style: string;
  coreCast: CoreCastMember[];
}

export interface VolumeArchitecture {
  id: string;
  title: string;
  summary: string;
  order: number;
}

export interface ChapterArchitecture {
  chapterNumber: number;
  title: string;
  volumeId: string;
  summary: string;
  requiredBeats: string[];
}

export interface ArchitecturePayload {
  full: string;
  volumes: VolumeArchitecture[];
  chapters: ChapterArchitecture[];
}

export interface MemoryCard {
  summary: string;
  keyEvents: string[];
  entities: Array<{ name: string; type: string; state: string }>;
  facts: Array<{ subject: string; predicate: string; object: string }>;
  stateChanges: Array<{ entity: string; before: string; after: string }>;
  openThreads: string[];
}

export interface AgentState {
  projectId: string;
  projectPath: string;
  initialPrompt: string;
  targetChapters: number;
  currentStep: WorkflowStep;
  currentChapter: number;
  completedSteps: WorkflowStep[];
  files: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface StepInstruction {
  projectId: string;
  projectPath: string;
  currentStep: WorkflowStep;
  instruction: string;
  expectedFormat: string;
  context: string;
}
```

- [ ] **Step 4: Create Zod schemas**

Create `novelforge-agent/src/core/schemas.ts`:

```ts
import { z } from 'zod';

export const CoreCastMemberSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
});

export const NovelMetadataSchema = z.object({
  title: z.string().min(1),
  genre: z.string().min(1),
  premise: z.string().min(1),
  language: z.string().min(1).default('zh-CN'),
  style: z.string().min(1).default('清晰、连贯、适合长篇连载'),
  coreCast: z.array(CoreCastMemberSchema).min(1),
});

export const VolumeArchitectureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  order: z.number().int().positive(),
});

export const ChapterArchitectureSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  volumeId: z.string().min(1),
  summary: z.string().min(1),
  requiredBeats: z.array(z.string().min(1)).min(1),
});

export const ArchitecturePayloadSchema = z.object({
  full: z.string().min(1),
  volumes: z.array(VolumeArchitectureSchema).min(1),
  chapters: z.array(ChapterArchitectureSchema).min(1),
});

export const MemoryCardSchema = z.object({
  summary: z.string().min(1),
  keyEvents: z.array(z.string().min(1)),
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    state: z.string().min(1),
  })),
  facts: z.array(z.object({
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
  })),
  stateChanges: z.array(z.object({
    entity: z.string().min(1),
    before: z.string().min(1),
    after: z.string().min(1),
  })),
  openThreads: z.array(z.string().min(1)),
});

export const ContinuityReviewSchema = z.object({
  range: z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  }),
  status: z.enum(['clean', 'issues_found']),
  issues: z.array(z.object({
    severity: z.enum(['low', 'medium', 'high']),
    description: z.string().min(1),
    evidence: z.string().min(1),
    suggestion: z.string().min(1),
  })),
});
```

- [ ] **Step 5: Create file-name helpers**

Create `novelforge-agent/src/core/fileNames.ts`:

```ts
const PINYIN_FALLBACK: Record<string, string> = {
  星: 'xing',
  火: 'huo',
  长: 'chang',
  夜: 'ye',
};

export function makeProjectSlug(title: string): string {
  const replaced = title
    .trim()
    .split('')
    .map((char) => PINYIN_FALLBACK[char] || char)
    .join('-')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return replaced || `novel-${Date.now()}`;
}

export function padChapterNumber(chapterNumber: number): string {
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
    throw new Error(`Invalid chapter number: ${chapterNumber}`);
  }
  return String(chapterNumber).padStart(3, '0');
}

export function chapterFileName(chapterNumber: number): string {
  return `${padChapterNumber(chapterNumber)}.md`;
}

export function memoryFileName(chapterNumber: number): string {
  return `chapter-${padChapterNumber(chapterNumber)}.json`;
}
```

- [ ] **Step 6: Create core export barrel**

Create `novelforge-agent/src/core/index.ts`:

```ts
export * from './types.js';
export * from './schemas.js';
export * from './fileNames.js';
```

- [ ] **Step 7: Run tests**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS for `core-schemas.test.ts`.

- [ ] **Step 8: Commit core schemas**

```bash
git add novelforge-agent/src/core novelforge-agent/test/core-schemas.test.ts
git commit -m "feat: add novel agent core schemas"
```

## Task 3: Project Store

**Files:**
- Create: `novelforge-agent/src/core/projectStore.ts`
- Modify: `novelforge-agent/src/core/index.ts`
- Test: `novelforge-agent/test/project-store.test.ts`

- [ ] **Step 1: Write failing project store tests**

Create `novelforge-agent/test/project-store.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  loadState,
  saveJsonFile,
  saveMarkdownFile,
} from '../src/core/index.js';

test('createProject initializes file layout and state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const result = await createProject({
      workspaceRoot: root,
      prompt: '写一本星际悬疑小说',
      outputDir: 'novels',
      targetChapters: 3,
    });

    assert.match(result.state.projectPath, /novels/);
    assert.equal(result.state.currentStep, 'novel_metadata');
    assert.equal(result.state.targetChapters, 3);

    const loaded = await loadState(result.state.projectPath);
    assert.equal(loaded.projectId, result.state.projectId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('save helpers write readable markdown and formatted json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const project = await createProject({
      workspaceRoot: root,
      prompt: '写一本赛博修仙小说',
      outputDir: 'novels',
      targetChapters: 1,
    });
    const jsonPath = await saveJsonFile(project.state.projectPath, 'novel.json', { title: '霓虹飞升' });
    const mdPath = await saveMarkdownFile(project.state.projectPath, 'story-bible.md', '# 故事圣经\n');

    assert.equal(await readFile(mdPath, 'utf8'), '# 故事圣经\n');
    assert.match(await readFile(jsonPath, 'utf8'), /"title": "霓虹飞升"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createProject rejects path traversal outputDir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    await assert.rejects(
      () => createProject({
        workspaceRoot: root,
        prompt: '写一本小说',
        outputDir: '../outside',
        targetChapters: 1,
      }),
      /outside workspace/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: FAIL because `createProject`, `loadState`, `saveJsonFile`, and `saveMarkdownFile` are not exported.

- [ ] **Step 3: Implement project store**

Create `novelforge-agent/src/core/projectStore.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AgentState } from './types.js';
import { makeProjectSlug } from './fileNames.js';

export interface CreateProjectInput {
  workspaceRoot: string;
  prompt: string;
  outputDir?: string;
  targetChapters?: number;
}

export interface CreateProjectResult {
  state: AgentState;
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string): void {
  const root = resolve(workspaceRoot);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to write outside workspace: ${target}`);
  }
}

export async function ensureProjectDirectories(projectPath: string): Promise<void> {
  await mkdir(projectPath, { recursive: true });
  await mkdir(join(projectPath, 'architecture'), { recursive: true });
  await mkdir(join(projectPath, 'chapters'), { recursive: true });
  await mkdir(join(projectPath, 'memory'), { recursive: true });
  await mkdir(join(projectPath, 'reviews'), { recursive: true });
  await mkdir(join(projectPath, '.agent-recovery'), { recursive: true });
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const baseDir = input.outputDir || 'novels';
  const targetChapters = Math.max(1, Math.floor(Number(input.targetChapters || 3)));
  const slug = makeProjectSlug(input.prompt.slice(0, 48));
  const projectPath = resolve(workspaceRoot, baseDir, slug);
  assertInsideWorkspace(workspaceRoot, projectPath);
  await ensureProjectDirectories(projectPath);

  const now = new Date().toISOString();
  const state: AgentState = {
    projectId: randomUUID(),
    projectPath,
    initialPrompt: input.prompt,
    targetChapters,
    currentStep: 'novel_metadata',
    currentChapter: 1,
    completedSteps: [],
    files: {},
    createdAt: now,
    updatedAt: now,
  };
  await saveState(state);
  return { state };
}

export async function loadState(projectPath: string): Promise<AgentState> {
  const raw = await readFile(join(projectPath, 'agent-state.json'), 'utf8');
  return JSON.parse(raw) as AgentState;
}

export async function saveState(state: AgentState): Promise<void> {
  const nextState = { ...state, updatedAt: new Date().toISOString() };
  await writeFile(
    join(state.projectPath, 'agent-state.json'),
    `${JSON.stringify(nextState, null, 2)}\n`,
    'utf8'
  );
}

export async function saveJsonFile(projectPath: string, relativePath: string, value: unknown): Promise<string> {
  const fullPath = join(projectPath, relativePath);
  await mkdir(resolve(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return fullPath;
}

export async function saveMarkdownFile(projectPath: string, relativePath: string, value: string): Promise<string> {
  const fullPath = join(projectPath, relativePath);
  await mkdir(resolve(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
  return fullPath;
}

export async function saveRecoveryFile(projectPath: string, step: string, content: string): Promise<string> {
  const safeStep = step.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const fileName = `.agent-recovery/failed-${safeStep}-${Date.now()}.txt`;
  return saveMarkdownFile(projectPath, fileName, content);
}
```

- [ ] **Step 4: Export project store**

Modify `novelforge-agent/src/core/index.ts`:

```ts
export * from './types.js';
export * from './schemas.js';
export * from './fileNames.js';
export * from './projectStore.js';
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS for schema and project store tests.

- [ ] **Step 6: Commit project store**

```bash
git add novelforge-agent/src/core novelforge-agent/test/project-store.test.ts
git commit -m "feat: add file project store"
```

## Task 4: Workflow Engine

**Files:**
- Create: `novelforge-agent/src/core/workflow.ts`
- Modify: `novelforge-agent/src/core/index.ts`
- Test: `novelforge-agent/test/workflow.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Create `novelforge-agent/test/workflow.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  getNextStep,
  submitStepResult,
  loadState,
} from '../src/core/index.js';

test('workflow advances from metadata to story bible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本废土侦探小说',
      outputDir: 'novels',
      targetChapters: 2,
    });

    const first = await getNextStep(state.projectPath);
    assert.equal(first.currentStep, 'novel_metadata');
    assert.match(first.instruction, /novel metadata/i);

    const next = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '灰烬证词',
        genre: '废土悬疑',
        premise: '侦探追查一座废弃城市的集体失忆。',
        language: 'zh-CN',
        style: '冷峻、强悬疑',
        coreCast: [{ name: '周临', role: 'protagonist', description: '废土侦探' }],
      }),
    });

    assert.equal(next.state.currentStep, 'story_bible');
    assert.match(await readFile(join(state.projectPath, 'novel.json'), 'utf8'), /灰烬证词/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid json submission is saved to recovery and does not advance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本小说',
      outputDir: 'novels',
      targetChapters: 1,
    });

    const result = await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: '{ invalid json',
    });

    assert.equal(result.validation.ok, false);
    assert.equal(result.state.currentStep, 'novel_metadata');
    assert.ok(result.recoveryPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chapter and memory submissions advance until continuity review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本短篇小说',
      outputDir: 'novels',
      targetChapters: 1,
    });

    await submitStepResult({
      projectPath: state.projectPath,
      step: 'novel_metadata',
      content: JSON.stringify({
        title: '一日归途',
        genre: '现实',
        premise: '一个人回乡处理旧事。',
        language: 'zh-CN',
        style: '细腻',
        coreCast: [{ name: '陈序', role: 'protagonist', description: '返乡者' }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'story_bible', content: '# 故事圣经\n' });
    await submitStepResult({
      projectPath: state.projectPath,
      step: 'architecture',
      content: JSON.stringify({
        full: '一日内完成返乡和和解。',
        volumes: [{ id: 'v1', title: '归途', summary: '回乡', order: 1 }],
        chapters: [{ chapterNumber: 1, title: '旧车站', volumeId: 'v1', summary: '抵达', requiredBeats: ['抵达车站'] }],
      }),
    });
    await submitStepResult({ projectPath: state.projectPath, step: 'chapter', content: '# 旧车站\n\n陈序下车。' });
    const afterMemory = await submitStepResult({
      projectPath: state.projectPath,
      step: 'memory_card',
      content: JSON.stringify({
        summary: '陈序抵达旧车站。',
        keyEvents: ['陈序下车'],
        entities: [{ name: '陈序', type: 'person', state: '抵达故乡' }],
        facts: [{ subject: '陈序', predicate: '抵达', object: '旧车站' }],
        stateChanges: [{ entity: '陈序', before: '在路上', after: '到达故乡' }],
        openThreads: ['陈序为何返乡'],
      }),
    });

    assert.equal(afterMemory.state.currentStep, 'continuity_review');
    const final = await submitStepResult({
      projectPath: state.projectPath,
      step: 'continuity_review',
      content: JSON.stringify({ range: { start: 1, end: 1 }, status: 'clean', issues: [] }),
    });
    assert.equal(final.state.currentStep, 'complete');
    assert.equal((await loadState(state.projectPath)).currentStep, 'complete');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: FAIL because workflow functions are not exported.

- [ ] **Step 3: Implement workflow engine**

Create `novelforge-agent/src/core/workflow.ts`:

```ts
import { join } from 'node:path';
import {
  ArchitecturePayloadSchema,
  ContinuityReviewSchema,
  MemoryCardSchema,
  NovelMetadataSchema,
} from './schemas.js';
import { WorkflowStep, AgentState, StepInstruction } from './types.js';
import {
  loadState,
  saveJsonFile,
  saveMarkdownFile,
  saveRecoveryFile,
  saveState,
} from './projectStore.js';
import { chapterFileName, memoryFileName } from './fileNames.js';

export interface SubmitStepInput {
  projectPath: string;
  step: WorkflowStep;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitStepResult {
  validation: { ok: boolean; message: string };
  state: AgentState;
  savedPaths: string[];
  recoveryPath?: string;
  next?: StepInstruction;
}

function instructionFor(state: AgentState): StepInstruction {
  const base = {
    projectId: state.projectId,
    projectPath: state.projectPath,
    currentStep: state.currentStep,
  };

  if (state.currentStep === 'novel_metadata') {
    return {
      ...base,
      instruction: 'Generate novel metadata as JSON with title, genre, premise, language, style, and coreCast.',
      expectedFormat: 'JSON matching NovelMetadataSchema',
      context: `Initial prompt:\n${state.initialPrompt}`,
    };
  }

  if (state.currentStep === 'story_bible') {
    return {
      ...base,
      instruction: 'Generate a Markdown story bible covering characters, world rules, tone, conflicts, and long-running threads.',
      expectedFormat: 'Markdown',
      context: `Initial prompt:\n${state.initialPrompt}`,
    };
  }

  if (state.currentStep === 'architecture') {
    return {
      ...base,
      instruction: `Generate full-book, volume, and at least ${state.targetChapters} chapter architectures as JSON.`,
      expectedFormat: 'JSON matching ArchitecturePayloadSchema',
      context: `Target first-run chapters: ${state.targetChapters}`,
    };
  }

  if (state.currentStep === 'chapter') {
    return {
      ...base,
      instruction: `Generate chapter ${state.currentChapter} as Markdown with a title heading and prose body.`,
      expectedFormat: 'Markdown',
      context: `Current chapter: ${state.currentChapter}`,
    };
  }

  if (state.currentStep === 'memory_card') {
    return {
      ...base,
      instruction: `Extract a memory card for chapter ${state.currentChapter} as JSON.`,
      expectedFormat: 'JSON matching MemoryCardSchema',
      context: `Current chapter: ${state.currentChapter}`,
    };
  }

  if (state.currentStep === 'continuity_review') {
    return {
      ...base,
      instruction: `Review continuity for chapters 1-${state.targetChapters} as JSON.`,
      expectedFormat: 'JSON matching ContinuityReviewSchema',
      context: `Chapter range: 1-${state.targetChapters}`,
    };
  }

  return {
    ...base,
    instruction: 'The workflow is complete.',
    expectedFormat: 'No output required',
    context: '',
  };
}

export async function getNextStep(projectPath: string): Promise<StepInstruction> {
  return instructionFor(await loadState(projectPath));
}

function parseJson(content: string): unknown {
  return JSON.parse(content);
}

function advanceState(state: AgentState, nextStep: WorkflowStep): AgentState {
  return {
    ...state,
    currentStep: nextStep,
    completedSteps: [...state.completedSteps, state.currentStep],
  };
}

export async function submitStepResult(input: SubmitStepInput): Promise<SubmitStepResult> {
  const state = await loadState(input.projectPath);
  if (state.currentStep !== input.step) {
    const recoveryPath = await saveRecoveryFile(state.projectPath, input.step, input.content);
    return {
      validation: { ok: false, message: `Expected step ${state.currentStep}, got ${input.step}` },
      state,
      savedPaths: [],
      recoveryPath,
      next: instructionFor(state),
    };
  }

  try {
    const savedPaths: string[] = [];
    let nextState = state;

    if (input.step === 'novel_metadata') {
      const parsed = NovelMetadataSchema.parse(parseJson(input.content));
      savedPaths.push(await saveJsonFile(state.projectPath, 'novel.json', parsed));
      nextState = advanceState({ ...state, files: { ...state.files, novel: 'novel.json' } }, 'story_bible');
    } else if (input.step === 'story_bible') {
      if (!input.content.trim()) throw new Error('Story bible Markdown is empty');
      savedPaths.push(await saveMarkdownFile(state.projectPath, 'story-bible.md', input.content));
      nextState = advanceState({ ...state, files: { ...state.files, storyBible: 'story-bible.md' } }, 'architecture');
    } else if (input.step === 'architecture') {
      const parsed = ArchitecturePayloadSchema.parse(parseJson(input.content));
      savedPaths.push(await saveMarkdownFile(state.projectPath, 'architecture/full.md', parsed.full));
      savedPaths.push(await saveJsonFile(state.projectPath, 'architecture/volumes.json', parsed.volumes));
      savedPaths.push(await saveJsonFile(state.projectPath, 'architecture/chapters.json', parsed.chapters));
      nextState = advanceState({ ...state, files: { ...state.files, architecture: 'architecture/chapters.json' } }, 'chapter');
    } else if (input.step === 'chapter') {
      if (!input.content.trim()) throw new Error('Chapter Markdown is empty');
      const relative = join('chapters', chapterFileName(state.currentChapter));
      savedPaths.push(await saveMarkdownFile(state.projectPath, relative, input.content));
      nextState = advanceState({ ...state, files: { ...state.files, [`chapter-${state.currentChapter}`]: relative } }, 'memory_card');
    } else if (input.step === 'memory_card') {
      const parsed = MemoryCardSchema.parse(parseJson(input.content));
      const relative = join('memory', memoryFileName(state.currentChapter));
      savedPaths.push(await saveJsonFile(state.projectPath, relative, parsed));
      const nextChapter = state.currentChapter + 1;
      nextState = advanceState(
        { ...state, currentChapter: nextChapter, files: { ...state.files, [`memory-${state.currentChapter}`]: relative } },
        nextChapter > state.targetChapters ? 'continuity_review' : 'chapter'
      );
    } else if (input.step === 'continuity_review') {
      const parsed = ContinuityReviewSchema.parse(parseJson(input.content));
      const relative = `reviews/continuity-${parsed.range.start}-${parsed.range.end}.json`;
      savedPaths.push(await saveJsonFile(state.projectPath, relative, parsed));
      nextState = advanceState({ ...state, files: { ...state.files, continuityReview: relative } }, 'complete');
    }

    await saveState(nextState);
    return {
      validation: { ok: true, message: 'Saved' },
      state: nextState,
      savedPaths,
      next: instructionFor(nextState),
    };
  } catch (error) {
    const recoveryPath = await saveRecoveryFile(state.projectPath, input.step, input.content);
    return {
      validation: { ok: false, message: (error as Error).message },
      state,
      savedPaths: [],
      recoveryPath,
      next: instructionFor(state),
    };
  }
}
```

- [ ] **Step 4: Export workflow functions**

Modify `novelforge-agent/src/core/index.ts`:

```ts
export * from './types.js';
export * from './schemas.js';
export * from './fileNames.js';
export * from './projectStore.js';
export * from './workflow.js';
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS for schema, project store, and workflow tests.

- [ ] **Step 6: Commit workflow**

```bash
git add novelforge-agent/src/core novelforge-agent/test/workflow.test.ts
git commit -m "feat: add novel workflow engine"
```

## Task 5: Context Builder

**Files:**
- Create: `novelforge-agent/src/core/contextBuilder.ts`
- Modify: `novelforge-agent/src/core/index.ts`
- Test: `novelforge-agent/test/context-builder.test.ts`

- [ ] **Step 1: Write failing context builder test**

Create `novelforge-agent/test/context-builder.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildContext,
  createProject,
  saveJsonFile,
  saveMarkdownFile,
} from '../src/core/index.js';

test('buildContext returns chapter generation context without dumping every file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novel-agent-'));
  try {
    const { state } = await createProject({
      workspaceRoot: root,
      prompt: '写一本悬疑小说',
      outputDir: 'novels',
      targetChapters: 2,
    });
    await saveJsonFile(state.projectPath, 'novel.json', {
      title: '雾城',
      genre: '悬疑',
      premise: '调查雾中失踪案。',
      language: 'zh-CN',
      style: '冷峻',
      coreCast: [{ name: '许南', role: 'protagonist', description: '调查员' }],
    });
    await saveMarkdownFile(state.projectPath, 'story-bible.md', '# 故事圣经\n雾会吞掉记忆。\n');
    await saveJsonFile(state.projectPath, 'architecture/chapters.json', [
      { chapterNumber: 1, title: '雾起', volumeId: 'v1', summary: '失踪案出现', requiredBeats: ['发现线索'] },
    ]);

    const context = await buildContext({
      projectPath: state.projectPath,
      purpose: 'chapter_generation',
      chapterNumber: 1,
    });

    assert.match(context, /雾城/);
    assert.match(context, /雾起/);
    assert.doesNotMatch(context, /agent-state/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: FAIL because `buildContext` is not exported.

- [ ] **Step 3: Implement context builder**

Create `novelforge-agent/src/core/contextBuilder.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chapterFileName, memoryFileName } from './fileNames.js';

export type ContextPurpose =
  | 'chapter_generation'
  | 'memory_extraction'
  | 'continuity_review'
  | 'revision';

export interface BuildContextInput {
  projectPath: string;
  purpose: ContextPurpose;
  chapterNumber?: number;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export async function buildContext(input: BuildContextInput): Promise<string> {
  const parts: string[] = [];
  const metadata = await readOptional(join(input.projectPath, 'novel.json'));
  const storyBible = await readOptional(join(input.projectPath, 'story-bible.md'));
  const chaptersJson = await readOptional(join(input.projectPath, 'architecture/chapters.json'));

  if (metadata) parts.push(`## Novel Metadata\n${metadata}`);
  if (storyBible) parts.push(`## Story Bible\n${storyBible.slice(0, 4000)}`);

  if (input.purpose === 'chapter_generation' && input.chapterNumber) {
    if (chaptersJson) {
      const chapters = JSON.parse(chaptersJson) as Array<{ chapterNumber: number; title: string; summary: string }>;
      const chapter = chapters.find((item) => item.chapterNumber === input.chapterNumber);
      if (chapter) parts.push(`## Current Chapter Architecture\n${JSON.stringify(chapter, null, 2)}`);
    }
    if (input.chapterNumber > 1) {
      const previous = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber - 1)));
      const previousMemory = await readOptional(join(input.projectPath, 'memory', memoryFileName(input.chapterNumber - 1)));
      if (previous) parts.push(`## Previous Chapter Ending\n${previous.slice(-1600)}`);
      if (previousMemory) parts.push(`## Previous Chapter Memory\n${previousMemory}`);
    }
  }

  if (input.purpose === 'memory_extraction' && input.chapterNumber) {
    const chapter = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber)));
    if (chapter) parts.push(`## Current Chapter\n${chapter}`);
  }

  if (input.purpose === 'continuity_review') {
    if (chaptersJson) parts.push(`## Chapter Architecture List\n${chaptersJson}`);
    const memoryParts: string[] = [];
    for (let i = 1; i <= 20; i += 1) {
      const memory = await readOptional(join(input.projectPath, 'memory', memoryFileName(i)));
      if (memory) memoryParts.push(`### Chapter ${i}\n${memory}`);
    }
    if (memoryParts.length) parts.push(`## Memory Cards\n${memoryParts.join('\n')}`);
  }

  return parts.join('\n\n').trim();
}
```

- [ ] **Step 4: Export context builder**

Modify `novelforge-agent/src/core/index.ts`:

```ts
export * from './types.js';
export * from './schemas.js';
export * from './fileNames.js';
export * from './projectStore.js';
export * from './workflow.js';
export * from './contextBuilder.js';
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS for all current tests.

- [ ] **Step 6: Commit context builder**

```bash
git add novelforge-agent/src/core novelforge-agent/test/context-builder.test.ts
git commit -m "feat: add novel context builder"
```

## Task 6: CLI Adapter

**Files:**
- Create: `novelforge-agent/src/cli/index.ts`
- Test: `novelforge-agent/test/cli-adapter.test.ts`

- [ ] **Step 1: Write failing CLI smoke test**

Create `novelforge-agent/test/cli-adapter.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

test('CLI module exports runCli for adapter tests', async () => {
  const mod = await import(pathToFileURL('dist/src/cli/index.js').href);
  assert.equal(typeof mod.runCli, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: FAIL because `src/cli/index.ts` does not exist.

- [ ] **Step 3: Implement CLI adapter**

Create `novelforge-agent/src/cli/index.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS for all current tests.

- [ ] **Step 5: Manually smoke test CLI start**

Run:

```bash
cd novelforge-agent && npm run build && node dist/src/cli/index.js start --prompt "写一本赛博修仙小说" --chapters 1 --output ../tmp-novels
```

Expected: JSON output includes `"currentStep": "novel_metadata"` and a project path under `/Users/linkzhao/workspace/AI/books_manage/tmp-novels`.

- [ ] **Step 6: Commit CLI adapter**

```bash
git add novelforge-agent/src/cli novelforge-agent/test/cli-adapter.test.ts
git commit -m "feat: add novel agent cli adapter"
```

## Task 7: MCP Adapter

**Files:**
- Create: `novelforge-agent/src/mcp/tools.ts`
- Create: `novelforge-agent/src/mcp/server.ts`
- Test: `novelforge-agent/test/mcp-tools.test.ts`

- [ ] **Step 1: Write failing MCP adapter boundary test**

Create `novelforge-agent/test/mcp-tools.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNovelAgentServer } from '../src/mcp/tools.js';

test('createNovelAgentServer returns an MCP server object', () => {
  const server = createNovelAgentServer({ workspaceRoot: process.cwd() });
  assert.equal(typeof server.connect, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: FAIL because MCP files do not exist.

- [ ] **Step 3: Implement MCP tools**

Create `novelforge-agent/src/mcp/tools.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildContext,
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
      const fileName = `chapters/${String(chapterNumber).padStart(3, '0')}.md`;
      const savedPath = await saveMarkdownFile(projectPath, fileName, `# ${title}\n\n${content}`);
      return textResult({ savedPath, suggestedNextStep: 'memory_card' });
    }
  );

  return server;
}
```

- [ ] **Step 4: Implement MCP stdio entrypoint**

Create `novelforge-agent/src/mcp/server.ts`:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNovelAgentServer } from './tools.js';

async function main(): Promise<void> {
  const workspaceRoot = process.env.NOVELFORGE_WORKSPACE || process.cwd();
  const server = createNovelAgentServer({ workspaceRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS for all tests.

- [ ] **Step 6: Build MCP entrypoint**

Run:

```bash
cd novelforge-agent && npm run build
```

Expected: PASS and `dist/src/mcp/server.js` exists.

- [ ] **Step 7: Commit MCP adapter**

```bash
git add novelforge-agent/src/mcp novelforge-agent/test/mcp-tools.test.ts
git commit -m "feat: add novel agent mcp adapter"
```

## Task 8: Instructions And Verification

**Files:**
- Create: `novelforge-agent/templates/instructions/claude.md`
- Create: `novelforge-agent/templates/instructions/codex.md`
- Create: `novelforge-agent/README.md`

- [ ] **Step 1: Create Claude instructions**

Create `novelforge-agent/templates/instructions/claude.md`:

```md
# NovelForge Agent Usage

Use the NovelForge MCP tools to create and manage local novel projects.

When the user asks to generate a novel:

1. Call `start_novel_project`.
2. Read the returned instruction and expected format.
3. Generate the requested content yourself.
4. Call `submit_step_result`.
5. Continue with `get_next_step` until the workflow is complete.

Do not ask the MCP server to call a model. The host assistant writes prose and structured content.
```

- [ ] **Step 2: Create Codex instructions**

Create `novelforge-agent/templates/instructions/codex.md`:

```md
# NovelForge Agent Usage For Codex

Use the NovelForge MCP adapter as a local workflow and file-management tool.

For each novel project:

- Let the MCP tools create and update files.
- Use `get_context` before writing chapters after chapter 1.
- Submit JSON exactly as requested by the current step.
- Keep generated Markdown readable and editable.
```

- [ ] **Step 3: Create README**

Create `novelforge-agent/README.md`:

```md
# NovelForge Agent

NovelForge Agent is a local-first novel workflow kit. It provides an Agent Core plus MCP and CLI adapters. The host assistant supplies all language model output; this package manages workflow, state, validation, context, and Markdown/JSON files.

## Install

```bash
npm install
npm run build
```

## CLI Smoke Test

```bash
node dist/src/cli/index.js start --prompt "写一本赛博修仙小说" --chapters 3
```

## MCP Entrypoint

```bash
node dist/src/mcp/server.js
```

Set `NOVELFORGE_WORKSPACE` to choose the workspace root.
```

- [ ] **Step 4: Run final package checks**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS.

- [ ] **Step 5: Verify repository status**

Run:

```bash
git status --short
```

Expected: only `novelforge-agent/README.md` and instruction templates are unstaged.

- [ ] **Step 6: Commit docs**

```bash
git add novelforge-agent/README.md novelforge-agent/templates/instructions
git commit -m "docs: add novel agent usage instructions"
```

## Task 9: Final End-To-End Smoke Test

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full tests**

Run:

```bash
cd novelforge-agent && npm test
```

Expected: PASS.

- [ ] **Step 2: Run CLI end-to-end start**

Run:

```bash
rm -rf /tmp/novelforge-agent-smoke
mkdir -p /tmp/novelforge-agent-smoke
cd novelforge-agent
node dist/src/cli/index.js start --prompt "写一本关于时间图书馆的奇幻小说" --chapters 1 --output /tmp/novelforge-agent-smoke
```

Expected: The command prints JSON containing `novel_metadata`. Because `/tmp/novelforge-agent-smoke` is outside the workspace root, this command should fail with `Refusing to write outside workspace`.

- [ ] **Step 3: Run workspace-safe CLI start**

Run:

```bash
cd novelforge-agent
rm -rf tmp-novelforge-agent-smoke
node dist/src/cli/index.js start --prompt "写一本关于时间图书馆的奇幻小说" --chapters 1 --output tmp-novelforge-agent-smoke
```

Expected: The command prints JSON containing `novel_metadata` and creates `tmp-novelforge-agent-smoke/<slug>/agent-state.json`.

- [ ] **Step 4: Remove smoke output**

Run:

```bash
rm -rf novelforge-agent/tmp-novelforge-agent-smoke
```

Expected: Smoke output directory is removed from the repository root.

- [ ] **Step 5: Commit final verification note if needed**

If no files changed, do not commit. If README commands changed during verification, commit them:

```bash
git add novelforge-agent/README.md
git commit -m "docs: update novel agent smoke commands"
```

## Plan Self-Review

Spec coverage:

- Agent Core is covered by Tasks 2-5.
- MCP adapter is covered by Task 7.
- CLI adapter is covered by Task 6.
- Markdown/JSON file output is covered by Tasks 3-4.
- No login and no model API key are enforced by package structure and README.
- Resume after restart is covered by `agent-state.json` and `loadState` tests.
- Context assembly is covered by Task 5.
- Validation and recovery are covered by Tasks 2 and 4.

Implementation risks:

- MCP SDK API may differ by installed version. Use `@modelcontextprotocol/sdk` v1-style imports shown in the official v1 server docs. If TypeScript reports `server.tool` signature mismatch, inspect installed SDK types and adjust only `src/mcp/tools.ts`; do not move workflow logic out of core.
- `makeProjectSlug` only includes a tiny Chinese fallback for tests. This is acceptable for MVP. Future work can add a full pinyin dependency or a title confirmation step.
- CLI smoke paths intentionally test safe path handling. Keep workspace path rejection strict.
