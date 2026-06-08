import { join } from 'node:path';
import { archiveChapterVersion, saveMarkdownFile } from '../projectStore.js';
import { chapterFileName, chapterVersionFileName } from '../fileNames.js';
import { indexChapter } from '../retrieval/index.js';
import { StepHandler, requireNonEmpty } from './types.js';

export const chapterRevisionHandler: StepHandler = async (state, content) => {
  requireNonEmpty(content, 'Chapter revision Markdown');
  const target = state.pendingAction?.chapterNumber ?? state.currentChapter;
  const chapterRelative = join('chapters', chapterFileName(target));
  const versionRelative = join('chapters/.versions', chapterVersionFileName(target, new Date().toISOString()));
  const archived = await archiveChapterVersion(state.projectPath, chapterRelative, versionRelative);
  const savedPaths = archived ? [archived] : [];
  savedPaths.push(await saveMarkdownFile(state.projectPath, chapterRelative, content));
  await indexChapter(state.projectPath, target, content);
  if (state.pendingAction?.mode === 'gate') {
    return {
      savedPaths,
      fileEntries: { [`chapter-${target}`]: chapterRelative },
      next: {
        kind: 'linear',
        nextStep: 'chapter_review',
        statePatch: {
          pendingAction: {
            step: 'chapter_review',
            mode: 'gate',
            chapterNumber: target,
          },
        },
      },
    };
  }

  return {
    savedPaths,
    fileEntries: { [`chapter-${target}`]: chapterRelative },
    next: { kind: 'sideTrackReturn' },
  };
};
