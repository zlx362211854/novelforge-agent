import { BuiltPrompt, PromptBuildInput, PromptPack } from './types.js';

function strictJsonOutputRules(): string {
  return [
    'JSON 输出规则：',
    '- 只输出合法 JSON，不要输出 Markdown、代码块、解释或前后缀文本。',
    '- 字符串必须使用双引号。',
    '- 不要使用 undefined、NaN、Infinity、注释或尾随逗号。',
    '- 数组字段必须输出真实数组，不要输出字符串化数组。',
  ].join('\n');
}

function buildMetadataPrompt(input: PromptBuildInput): BuiltPrompt {
return {
    purpose: 'novel_metadata',
    expectedFormat: 'JSON matching NovelMetadataSchema',
    prompt: `你是一名长篇网络小说总策划。请根据用户提示生成新小说的基础信息。

## 用户提示词
${input.state.initialPrompt}

## 输出要求
请只输出合法 JSON，格式如下：
{
  "title": "小说名称",
  "genre": "题材",
  "premise": "故事前提，80-200字",
  "language": "zh-CN",
  "style": "文风说明",
  "coreCast": [
    {
      "name": "角色姓名",
      "role": "角色定位",
      "description": "角色描述"
    }
  ]
}

要求：
- title、genre、premise、language、style 必须是非空字符串。
- coreCast 至少包含 1 个核心人物。
- premise 要能支撑长篇连载，不要只写一句设定。
${strictJsonOutputRules()}`,
  };
}

function buildStoryBiblePrompt(input: PromptBuildInput): BuiltPrompt {
return {
    purpose: 'story_bible',
    expectedFormat: 'Markdown',
    prompt: `你是一名故事圣经编辑。请为这部长篇小说生成可长期复用的 Markdown 故事圣经。

## 用户提示词
${input.state.initialPrompt}

${input.context ? `## 已有上下文\n${input.context}\n` : ''}## 输出结构
请用 Markdown 输出，至少包含：

## 核心人物
- 主要人物的目标、弱点、关系、长期变化方向。

## 人物关系
- 核心关系、冲突关系、隐藏关系和后续可推进点。

## 世界规则
- 题材相关的硬规则、限制、代价、社会结构或势力格局。

## 主线与支线
- 主线目标。
- 至少 3 条长期伏笔或支线。

## 风格约束
- 叙事语气、节奏、禁忌写法、人物对白边界。

要求：
- 内容要能被后续章节生成反复引用。
- 不要写成章节正文。
- 不要输出 JSON。`,
  };
}

function buildArchitecturePrompt(input: PromptBuildInput): BuiltPrompt {
return {
    purpose: 'architecture',
    expectedFormat: 'JSON matching ArchitecturePayloadSchema',
    prompt: `你是一名长篇小说总架构师。请生成全本、卷、章三级架构。

## 用户提示词
${input.state.initialPrompt}

## 目标
- 本次至少生成 ${input.state.targetChapters} 个章架构。
- 全本架构负责长期主线和结局方向。
- 卷架构负责阶段冲突、高潮和卷尾钩子。
- 章架构必须只覆盖本章应发生的内容，不要提前泄露后续具体事件。

${input.context ? `## 已有上下文\n${input.context}\n` : ''}## 输出要求
请只输出合法 JSON，格式如下：
{
  "full": "完整全书主线、阶段推进、核心冲突、主题和结局方向",
  "volumes": [
    {
      "id": "v1",
      "title": "卷标题",
      "summary": "本卷目标、冲突、高潮和卷尾钩子",
      "order": 1
    }
  ],
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "章标题",
      "volumeId": "v1",
      "summary": "本章剧情摘要",
      "requiredBeats": ["必须完成的情节点1", "必须完成的情节点2"]
    }
  ]
}

要求：
- chapters.length 必须大于等于 ${input.state.targetChapters}。
- chapterNumber 从 1 开始连续递增。
- volumeId 必须引用 volumes 中存在的 id。
- requiredBeats 至少 1 条，且必须具体可执行。
${strictJsonOutputRules()}`,
  };
}

function buildChapterPrompt(input: PromptBuildInput): BuiltPrompt {
return {
    purpose: 'chapter',
    expectedFormat: 'Markdown',
    prompt: `你是一位擅长创作长篇网络小说的职业作者。请直接完成第 ${input.state.currentChapter} 章正文。

## 执行优先级
1. 先严格遵守“本章架构、用户补充要求、故事圣经硬约束、上一章承接”。
2. 再参考“历史相关记忆、历史原文证据”保证一致性。
3. 最后才参考“全本/本卷远场规划”，且不得提前写出尚未发生的情节。

## 风格与字数
- 文风必须与本书题材、世界观、人物身份、情感基调一致。
- 语言要自然、稳定、可读，优先服务叙事推进、人物塑造和情绪积累。
- 对话必须符合人物身份、关系和处境；重要情绪尽量通过动作、神态、节奏、潜台词体现。
- 场景描写要有必要的感官细节与氛围支撑，但篇幅服务剧情，不要空转。
- 冲突、转折、悬念和章末钩子要清晰，保证阅读推进感。

## 执行规则
- 只写本章架构明确覆盖的内容，不得提前写后续章节具体事件或人物揭示。
- 不得新增本章架构未授权的主要人物；功能性角色只能轻描淡写。
- 所有人物称谓、物品、场景、能力、时间线必须与既有设定一致。
- 如果上一章结尾仍在动作、对话或同一场景中，本章开头必须连续衔接。
- 禁止无代价越级碾压、强行降智配角、突兀机械反转、硬灌设定、空洞抒情。
- 禁止总结腔、条目腔、说教腔，不要输出解释性前言。

${input.context ? `## 生成上下文\n${input.context}\n` : ''}## 输出要求
- 输出 Markdown。
- 第一行使用本章标题作为 H1，例如：# 章标题
- H1 后直接进入正文。`,
  };
}

function buildMemoryPrompt(input: PromptBuildInput): BuiltPrompt {
return {
    purpose: 'memory_card',
    expectedFormat: 'JSON matching MemoryCardSchema',
    prompt: `你是一名长篇小说连续性编辑。请从第 ${input.state.currentChapter} 章正文中提取记忆卡。

${input.context ? `## 当前章上下文\n${input.context}\n` : ''}## 输出要求
请只输出合法 JSON，格式如下：
{
  "summary": "本章摘要",
  "keyEvents": ["关键事件1"],
  "entities": [
    {
      "name": "人物/地点/物品/组织名称",
      "type": "person | location | item | faction | concept",
      "state": "本章结束时的状态"
    }
  ],
  "facts": [
    {
      "subject": "主体",
      "predicate": "关系或动作",
      "object": "客体"
    }
  ],
  "stateChanges": [
    {
      "entity": "实体",
      "before": "变化前",
      "after": "变化后"
    }
  ],
  "openThreads": ["尚未解决的伏笔、承诺、危险或疑问"]
}

要求：
- 只记录已经在本章发生或被确认的信息。
- 不要推测后续剧情。
- facts 和 stateChanges 要具体，便于后续章节引用。
${strictJsonOutputRules()}`,
  };
}

function buildContinuityReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const end = Math.max(input.state.targetChapters, input.state.currentChapter - 1);
return {
    purpose: 'continuity_review',
    expectedFormat: 'JSON matching ContinuityReviewSchema',
    prompt: `你是一名长篇小说连续性审稿人。请审阅第 1-${end} 章的连续性问题。

${input.context ? `## 审阅上下文\n${input.context}\n` : ''}## 审阅重点
- 人物状态、位置、伤势、关系是否前后矛盾。
- 物品归属、能力限制、世界规则是否被破坏。
- 伏笔是否被误解、遗漏或提前揭示。
- 章节架构要求是否被正文违反。

## 输出要求
请只输出合法 JSON，格式如下：
{
  "range": {
    "start": 1,
    "end": ${end}
  },
  "status": "clean",
  "issues": [
    {
      "severity": "low | medium | high",
      "description": "问题描述",
      "evidence": "来自上下文的证据",
      "suggestion": "修复建议"
    }
  ]
}

要求：
- 没有问题时 status 使用 "clean"，issues 输出空数组。
- 有问题时 status 使用 "issues_found"。
- evidence 必须具体，不能只写“疑似不一致”。
${strictJsonOutputRules()}`,
  };
}

function buildChapterReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const chapter = input.state.pendingAction?.chapterNumber ?? input.state.currentChapter;
return {
    purpose: 'chapter_review',
    expectedFormat: 'JSON matching ChapterReviewSchema',
    prompt: `你是一名严格的章节审稿编辑。请审阅指定章节是否存在内部问题以及与既有设定的冲突。

${input.context ? `## 审阅上下文\n${input.context}\n` : ''}## 审阅重点
- 人物声音、动机、状态是否符合故事圣经与历史记忆。
- 世界规则、物品归属、能力边界是否被破坏。
- 时间线、地点、与上一章结尾的衔接是否一致。
- 是否完成本章架构 requiredBeats。
- 文风：节奏、硬灌设定、突兀反转、空洞抒情、条目腔。

## 输出要求
请只输出合法 JSON，格式如下：
{
  "chapterNumber": ${chapter},
  "status": "clean",
  "issues": [
    {
      "severity": "low | medium | high",
      "category": "character | world | timeline | item | knowledge | pacing | style | architecture",
      "description": "具体问题",
      "evidence": "引用或转述能证明问题的具体段落",
      "suggestion": "具体修复建议"
    }
  ]
}

要求：
- 没有问题时 status 为 "clean"，issues 输出空数组。
- 有问题时 status 为 "issues_found"。
- evidence 必须具体，不能写"疑似"、"可能"。
${strictJsonOutputRules()}`,
  };
}

function buildChapterRevisionPrompt(input: PromptBuildInput): BuiltPrompt {
const chapter = input.state.pendingAction?.chapterNumber ?? input.state.currentChapter;
return {
    purpose: 'chapter_revision',
    expectedFormat: 'Markdown',
    prompt: `你是这本长篇小说第 ${chapter} 章的修订作者。请根据审稿反馈，产出修订后的完整章节正文。

## 优先级
1. 必须修复反馈中的每一条问题，不可遗漏。
2. 不要破坏已经能用的部分：结构、语气、人物声音、有效对白。
3. 保持与故事圣经、上一章承接、已有记忆的连续性。

## 风格规则
- 保持原章节的标题与 Markdown 结构。
- 不要输出条目化总结、变更日志、"我修改了什么"之类的解释文字。
- 不得新增本章架构未授权的主要人物或主线伏笔。

${input.context ? `## 修订上下文\n${input.context}\n` : ''}## 输出要求
- 仅输出 Markdown。
- 第一行使用本章标题作为 H1：\`# 章标题\`。
- H1 后直接输出修订后的完整正文，不要输出 diff 标记。`,
  };
}

function buildCrossChapterReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const range = input.state.pendingAction?.range ?? { start: 1, end: input.state.currentChapter - 1 };
return {
    purpose: 'cross_chapter_review',
    expectedFormat: 'JSON matching CrossChapterReviewSchema',
    prompt: `你是资深连续性编辑。请同时审阅第 ${range.start}-${range.end} 章，找出单章审阅无法发现的跨章节冲突。

${input.context ? `## 审阅上下文\n${input.context}\n` : ''}## 审阅重点
- 人物状态在多章之间漂移（例如伤势忽然消失）。
- 不同章节确认的事实互相冲突。
- 被悄悄遗忘或丢弃的伏笔。
- 后续章节破坏前面建立的世界规则。
- 只能跨章看到的节奏问题。

## 输出要求
请只输出合法 JSON，格式如下：
{
  "range": { "start": ${range.start}, "end": ${range.end} },
  "status": "clean",
  "issues": [
    {
      "severity": "low | medium | high",
      "chapters": [${range.start}, ${range.end}],
      "description": "具体问题",
      "evidence": "按章节引用冲突段落或记忆条目",
      "suggestion": "具体修复建议"
    }
  ]
}

要求：
- chapters 必须列出问题涉及的所有章节。
- evidence 必须引用具体章节内容或记忆，不能模糊。
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

export const zhCNPromptPack: PromptPack = {
  buildPromptForStep,
  strictJsonOutputRules,
};
