import { NovelMetadataSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { initializeCharacterStates } from '../characterStore.js';
import { StepHandler, parseJson } from './types.js';

export const novelMetadataHandler: StepHandler = async (state, content) => {
  const parsed = NovelMetadataSchema.parse(parseJson(content));
  const path = await saveJsonFile(state.projectPath, 'novel.json', parsed);
  const charactersPath = await initializeCharacterStates(state.projectPath, parsed.coreCast);
  return {
    savedPaths: [path, charactersPath],
    fileEntries: { novel: 'novel.json', characters: 'characters.json' },
    next: { kind: 'linear', nextStep: 'story_bible' },
  };
};
