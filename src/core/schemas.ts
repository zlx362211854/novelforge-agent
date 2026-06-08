import { z } from 'zod';

export const CoreCastMemberSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
});

export const NovelMetadataSchema = z.object({
  title: z.string().min(1),
  genre: z.string().min(1),
  premise: z.string().min(1),
  language: z.string().min(1).default('zh-CN'),
  style: z.string().min(1).default('清晰、连贯、适合长篇连载'),
  coreCast: z.array(CoreCastMemberSchema).min(1),
});

export const VolumeArchitectureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  order: z.number().int().positive(),
});

export const VolumePacingBoardSchema = z.object({
  volumeId: z.string().min(1),
  start: z.string().min(1),
  promise: z.string().min(1),
  keyTurns: z.array(z.string().min(1)).min(1),
  midpoint: z.string().min(1),
  climax: z.string().min(1),
  payoffs: z.array(z.string().min(1)),
  lingeringMysteries: z.array(z.string().min(1)),
});

export const EndHookFocusSchema = z.enum([
  'cliffhanger',
  'mystery',
  'emotional',
  'reveal',
  'volume_close',
  'gentle',
]);

export const ChapterArchitectureSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  volumeId: z.string().min(1),
  summary: z.string().min(1),
  requiredBeats: z.array(z.string().min(1)).min(1),
  targetWords: z.number().int().positive().optional(),
  requireRecap: z.boolean().optional(),
  endHookFocus: EndHookFocusSchema.optional(),
  povCharacter: z.string().min(1).optional(),
});

export const ArchitecturePayloadSchema = z.object({
  full: z.string().min(1),
  volumes: z.array(VolumeArchitectureSchema).min(1),
  volumePacing: z.array(VolumePacingBoardSchema).optional(),
  chapters: z.array(ChapterArchitectureSchema).min(1),
});

export const ThreadActionSchema = z.object({
  kind: z.enum(['plant', 'build', 'pay', 'drop']),
  threadId: z.string().min(1).optional(),
  description: z.string().min(1),
});

export const ThreadStatusSchema = z.enum(['planted', 'building', 'paid', 'dropped']);

export const ThreadSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  status: ThreadStatusSchema,
  plantedAt: z.number().int().positive(),
  lastTouchedAt: z.number().int().positive(),
  plannedPayoffAt: z.number().int().positive().optional(),
  paidOffAt: z.number().int().positive().optional(),
  droppedAt: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export const CharacterRelationshipStateSchema = z.object({
  name: z.string().min(1),
  dynamic: z.string().min(1),
});

export const CharacterStateSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1).optional(),
  goal: z.string().min(1),
  belief: z.string().min(1),
  relationships: z.array(CharacterRelationshipStateSchema),
  abilities: z.array(z.string().min(1)),
  secrets: z.array(z.string().min(1)),
  emotionalState: z.string().min(1),
  lastUpdatedAt: z.number().int().nonnegative(),
});

export const CharacterStateUpdateSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  belief: z.string().min(1).optional(),
  relationships: z.array(CharacterRelationshipStateSchema).optional(),
  abilities: z.array(z.string().min(1)).optional(),
  secrets: z.array(z.string().min(1)).optional(),
  emotionalState: z.string().min(1).optional(),
});

export const MemoryCardSchema = z.object({
  summary: z.string().min(1),
  keyEvents: z.array(z.string().min(1)),
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    state: z.string().min(1),
  })),
  facts: z.array(z.object({
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
  })),
  stateChanges: z.array(z.object({
    entity: z.string().min(1),
    before: z.string().min(1),
    after: z.string().min(1),
  })),
  openThreads: z.array(z.string().min(1)),
  wordCount: z.number().int().nonnegative().optional(),
  threadActions: z.array(ThreadActionSchema).optional(),
  characterUpdates: z.array(CharacterStateUpdateSchema).optional(),
});

export const ContinuityReviewSchema = z.object({
  range: z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  }),
  status: z.enum(['clean', 'issues_found']),
  issues: z.array(z.object({
    severity: z.enum(['low', 'medium', 'high']),
    description: z.string().min(1),
    evidence: z.string().min(1),
    suggestion: z.string().min(1),
  })),
});

export const ChapterReviewIssueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  category: z.enum([
    'character',
    'world',
    'timeline',
    'item',
    'knowledge',
    'pacing',
    'style',
    'architecture',
    'plot',
    'foreshadow',
    'hook',
    'repetition',
  ]),
  description: z.string().min(1),
  evidence: z.string().min(1),
  suggestion: z.string().min(1),
});

export const ChapterAcceptanceCheckSchema = z.object({
  status: z.enum(['pass', 'fail']),
  evidence: z.string().min(1),
});

export const ChapterAcceptanceGateSchema = z.object({
  requiredBeats: ChapterAcceptanceCheckSchema.extend({
    missingBeats: z.array(z.string().min(1)),
  }),
  narrativeProgress: ChapterAcceptanceCheckSchema,
  characterProgress: ChapterAcceptanceCheckSchema,
  foreshadowProgress: ChapterAcceptanceCheckSchema,
  storyBibleConsistency: ChapterAcceptanceCheckSchema,
  endingHook: ChapterAcceptanceCheckSchema,
  repetition: ChapterAcceptanceCheckSchema,
});

export const ChapterReviewSchema = z.object({
  chapterNumber: z.number().int().positive(),
  status: z.enum(['clean', 'issues_found']),
  acceptance: ChapterAcceptanceGateSchema,
  issues: z.array(ChapterReviewIssueSchema),
});

export const CrossChapterReviewSchema = z.object({
  range: z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  }),
  status: z.enum(['clean', 'issues_found']),
  issues: z.array(z.object({
    severity: z.enum(['low', 'medium', 'high']),
    chapters: z.array(z.number().int().positive()).min(1),
    description: z.string().min(1),
    evidence: z.string().min(1),
    suggestion: z.string().min(1),
  })),
});
