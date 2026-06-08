import { join } from 'node:path';
import { saveMarkdownFile } from '../projectStore.js';
import { chapterFileName } from '../fileNames.js';
import { indexChapter } from '../retrieval/index.js';
import { StepHandler, requireNonEmpty } from './types.js';

export const chapterHandler: StepHandler = async (state, content) => {
  requireNonEmpty(content, 'Chapter Markdown');
  const relative = join('chapters', chapterFileName(state.currentChapter));
  const path = await saveMarkdownFile(state.projectPath, relative, content);
  await indexChapter(state.projectPath, state.currentChapter, content);
  return {
    savedPaths: [path],
    fileEntries: { [`chapter-${state.currentChapter}`]: relative },
    next: {
      kind: 'linear',
      nextStep: 'chapter_review',
      statePatch: {
        pendingAction: {
          step: 'chapter_review',
          mode: 'gate',
          chapterNumber: state.currentChapter,
        },
      },
    },
  };
};
