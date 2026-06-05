import { BuiltPrompt, PromptBuildInput, PromptPack } from './types.js';

function strictJsonOutputRules(): string {
  return [
    'JSON output rules:',
    '- Output valid JSON only. Do not include Markdown, code fences, explanations, prefixes, or suffixes.',
    '- Strings must use double quotes.',
    '- Do not use undefined, NaN, Infinity, comments, or trailing commas.',
    '- Array fields must be real arrays, not stringified arrays.',
  ].join('\n');
}

function buildMetadataPrompt(input: PromptBuildInput): BuiltPrompt {
return {
      purpose: 'novel_metadata',
      expectedFormat: 'JSON matching NovelMetadataSchema',
      prompt: `You are the lead planner for a long-form serialized novel. Generate the foundational metadata for a new novel from the user's premise.

## User Prompt
${input.state.initialPrompt}

## Output Requirements
Output valid JSON only, in this shape:
{
  "title": "Novel title",
  "genre": "Genre",
  "premise": "Story premise, 80-200 words",
  "language": "en-US",
  "style": "Style guidance",
  "coreCast": [
    {
      "name": "Character name",
      "role": "Character role",
      "description": "Character description"
    }
  ]
}

Rules:
- title, genre, premise, language, and style must be non-empty strings.
- coreCast must include at least one central character.
- The premise must support a long-form serial, not just a one-line concept.
${strictJsonOutputRules()}`,
    };
}

function buildStoryBiblePrompt(input: PromptBuildInput): BuiltPrompt {
return {
      purpose: 'story_bible',
      expectedFormat: 'Markdown',
      prompt: `You are a story bible editor. Create a reusable Markdown story bible for this long-form novel.

## User Prompt
${input.state.initialPrompt}

${input.context ? `## Existing Context\n${input.context}\n` : ''}## Output Structure
Use Markdown and include at least:

## Core Characters
- Goals, weaknesses, relationships, and long-term change direction for the main cast.

## Relationships
- Core bonds, conflicts, hidden relationships, and future development points.

## World Rules
- Hard genre rules, limits, costs, social structures, factions, or power systems.

## Main Plot And Subplots
- Main objective.
- At least three long-running threads or subplots.

## Style Constraints
- Narrative voice, pacing, forbidden patterns, and dialogue boundaries.

Rules:
- Make this useful for repeated reference during chapter generation.
- Do not write chapter prose.
- Do not output JSON.`,
    };
}

function buildArchitecturePrompt(input: PromptBuildInput): BuiltPrompt {
return {
      purpose: 'architecture',
      expectedFormat: 'JSON matching ArchitecturePayloadSchema',
      prompt: `You are the chief architect for a long-form novel. Generate full-book, volume, and chapter architecture.

## User Prompt
${input.state.initialPrompt}

## Goals
- Generate at least ${input.state.targetChapters} chapter architectures for this first run.
- The full-book architecture should define the long-term main line and ending direction.
- Volume architecture should define phase conflict, climax, and volume-end hooks.
- Chapter architecture must cover only what should happen in that chapter and must not reveal later concrete events early.

${input.context ? `## Existing Context\n${input.context}\n` : ''}## Output Requirements
Output valid JSON only, in this shape:
{
  "full": "Complete full-book main line, phase progression, central conflict, theme, and ending direction",
  "volumes": [
    {
      "id": "v1",
      "title": "Volume title",
      "summary": "Volume goal, conflict, climax, and end hook",
      "order": 1
    }
  ],
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "Chapter title",
      "volumeId": "v1",
      "summary": "Chapter plot summary",
      "requiredBeats": ["Required beat 1", "Required beat 2"]
    }
  ]
}

Rules:
- chapters.length must be at least ${input.state.targetChapters}.
- chapterNumber must start at 1 and increase contiguously.
- volumeId must reference an id from volumes.
- requiredBeats must include at least one concrete, actionable beat.
${strictJsonOutputRules()}`,
    };
}

function buildChapterPrompt(input: PromptBuildInput): BuiltPrompt {
return {
      purpose: 'chapter',
      expectedFormat: 'Markdown',
      prompt: `You are a professional long-form fiction writer. Write chapter ${input.state.currentChapter} directly.

## Priority Order
1. Strictly follow the current chapter architecture, user additions, story bible hard constraints, and previous-chapter continuity.
2. Use relevant memory and prior text evidence to preserve consistency.
3. Treat full-book and volume plans as distant planning context only. Do not write concrete future events early.

## Style And Length
- Match the novel's genre, world, character identities, and emotional tone.
- Keep the language natural, stable, and readable. Prioritize narrative progress, character work, and emotional accumulation.
- Dialogue must fit each character's identity, relationship, and immediate situation.
- Important emotion should appear through action, body language, pacing, and subtext where possible.
- Scene description should provide useful sensory and atmospheric detail, but never stall the plot.
- Conflict, turns, suspense, and the chapter-end hook should be clear.

## Execution Rules
- Write only what the current chapter architecture authorizes.
- Do not introduce unauthorized major characters. Functional background characters should stay light.
- Keep names, items, places, abilities, timeline, injuries, relationships, and knowledge boundaries consistent.
- If the previous chapter ends mid-action, mid-dialogue, or in the same scene, this chapter must continue from that point.
- Avoid cost-free power jumps, forced stupidity, mechanical twists, info-dumps, and empty lyricism.
- Do not output summaries, bullet points, lectures, or explanatory prefaces.

${input.context ? `## Generation Context\n${input.context}\n` : ''}## Output Requirements
- Output Markdown.
- First line must be the chapter title as H1, for example: # Chapter Title
- After the H1, begin the prose directly.`,
    };
}

function buildMemoryPrompt(input: PromptBuildInput): BuiltPrompt {
return {
      purpose: 'memory_card',
      expectedFormat: 'JSON matching MemoryCardSchema',
      prompt: `You are a continuity editor for a long-form novel. Extract a memory card from chapter ${input.state.currentChapter}.

${input.context ? `## Current Chapter Context\n${input.context}\n` : ''}## Output Requirements
Output valid JSON only, in this shape:
{
  "summary": "Chapter summary",
  "keyEvents": ["Key event 1"],
  "entities": [
    {
      "name": "Character/place/item/faction name",
      "type": "person | location | item | faction | concept",
      "state": "State at the end of this chapter"
    }
  ],
  "facts": [
    {
      "subject": "Subject",
      "predicate": "Relation or action",
      "object": "Object"
    }
  ],
  "stateChanges": [
    {
      "entity": "Entity",
      "before": "Before",
      "after": "After"
    }
  ],
  "openThreads": ["Unresolved promise, danger, question, or plot thread"]
}

Rules:
- Record only information that happened or was confirmed in this chapter.
- Do not speculate about future plot.
- Make facts and stateChanges concrete enough for later chapter reference.
${strictJsonOutputRules()}`,
    };
}

function buildContinuityReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const end = Math.max(input.state.targetChapters, input.state.currentChapter - 1);
return {
      purpose: 'continuity_review',
      expectedFormat: 'JSON matching ContinuityReviewSchema',
      prompt: `You are a continuity reviewer for a long-form novel. Review chapters 1-${end} for continuity issues.

${input.context ? `## Review Context\n${input.context}\n` : ''}## Review Focus
- Character state, location, injuries, and relationships.
- Item ownership, ability limits, and world rules.
- Misread, forgotten, or prematurely revealed plot threads.
- Violations of chapter architecture requirements.

## Output Requirements
Output valid JSON only, in this shape:
{
  "range": {
    "start": 1,
    "end": ${end}
  },
  "status": "clean",
  "issues": [
    {
      "severity": "low | medium | high",
      "description": "Issue description",
      "evidence": "Specific evidence from the context",
      "suggestion": "Suggested fix"
    }
  ]
}

Rules:
- If there are no issues, use status "clean" and an empty issues array.
- If there are issues, use status "issues_found".
- evidence must be specific. Do not write vague claims like "possibly inconsistent".
${strictJsonOutputRules()}`,
    };
}

function buildChapterReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const chapter = input.state.pendingAction?.chapterNumber ?? input.state.currentChapter;
return {
      purpose: 'chapter_review',
      expectedFormat: 'JSON matching ChapterReviewSchema',
      prompt: `You are a strict editor reviewing a single chapter of a serial novel for in-chapter problems and conflicts with established context.

${input.context ? `## Review Context\n${input.context}\n` : ''}## Review Focus
- Character voice, motivation, and state vs the story bible and prior memory.
- World rules, item ownership, and ability limits.
- Timeline, location, and continuity with the previous chapter ending.
- Whether the chapter fulfills the requiredBeats of its chapter architecture.
- Style: pacing, info-dump, forced twists, empty lyricism, bullet-style narration.

## Output Requirements
Output valid JSON only, in this shape:
{
  "chapterNumber": ${chapter},
  "status": "clean",
  "issues": [
    {
      "severity": "low | medium | high",
      "category": "character | world | timeline | item | knowledge | pacing | style | architecture",
      "description": "Specific issue",
      "evidence": "Quote or paraphrase the exact passage that proves the issue",
      "suggestion": "Concrete fix"
    }
  ]
}

Rules:
- If there are no issues, use status "clean" with an empty issues array.
- Otherwise use status "issues_found".
- evidence must be specific; do not write "possibly" or "maybe".
${strictJsonOutputRules()}`,
    };
}

function buildChapterRevisionPrompt(input: PromptBuildInput): BuiltPrompt {
const chapter = input.state.pendingAction?.chapterNumber ?? input.state.currentChapter;
return {
      purpose: 'chapter_revision',
      expectedFormat: 'Markdown',
      prompt: `You are revising chapter ${chapter} of a serial novel based on editor feedback. Produce a full revised chapter draft.

## Priority Order
1. Resolve every issue in the feedback. Do not skip any.
2. Preserve everything else that already works: structure, tone, character voice, working dialogue.
3. Keep continuity with story bible, prior chapter ending, and existing memory.

## Style Rules
- Keep the same chapter title and Markdown shape.
- Do not output bullet summaries, change logs, or "what I changed" explanations.
- Do not introduce new major characters or plot threads that the architecture does not authorize.

${input.context ? `## Revision Context\n${input.context}\n` : ''}## Output Requirements
- Output Markdown only.
- First line must be the chapter title as H1 (\`# Chapter Title\`).
- After the H1, output the full revised prose. Do not output diff markers.`,
    };
}

function buildCrossChapterReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const range = input.state.pendingAction?.range ?? { start: 1, end: input.state.currentChapter - 1 };
return {
      purpose: 'cross_chapter_review',
      expectedFormat: 'JSON matching CrossChapterReviewSchema',
      prompt: `You are a senior continuity editor. Review chapters ${range.start}-${range.end} together and surface cross-chapter conflicts that single-chapter review cannot catch.

${input.context ? `## Review Context\n${input.context}\n` : ''}## Review Focus
- Drifting character state across chapters (e.g. an injury that vanishes).
- Conflicting facts established in different chapters.
- Open threads that were silently dropped.
- World-rule violations introduced in later chapters.
- Pacing problems visible only across multiple chapters.

## Output Requirements
Output valid JSON only, in this shape:
{
  "range": { "start": ${range.start}, "end": ${range.end} },
  "status": "clean",
  "issues": [
    {
      "severity": "low | medium | high",
      "chapters": [${range.start}, ${range.end}],
      "description": "Specific issue",
      "evidence": "Cite the conflicting passages or memory entries by chapter",
      "suggestion": "Concrete fix"
    }
  ]
}

Rules:
- chapters must list every chapter implicated by the issue.
- evidence must reference specific chapter content or memory, not vague claims.
${strictJsonOutputRules()}`,
    };
}

function buildPromptForStep(input: PromptBuildInput): BuiltPrompt {
  switch (input.state.currentStep) {
    case 'novel_metadata':
      return buildMetadataPrompt(input);
    case 'story_bible':
      return buildStoryBiblePrompt(input);
    case 'architecture':
      return buildArchitecturePrompt(input);
    case 'chapter':
      return buildChapterPrompt(input);
    case 'memory_card':
      return buildMemoryPrompt(input);
    case 'continuity_review':
      return buildContinuityReviewPrompt(input);
    case 'chapter_review':
      return buildChapterReviewPrompt(input);
    case 'chapter_revision':
      return buildChapterRevisionPrompt(input);
    case 'cross_chapter_review':
      return buildCrossChapterReviewPrompt(input);
    case 'complete':
      return {
        purpose: 'continuity_review',
        expectedFormat: 'No output required',
        prompt: 'The workflow is complete.',
      };
  }
}

export const enUSPromptPack: PromptPack = {
  buildPromptForStep,
  strictJsonOutputRules,
};
