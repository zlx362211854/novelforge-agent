import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Thread, ThreadAction, ThreadStatus } from './types.js';

const THREADS_FILE = 'threads.json';

export interface ThreadsBundle {
  threads: Thread[];
}

export async function loadThreads(projectPath: string): Promise<Thread[]> {
  try {
    const raw = await readFile(join(projectPath, THREADS_FILE), 'utf8');
    const parsed = JSON.parse(raw) as ThreadsBundle;
    return Array.isArray(parsed.threads) ? parsed.threads : [];
  } catch {
    return [];
  }
}

export async function saveThreads(projectPath: string, threads: Thread[]): Promise<string> {
  const fullPath = join(projectPath, THREADS_FILE);
  const bundle: ThreadsBundle = { threads };
  await writeFile(fullPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return fullPath;
}

function newThreadId(existing: Set<string>): string {
  let candidate = `t_${randomBytes(3).toString('hex')}`;
  while (existing.has(candidate)) {
    candidate = `t_${randomBytes(3).toString('hex')}`;
  }
  return candidate;
}

function findByDescription(threads: Thread[], description: string): Thread | undefined {
  const target = description.trim();
  return threads.find((t) => t.description.trim() === target);
}

/**
 * Apply the threadActions emitted by a memory_card for chapter `chapterNumber`.
 * Behavior:
 *  - 'plant'   → create new thread (or reuse if identical description already planted)
 *  - 'build'   → mark existing thread status = 'building', bump lastTouchedAt
 *  - 'pay'     → mark existing thread status = 'paid', set paidOffAt
 *  - 'drop'    → mark existing thread status = 'dropped', set droppedAt
 *  Unknown threadIds for non-plant actions are tolerated (a new thread is created and marked appropriately, so we never lose user intent).
 */
export function applyThreadActions(
  existing: Thread[],
  chapterNumber: number,
  actions: ThreadAction[]
): Thread[] {
  if (!actions || !actions.length) return existing;
  const next: Thread[] = existing.map((t) => ({ ...t }));
  const byId = new Map(next.map((t) => [t.id, t]));
  const usedIds = new Set(next.map((t) => t.id));

  for (const action of actions) {
    if (action.kind === 'plant') {
      const dup = findByDescription(next, action.description);
      if (dup) {
        dup.lastTouchedAt = Math.max(dup.lastTouchedAt, chapterNumber);
        continue;
      }
      const id = action.threadId && !usedIds.has(action.threadId)
        ? action.threadId
        : newThreadId(usedIds);
      usedIds.add(id);
      const planted: Thread = {
        id,
        description: action.description.trim(),
        status: 'planted',
        plantedAt: chapterNumber,
        lastTouchedAt: chapterNumber,
      };
      next.push(planted);
      byId.set(id, planted);
      continue;
    }

    // build / pay / drop need an existing thread
    let target = action.threadId ? byId.get(action.threadId) : undefined;
    if (!target) {
      target = findByDescription(next, action.description);
    }
    if (!target) {
      // Create a placeholder so the user intent is captured; mark planted+touched on this chapter
      const id = newThreadId(usedIds);
      usedIds.add(id);
      target = {
        id,
        description: action.description.trim(),
        status: 'planted',
        plantedAt: chapterNumber,
        lastTouchedAt: chapterNumber,
        notes: `Auto-created from a ${action.kind} action without a known threadId.`,
      };
      next.push(target);
      byId.set(id, target);
    }

    target.lastTouchedAt = chapterNumber;
    if (action.kind === 'build') {
      target.status = 'building';
    } else if (action.kind === 'pay') {
      target.status = 'paid';
      target.paidOffAt = chapterNumber;
    } else if (action.kind === 'drop') {
      target.status = 'dropped';
      target.droppedAt = chapterNumber;
    }
  }

  return next;
}

export function activeThreads(threads: Thread[]): Thread[] {
  return threads.filter((t) => t.status === 'planted' || t.status === 'building');
}

export async function ingestMemoryCardThreads(
  projectPath: string,
  chapterNumber: number,
  actions: ThreadAction[] | undefined
): Promise<Thread[]> {
  if (!actions || !actions.length) return loadThreads(projectPath);
  const existing = await loadThreads(projectPath);
  const next = applyThreadActions(existing, chapterNumber, actions);
  await saveThreads(projectPath, next);
  return next;
}

export interface UpdateThreadPatch {
  status?: ThreadStatus;
  plannedPayoffAt?: number | null;
  paidOffAt?: number | null;
  droppedAt?: number | null;
  description?: string;
  notes?: string | null;
}

export async function updateThread(
  projectPath: string,
  id: string,
  patch: UpdateThreadPatch
): Promise<Thread> {
  const existing = await loadThreads(projectPath);
  const target = existing.find((t) => t.id === id);
  if (!target) throw new Error(`Thread not found: ${id}`);
  if (patch.status) target.status = patch.status;
  if (patch.description) target.description = patch.description.trim();
  if (Object.prototype.hasOwnProperty.call(patch, 'plannedPayoffAt')) {
    if (patch.plannedPayoffAt === null) delete target.plannedPayoffAt;
    else if (typeof patch.plannedPayoffAt === 'number') target.plannedPayoffAt = patch.plannedPayoffAt;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'paidOffAt')) {
    if (patch.paidOffAt === null) delete target.paidOffAt;
    else if (typeof patch.paidOffAt === 'number') target.paidOffAt = patch.paidOffAt;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'droppedAt')) {
    if (patch.droppedAt === null) delete target.droppedAt;
    else if (typeof patch.droppedAt === 'number') target.droppedAt = patch.droppedAt;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
    if (patch.notes === null) delete target.notes;
    else if (typeof patch.notes === 'string') target.notes = patch.notes;
  }
  await saveThreads(projectPath, existing);
  return target;
}
