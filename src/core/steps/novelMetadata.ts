import { join } from 'node:path';
import { NovelMetadataSchema } from '../schemas.js';
import { renameProjectForTitle, saveJsonFile } from '../projectStore.js';
import { initializeCharacterStates } from '../characterStore.js';
import { StepHandler, parseJson } from './types.js';

export const novelMetadataHandler: StepHandler = async (state, content) => {
  const parsed = NovelMetadataSchema.parse(parseJson(content));
  const path = await saveJsonFile(state.projectPath, 'novel.json', parsed);
  const charactersPath = await initializeCharacterStates(state.projectPath, parsed.coreCast);
  const projectPath = await renameProjectForTitle(state.projectPath, parsed.title);
  return {
    savedPaths: [
      projectPath === state.projectPath ? path : join(projectPath, 'novel.json'),
      projectPath === state.projectPath ? charactersPath : join(projectPath, 'characters.json'),
    ],
    fileEntries: { novel: 'novel.json', characters: 'characters.json' },
    next: {
      kind: 'linear',
      nextStep: 'story_bible',
      statePatch: { projectPath },
    },
  };
};
