import { ArchitecturePayloadSchema } from '../schemas.js';
import { saveJsonFile, saveMarkdownFile } from '../projectStore.js';
import { StepHandler, parseJson } from './types.js';

export const architectureHandler: StepHandler = async (state, content) => {
  const parsed = ArchitecturePayloadSchema.parse(parseJson(content));
  const savedPaths = [
    await saveMarkdownFile(state.projectPath, 'architecture/full.md', parsed.full),
    await saveJsonFile(state.projectPath, 'architecture/volumes.json', parsed.volumes),
    await saveJsonFile(state.projectPath, 'architecture/chapters.json', parsed.chapters),
  ];
  if (parsed.volumePacing) {
    savedPaths.push(await saveJsonFile(state.projectPath, 'architecture/volume-pacing.json', parsed.volumePacing));
  }
  return {
    savedPaths,
    fileEntries: {
      architecture: 'architecture/chapters.json',
      ...(parsed.volumePacing ? { volumePacing: 'architecture/volume-pacing.json' } : {}),
    },
    next: { kind: 'linear', nextStep: 'chapter' },
  };
};
