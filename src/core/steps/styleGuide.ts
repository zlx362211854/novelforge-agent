import { StyleGuideSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { StepHandler, parseJson } from './types.js';

export const styleGuideHandler: StepHandler = async (state, content) => {
  const parsed = StyleGuideSchema.parse(parseJson(content));
  const path = await saveJsonFile(state.projectPath, 'style-guide.json', parsed);
  return {
    savedPaths: [path],
    fileEntries: { styleGuide: 'style-guide.json' },
    next: { kind: 'linear', nextStep: 'architecture' },
  };
};
