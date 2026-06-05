import { NovelMetadataSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { StepHandler, parseJson } from './types.js';

export const novelMetadataHandler: StepHandler = async (state, content) => {
  const parsed = NovelMetadataSchema.parse(parseJson(content));
  const path = await saveJsonFile(state.projectPath, 'novel.json', parsed);
  return {
    savedPaths: [path],
    fileEntries: { novel: 'novel.json' },
    next: { kind: 'linear', nextStep: 'story_bible' },
  };
};
