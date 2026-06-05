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

export const ChapterArchitectureSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  volumeId: z.string().min(1),
  summary: z.string().min(1),
  requiredBeats: z.array(z.string().min(1)).min(1),
});

export const ArchitecturePayloadSchema = z.object({
  full: z.string().min(1),
  volumes: z.array(VolumeArchitectureSchema).min(1),
  chapters: z.array(ChapterArchitectureSchema).min(1),
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
