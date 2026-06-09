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

function buildStyleGuidePrompt(input: PromptBuildInput): BuiltPrompt {
return {
      purpose: 'style_guide',
      expectedFormat: 'JSON matching StyleGuideSchema',
      prompt: `You are the style editor for a long-form novel. From the user prompt, metadata, and story bible, create a style guide that chapter writing and review can enforce over the whole project.

## User Prompt
${input.state.initialPrompt}

${input.context ? `## Existing Context\n${input.context}\n` : ''}## Output Requirements
Output valid JSON only, in this shape:
{
  "narrativeVoice": "Narration person, POV distance, narrator texture, emotional temperature",
  "pacing": "Rules for openings, transitions, conflict movement, and chapter-end hooks",
  "diction": "Word choice, sentence density, genre terminology boundaries",
  "dialogueRules": [
    "Rules for core character dialogue length, tone, subtext, and forms of address"
  ],
  "prohibitedPatterns": [
    "Patterns to avoid: modern memes, explanatory narration, lore dumping, voice drift, etc."
  ],
  "proseRhythm": {
    "sentenceRhythm": "How short, medium, and long sentences should be used; short sentences should serve turns, danger, or emotional landings, not default narration",
    "paragraphing": "Paragraphs should form complete narrative units; avoid consecutive one-sentence paragraphs and line breaks used as fake rhythm",
    "interiorityMode": "How interiority should be refracted through action, hesitation, and sensory response; avoid frequent direct explanation of thoughts",
    "emphasisBudget": "Budget for repetition, dashes, isolated short sentences, and other emphasis tools",
    "antiPatterns": [
      "3 or more consecutive one-sentence short paragraphs",
      "many short sentences used to simulate tension",
      "explaining psychology immediately after every action",
      "repeating the same sentence pattern to create fake rhythm"
    ]
  },
  "sampleParagraph": "A 120-250 word target-style sample. Do not turn it into plot outline.",
  "consistencyChecks": [
    "Concrete checks future chapter reviews should use to detect style drift"
  ]
}

Rules:
- Match genre, premise, character identities, and reader expectations.
- Do not rely on abstract adjectives only; every field must guide actual prose.
- proseRhythm must not be fixed word-count rules; describe reviewable rhythm principles and anti-patterns.
- sampleParagraph demonstrates prose texture only. Do not reveal future plot.
- prohibitedPatterns must contain at least 3 entries; consistencyChecks must contain at least 3 entries.
- proseRhythm.antiPatterns must contain at least 4 entries.
${strictJsonOutputRules()}`,
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
- Whole-book target is about ${input.state.plannedTotalChapters ?? input.state.targetChapters} chapters; generate only the first ${input.state.targetChapters} chapter architectures in this first batch.
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
  "volumePacing": [
    {
      "volumeId": "v1",
      "start": "Volume starting state: protagonist/world/conflict",
      "promise": "Core reader promise or question for this volume",
      "keyTurns": ["Key turn 1", "Key turn 2"],
      "midpoint": "Midpoint turn or changed understanding",
      "climax": "Volume climax",
      "payoffs": ["Threads or promises this volume plans to pay off"],
      "lingeringMysteries": ["Mysteries intentionally left open at volume end"]
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
- chapters do not need to cover the whole book; when writing reaches the boundary, the workflow will request architecture_extension.
- chapterNumber must start at 1 and increase contiguously.
- volumeId must reference an id from volumes.
- volumePacing must provide one pacing board for every volume.
- requiredBeats must include at least one concrete, actionable beat.
${strictJsonOutputRules()}`,
    };
}

function buildArchitectureExtensionPrompt(input: PromptBuildInput): BuiltPrompt {
  const start = input.state.currentChapter;
  const total = input.state.plannedTotalChapters ?? input.state.targetChapters;
  const end = Math.min(total, start + input.state.targetChapters - 1);
  return {
    purpose: 'architecture_extension',
    expectedFormat: 'JSON matching ArchitectureExtensionPayloadSchema',
    prompt: `You are the chief architect for a long-form novel. The manuscript has reached the edge of the existing chapter plan; extend the architecture from current continuity.

## Extension Range
- Start at chapter ${start}.
- This batch should plan through chapter ${end} at most.
- The whole-book target ends at chapter ${total}.

## Extension Principles
- Do not rewrite existing chapter architecture; append only new chapter architecture.
- New chapters must follow recent memory, the character state table, active foreshadow threads, and volume pacing boards.
- If the next chapters enter a new volume, add volumes and volumePacing. If they remain in an existing volume, you may provide an updated pacing board for that volume.
- If the full-book direction needs adjustment because of written material, include fullUpdate. fullUpdate must be a complete replacement for architecture/full.md, not a change note.
- Chapter architecture must cover only what should happen in that chapter and must not reveal later concrete events early.

${input.context ? `## Existing Context\n${input.context}\n` : ''}## Output Requirements
Output valid JSON only, in this shape:
{
  "fullUpdate": "optional complete updated full-book architecture",
  "volumes": [
    {
      "id": "v2",
      "title": "New or updated volume title",
      "summary": "Volume goal, conflict, climax, and end hook",
      "order": 2
    }
  ],
  "volumePacing": [
    {
      "volumeId": "v2",
      "start": "Volume starting state",
      "promise": "Volume promise",
      "keyTurns": ["Key turn 1", "Key turn 2"],
      "midpoint": "Midpoint turn",
      "climax": "Volume climax",
      "payoffs": ["Planned payoffs"],
      "lingeringMysteries": ["Lingering mysteries"]
    }
  ],
  "chapters": [
    {
      "chapterNumber": ${start},
      "title": "Chapter title",
      "volumeId": "v1",
      "summary": "Chapter plot summary",
      "requiredBeats": ["Required beat 1"]
    }
  ]
}

Rules:
- chapters[0].chapterNumber must equal ${start}.
- chapterNumber must increase contiguously and must not exceed ${total}.
- chapters.length should be ${end - start + 1} unless the book has reached its ending.
- requiredBeats must include at least one concrete, actionable beat.
- volumeId must reference an existing volume id or a volume id supplied in this response.
${strictJsonOutputRules()}`,
    };
}

function buildChapterPrompt(input: PromptBuildInput): BuiltPrompt {
  const ch = input.state.currentChapter;
  const isFirstChapter = ch <= 1;
  return {
    purpose: 'chapter',
    expectedFormat: 'Markdown',
    prompt: `You are a professional long-form fiction writer. Write chapter ${ch} directly.

## Priority Order
1. Strictly follow the current chapter architecture, user additions, story bible hard constraints, style guide, and previous-chapter continuity.
2. Use relevant memory, prior text evidence, and active foreshadow threads.
3. Treat full-book and volume plans as distant planning context only. Do not write concrete future events early.

## Length Target
- Default target: ~2500 words (±20%). If the chapter architecture specifies targetWords, follow it.
- Do not pad to hit the target; do not under-write to be brief at the cost of conflict.

## Structure
${isFirstChapter
  ? '- This is chapter 1. No recap needed. Open with character and situation directly.'
  : '- Start with a 2-3 sentence recap or bridge so a reader who skipped the last chapter can re-enter (unless the chapter architecture has requireRecap=false). Make it natural, not meta-narration like "previously...".'}
- The chapter must end on a clear hook: cliffhanger, mystery, emotional resonance, reveal, or volume close — per the chapter architecture endHookFocus. Default: cliffhanger.

## Style
- Enforce the Style Guide from context. Treat sampleParagraph as prose texture only; do not copy its content.
- Enforce Style Guide.proseRhythm: short sentences, one-line paragraphs, repeated sentences, and dashes are emphasis tools, not default narration. Ordinary narration should form natural sentence groups.
- Match the novel's genre, world, character identities, and emotional tone.
- Natural, stable, readable language; prioritize narrative progress, character work, and emotional accumulation.
- Dialogue fits each character's identity, relationship, and situation.
- Important emotion comes through action, body language, pacing, and subtext.
- Scene description has useful sensory detail without stalling.
- POV: strictly follow the chapter architecture povCharacter (if set). No mid-chapter POV switch.

## Execution Rules
- Write only what the current chapter architecture authorizes.
- Do not introduce unauthorized major characters. Functional background characters stay light.
- Keep names, items, places, abilities, timelines, injuries, relationships, and knowledge boundaries consistent.
- If the previous chapter ends mid-action or mid-scene, this chapter must continue from that point.
- Active foreshadow threads may be advanced or paid off this chapter, but **never silently dropped** — even if you choose not to touch them, leave them coherent.
- Avoid cost-free power jumps, forced stupidity, mechanical twists, info-dumps, and empty lyricism.
- Do not output summaries, bullet points, lectures, explanatory prefaces, or meta-text like "what I changed".

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
  "openThreads": ["Unresolved promise, danger, question, or plot thread"],
  "wordCount": <approximate word count of this chapter as an integer>,
  "threadActions": [
    {
      "kind": "plant | build | pay | drop",
      "threadId": "id of an existing active thread (required for build/pay/drop; leave empty for plant — the system will assign one)",
      "description": "for plant: what the new thread is; for others: one sentence on how this chapter advanced/paid/dropped that thread"
    }
  ],
  "characterUpdates": [
    {
      "name": "Character name",
      "role": "Role if confirmed or changed this chapter",
      "goal": "Current goal at chapter end",
      "belief": "Core belief or understanding driving them at chapter end",
      "relationships": [
        { "name": "Related character", "dynamic": "Relationship state at chapter end" }
      ],
      "abilities": ["Abilities, resources, or limits confirmed at chapter end"],
      "secrets": ["Secrets still hidden or only partially known at chapter end"],
      "emotionalState": "Emotional state at chapter end"
    }
  ]
}

Rules:
- Record only information that happened or was confirmed in this chapter.
- Do not speculate about future plot.
- Make facts and stateChanges concrete enough for later chapter reference.
- wordCount: approximate word count (English) or character count (CJK). An integer estimate is fine.
- threadActions is critical:
  · For any active foreshadow thread in the context's "Active Foreshadow Threads" section, if this chapter advanced it emit kind="build"; if this chapter paid it off emit kind="pay"; if this chapter abandoned it emit kind="drop". threadId is required.
  · For any new thread this chapter plants, emit kind="plant" with a clear description.
  · If an active thread was not touched, no action needed — but never silently delete it. Without a drop action, the thread stays active.
- characterUpdates maintains a separate character state table. Emit only important characters whose state changed or was reconfirmed in this chapter; goal, belief, relationships, abilities, secrets, and emotionalState must reflect the chapter ending.
${strictJsonOutputRules()}`,
  };
}

function buildContinuityReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const end = Math.max(input.state.plannedTotalChapters ?? input.state.targetChapters, input.state.currentChapter - 1);
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
- This is a mandatory chapter acceptance gate. If any acceptance item fails, status must be "issues_found" and the workflow must revise before continuing.
- Whether every requiredBeat is fulfilled; missing beats must appear in acceptance.requiredBeats.missingBeats.
- Whether this chapter advances the main line, character state, or active foreshadow threads. If it is static, at least one of narrativeProgress/characterProgress/foreshadowProgress must fail.
- Whether it violates the story bible, character state table, volume pacing board, or prior memory.
- Whether it violates the Style Guide: narrative voice, sentence density, genre diction, dialogue rules, or prohibited patterns.
- Whether it violates Style Guide.proseRhythm: excessive short-sentence density, consecutive one-sentence paragraphs, fake rhythm through line breaks, overly direct interior explanation, or repeated sentence patterns.
- Whether the ending has a clear hook that matches the chapter architecture endHookFocus.
- Whether it repeats prior chapter beats, conflict patterns, reveals, or dialogue functions.
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
  "acceptance": {
    "requiredBeats": {
      "status": "pass | fail",
      "evidence": "Evidence for each requiredBeat",
      "missingBeats": []
    },
    "narrativeProgress": {
      "status": "pass | fail",
      "evidence": "How this chapter advances the main line or phase objective"
    },
    "characterProgress": {
      "status": "pass | fail",
      "evidence": "How this chapter changes or confirms key character goal, belief, relationship, ability, secret, or emotion"
    },
    "foreshadowProgress": {
      "status": "pass | fail",
      "evidence": "How this chapter plants, advances, pays, or deliberately preserves foreshadow threads"
    },
    "storyBibleConsistency": {
      "status": "pass | fail",
      "evidence": "Whether it matches the story bible, character state table, and world rules"
    },
    "proseRhythm": {
      "status": "pass | fail",
      "evidence": "Whether it follows Style Guide.proseRhythm; explain whether short sentences, one-line paragraphs, repetition, and interior explanation are controlled"
    },
    "endingHook": {
      "status": "pass | fail",
      "evidence": "The ending hook passage and its function"
    },
    "repetition": {
      "status": "pass | fail",
      "evidence": "Whether it repeats prior beats; if not, explain why"
    }
  },
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
- status may be "clean" only when every acceptance item is "pass".
- If any acceptance item is "fail", include a matching issue with a concrete fix.
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
    case 'style_guide':
      return buildStyleGuidePrompt(input);
    case 'architecture':
      return buildArchitecturePrompt(input);
    case 'architecture_extension':
      return buildArchitectureExtensionPrompt(input);
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
    case 'novel_metadata_amend':
      return buildMetadataPrompt(input);
    case 'story_bible_amend':
      return {
        purpose: 'story_bible',
        expectedFormat: 'Markdown',
        prompt: `Based on the current story bible and the amendment context, output the FULL revised story bible Markdown.

${input.context ? `## Amendment Context\n${input.context}\n` : ''}## Output Requirements
- Output the entire story-bible.md content — it replaces the old one (old version auto-archived under story-bible-versions/).
- Preserve everything that still holds; modify / add / remove only what the amendment context justifies.
- Do not output diff markers, change logs, or bullet summaries — just the new full bible.`,
      };
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
