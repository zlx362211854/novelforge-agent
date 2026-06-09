import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type AgentLogLevel = 'info' | 'warn' | 'error';

export interface AgentLogEvent {
  id?: string;
  ts?: string;
  type: string;
  level?: AgentLogLevel;
  runId?: string;
  tool?: string;
  durationMs?: number;
  inputSummary?: unknown;
  outputSummary?: unknown;
  error?: { name: string; message: string };
  stateTransition?: {
    from: { currentStep: string; currentChapter: number; projectPath: string };
    to: { currentStep: string; currentChapter: number; projectPath: string };
  };
  savedPaths?: string[];
  recoveryPath?: string;
  message?: string;
}

export interface ReadAgentEventsOptions {
  limit?: number;
  type?: string;
  runId?: string;
}

export interface AgentRunSummary {
  runId: string;
  tool?: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'ok' | 'error';
  durationMs?: number;
}

const EVENTS_FILE = join('.agent-logs', 'events.jsonl');
const SENSITIVE_TEXT_KEYS = new Set([
  'content',
  'context',
  'contextPreview',
  'instruction',
  'instructionPreview',
  'prompt',
  'sampleParagraph',
  'text',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function summarizeString(value: string, sensitive: boolean): unknown {
  if (sensitive || value.length > 500) {
    return { type: 'string', length: value.length, sha256: sha256(value) };
  }
  return value;
}

export function summarizeForLog(value: unknown, key = '', depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return summarizeString(value, SENSITIVE_TEXT_KEYS.has(key));
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return { type: 'array', length: value.length };
    return value.slice(0, 20).map((item) => summarizeForLog(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 4) return { type: 'object', keys: Object.keys(value as Record<string, unknown>).sort() };
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[childKey] = summarizeForLog(childValue, childKey, depth + 1);
    }
    return output;
  }
  return { type: typeof value };
}

export async function appendAgentEvent(projectPath: string, event: AgentLogEvent): Promise<void> {
  const fullPath = join(projectPath, EVENTS_FILE);
  await mkdir(dirname(fullPath), { recursive: true });
  const next: AgentLogEvent = {
    id: event.id ?? randomUUID(),
    ts: event.ts ?? new Date().toISOString(),
    level: event.level ?? 'info',
    ...event,
  };
  await appendFile(fullPath, `${JSON.stringify(next)}\n`, 'utf8');
}

export async function tryAppendAgentEvent(projectPath: string | undefined, event: AgentLogEvent): Promise<void> {
  if (!projectPath) return;
  try {
    await appendAgentEvent(projectPath, event);
  } catch {
    // Logging must never break the primary workflow.
  }
}

export async function readAgentEvents(projectPath: string, options: ReadAgentEventsOptions = {}): Promise<AgentLogEvent[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  try {
    const raw = await readFile(join(projectPath, EVENTS_FILE), 'utf8');
    let events = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentLogEvent);
    if (options.type) events = events.filter((event) => event.type === options.type);
    if (options.runId) events = events.filter((event) => event.runId === options.runId);
    return events.slice(-limit);
  } catch {
    return [];
  }
}

export async function listAgentRuns(projectPath: string, limit = 50): Promise<AgentRunSummary[]> {
  const events = await readAgentEvents(projectPath, { limit: 500 });
  const byRun = new Map<string, AgentRunSummary>();
  for (const event of events) {
    if (!event.runId) continue;
    const existing = byRun.get(event.runId);
    if (!existing) {
      byRun.set(event.runId, {
        runId: event.runId,
        tool: event.tool,
        startedAt: event.ts ?? '',
        status: event.type === 'tool_call_error' ? 'error' : 'running',
      });
      continue;
    }
    if (event.tool) existing.tool = event.tool;
    if (event.type === 'tool_call_end') {
      existing.endedAt = event.ts;
      existing.status = 'ok';
      existing.durationMs = event.durationMs;
    } else if (event.type === 'tool_call_error') {
      existing.endedAt = event.ts;
      existing.status = 'error';
      existing.durationMs = event.durationMs;
    }
  }
  return Array.from(byRun.values()).slice(-Math.min(Math.max(limit, 1), 200)).reverse();
}

function resolveProjectFile(projectPath: string, path: string): string {
  const target = isAbsolute(path) ? resolve(path) : resolve(projectPath, path);
  const rel = relative(resolve(projectPath), target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to inspect artifact outside project: ${target}`);
  }
  return target;
}

export async function getArtifactSummary(projectPath: string, path: string) {
  const fullPath = resolveProjectFile(projectPath, path);
  const info = await stat(fullPath);
  const bytes = await readFile(fullPath);
  return {
    path: relative(projectPath, fullPath),
    absolutePath: fullPath,
    bytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
