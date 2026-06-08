import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CharacterState, CharacterStateUpdate, CoreCastMember } from './types.js';

const CHARACTERS_FILE = 'characters.json';

export interface CharactersBundle {
  characters: CharacterState[];
}

function emptyState(member: CoreCastMember, chapterNumber = 0): CharacterState {
  return {
    name: member.name,
    role: member.role,
    goal: '未确认',
    belief: '未确认',
    relationships: [],
    abilities: [],
    secrets: [],
    emotionalState: member.description,
    lastUpdatedAt: chapterNumber,
  };
}

export async function loadCharacterStates(projectPath: string): Promise<CharacterState[]> {
  try {
    const raw = await readFile(join(projectPath, CHARACTERS_FILE), 'utf8');
    const parsed = JSON.parse(raw) as CharactersBundle;
    return Array.isArray(parsed.characters) ? parsed.characters : [];
  } catch {
    return [];
  }
}

export async function saveCharacterStates(projectPath: string, characters: CharacterState[]): Promise<string> {
  const fullPath = join(projectPath, CHARACTERS_FILE);
  await writeFile(fullPath, `${JSON.stringify({ characters }, null, 2)}\n`, 'utf8');
  return fullPath;
}

export async function initializeCharacterStates(
  projectPath: string,
  coreCast: CoreCastMember[]
): Promise<string> {
  const existing = await loadCharacterStates(projectPath);
  const byName = new Map(existing.map((c) => [c.name, c]));
  for (const member of coreCast) {
    if (!byName.has(member.name)) {
      byName.set(member.name, emptyState(member));
    }
  }
  return saveCharacterStates(projectPath, Array.from(byName.values()));
}

export async function applyCharacterUpdates(
  projectPath: string,
  chapterNumber: number,
  updates: CharacterStateUpdate[] | undefined
): Promise<CharacterState[]> {
  const existing = await loadCharacterStates(projectPath);
  if (!updates || !updates.length) return existing;

  const byName = new Map(existing.map((c) => [c.name, { ...c }]));
  for (const update of updates) {
    const current = byName.get(update.name) ?? {
      name: update.name,
      role: update.role,
      goal: '未确认',
      belief: '未确认',
      relationships: [],
      abilities: [],
      secrets: [],
      emotionalState: '未确认',
      lastUpdatedAt: chapterNumber,
    };

    byName.set(update.name, {
      ...current,
      role: update.role ?? current.role,
      goal: update.goal ?? current.goal,
      belief: update.belief ?? current.belief,
      relationships: update.relationships ?? current.relationships,
      abilities: update.abilities ?? current.abilities,
      secrets: update.secrets ?? current.secrets,
      emotionalState: update.emotionalState ?? current.emotionalState,
      lastUpdatedAt: chapterNumber,
    });
  }

  const next = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  await saveCharacterStates(projectPath, next);
  return next;
}
