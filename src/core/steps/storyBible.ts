import { saveMarkdownFile } from '../projectStore.js';
import { indexStoryBible } from '../retrieval/index.js';
import { StepHandler, requireNonEmpty } from './types.js';

export const storyBibleHandler: StepHandler = async (state, content) => {
  requireNonEmpty(content, 'Story bible Markdown');
  const path = await saveMarkdownFile(state.projectPath, 'story-bible.md', content);
  await indexStoryBible(state.projectPath, content);
  return {
    savedPaths: [path],
    fileEntries: { storyBible: 'story-bible.md' },
    next: { kind: 'linear', nextStep: 'style_guide' },
  };
};
