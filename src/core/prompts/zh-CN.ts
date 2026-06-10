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

function buildStyleGuidePrompt(input: PromptBuildInput): BuiltPrompt {
return {
    purpose: 'style_guide',
    expectedFormat: 'JSON matching StyleGuideSchema',
    prompt: `你是一名长篇小说文风主编。请根据用户提示、metadata 和故事圣经，生成可被每章写作与审稿长期执行的风格圣经。

## 用户提示词
${input.state.initialPrompt}

${input.context ? `## 已有上下文\n${input.context}\n` : ''}## 输出要求
请只输出合法 JSON，格式如下：
{
  "narrativeVoice": "叙事人称、视角距离、旁白气质、情绪温度",
  "pacing": "开章、转场、冲突推进、章末钩子的节奏规则",
  "diction": "词汇选择、句式密度、题材术语使用边界",
  "dialogueRules": [
    "核心人物对白的长度、语气、潜台词、称谓规则"
  ],
  "prohibitedPatterns": [
    "禁止出现的现代梗、解释型旁白、设定堆砌、口吻漂移等"
  ],
  "proseRhythm": {
    "sentenceRhythm": "短句、中句、长句的使用原则；短句应服务转折、危险、情绪落点，而不是默认叙述单位",
    "paragraphing": "段落应形成完整叙事单元；避免连续单句成段、靠频繁换行制造伪节奏",
    "interiorityMode": "心理活动如何通过动作、迟疑、感官反应折射；避免频繁直接解释人物想法",
    "emphasisBudget": "重复句、破折号、孤立短句等强调资源的使用预算",
    "antiPatterns": [
      "连续 3 个以上单句短段",
      "用大量短句模拟紧张感",
      "每个动作后立刻解释心理",
      "重复同一句式制造伪节奏"
    ]
  },
  "sampleParagraph": "一段 120-250 字的目标风格示例，不要写成剧情大纲",
  "consistencyChecks": [
    "后续章节审稿时用于判断风格是否跑偏的具体检查项"
  ]
}

要求：
- 风格必须匹配 genre、premise、人物身份和目标读者预期。
- 不要只写抽象形容词；每个字段都要能指导实际行文。
- proseRhythm 不要写成固定字数规则；要描述可审稿的节奏原则和反模式。
- sampleParagraph 只展示语言质感，不要提前泄露后续剧情。
- prohibitedPatterns 至少 3 条，consistencyChecks 至少 3 条。
- proseRhythm.antiPatterns 至少 4 条。
${strictJsonOutputRules()}`,
  };
}

function buildArchitecturePrompt(input: PromptBuildInput): BuiltPrompt {
const isOpenEnded = input.state.lengthPreset === 'long';
const wholeBookTarget = isOpenEnded
  ? '开放式长篇，不设固定终章；当前只做长期方向和首批阶段规划'
  : `约 ${input.state.plannedTotalChapters ?? input.state.targetChapters} 章`;
const fullFieldDescription = isOpenEnded
  ? '开放式长篇的宏观方向、当前大篇/当前卷目标、核心冲突和长期悬念；不要写固定终局或全书所有卷'
  : '完整全书主线、阶段推进、核心冲突、主题和结局方向';
const volumeRule = isOpenEnded
  ? '- volumes 只输出当前大篇/当前卷以及必要的近期开篇卷；不要一次性规划全书所有卷。'
  : '- volumePacing 必须为每个 volume 提供节奏板。';
return {
    purpose: 'architecture',
    expectedFormat: 'JSON matching ArchitecturePayloadSchema',
    prompt: `你是一名长篇小说总架构师。请生成全本、卷、章三级架构。

## 用户提示词
${input.state.initialPrompt}

## 目标
- 全本目标：${wholeBookTarget}；本次只生成首批 ${input.state.targetChapters} 个章架构。
- ${isOpenEnded ? '宏观架构只负责长期方向、题材承诺、当前阶段目标和可持续冲突，不要固定最终结局。' : '全本架构负责长期主线和结局方向。'}
- 卷架构负责当前/近期阶段冲突、高潮和卷尾钩子。
- 章架构必须只覆盖本章应发生的内容，不要提前泄露后续具体事件。
- 不要一次性规划所有章节或所有卷；后续写到边界时会动态进入 architecture_extension。

${input.context ? `## 已有上下文\n${input.context}\n` : ''}## 输出要求
请只输出合法 JSON，格式如下：
{
  "full": "${fullFieldDescription}",
  "volumes": [
    {
      "id": "v1",
      "title": "卷标题",
      "summary": "本卷目标、冲突、高潮和卷尾钩子",
      "order": 1
    }
  ],
  "volumePacing": [
    {
      "volumeId": "v1",
      "start": "本卷起点：主角/世界/冲突处于什么状态",
      "promise": "本卷向读者承诺的核心看点或问题",
      "keyTurns": ["关键转折1", "关键转折2"],
      "midpoint": "本卷中点转折或认知变化",
      "climax": "本卷高潮",
      "payoffs": ["本卷计划回收的伏笔或承诺"],
      "lingeringMysteries": ["卷末仍要保留的悬念"]
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
- chapters 不需要一次覆盖全本；后续写到边界时会进入 architecture_extension 续规划。
- chapterNumber 从 1 开始连续递增。
- volumeId 必须引用 volumes 中存在的 id。
${volumeRule}
- requiredBeats 至少 1 条，且必须具体可执行。
${strictJsonOutputRules()}`,
  };
}

function buildArchitectureExtensionPrompt(input: PromptBuildInput): BuiltPrompt {
  const start = input.state.currentChapter;
  const total = input.state.plannedTotalChapters ?? input.state.targetChapters;
  const end = Math.min(total, start + input.state.targetChapters - 1);
  const isOpenEnded = input.state.lengthPreset === 'long';
  const totalLabel = isOpenEnded
    ? '开放式长篇，不设固定终章'
    : `到第 ${total} 章结束`;
  const maxChapterRule = isOpenEnded
    ? '- chapterNumber 必须连续递增。'
    : `- chapterNumber 必须连续递增，且不能超过 ${total}。`;
  const lengthRule = isOpenEnded
    ? `- chapters.length 建议为 ${end - start + 1}；这是下一批规划，不是全书规划。`
    : `- chapters.length 建议为 ${end - start + 1}，除非已经到全本结尾。`;
  return {
    purpose: 'architecture_extension',
    expectedFormat: 'JSON matching ArchitectureExtensionPayloadSchema',
    prompt: `你是一名长篇小说总架构师。当前已写到既有章纲边界，请基于已有内容续写后续章架构。

## 续规划范围
- 从第 ${start} 章开始。
- 本批最多规划到第 ${end} 章。
- 全本目标${totalLabel}。

## 续规划原则
- 不要改写已经存在的章节架构；只追加新的 chapter architecture。
- 新增章节必须承接最近记忆、角色状态表、活跃伏笔和卷级节奏板。
- 如果后续章节进入新卷，可以新增 volumes 和 volumePacing；如果仍在旧卷，可以补充/更新该卷节奏板。
- 如果全本方向因已写内容需要微调，可以输出 fullUpdate；fullUpdate 必须是可覆盖 architecture/full.md 的完整更新版，而不是变更说明。
- 章架构必须只覆盖本章应发生的内容，不要提前泄露更后面的具体事件。
- 不要一次性补出后续所有章节或所有卷；只规划本批章节和必要的近期卷/节奏板。
- 长篇节奏保护：非全本终章不要把“大真相揭示、核心伏笔回收、主角大幅升级、强反派正面对决、新地图开启”集中塞进同一章；除非是卷高潮，否则每章最多承载 1-2 个不可逆大转折。
- 如果一章看起来像季终集，请拆分到多章：先危机/发现，再代价/选择，再回收/转场。

${input.context ? `## 已有上下文\n${input.context}\n` : ''}## 输出要求
请只输出合法 JSON，格式如下：
{
  "fullUpdate": "可选：完整更新后的全本架构 Markdown/文本",
  "volumes": [
    {
      "id": "v2",
      "title": "新增或更新卷标题",
      "summary": "本卷目标、冲突、高潮和卷尾钩子",
      "order": 2
    }
  ],
  "volumePacing": [
    {
      "volumeId": "v2",
      "start": "本卷起点",
      "promise": "本卷承诺",
      "keyTurns": ["关键转折1", "关键转折2"],
      "midpoint": "中点转折",
      "climax": "本卷高潮",
      "payoffs": ["计划回收点"],
      "lingeringMysteries": ["遗留悬念"]
    }
  ],
  "chapters": [
    {
      "chapterNumber": ${start},
      "title": "章标题",
      "volumeId": "v1",
      "summary": "本章剧情摘要",
      "requiredBeats": ["必须完成的情节点1"]
    }
  ]
}

要求：
- chapters[0].chapterNumber 必须等于 ${start}。
${maxChapterRule}
${lengthRule}
- requiredBeats 至少 1 条，且必须具体可执行。
- volumeId 必须引用已有或本次新增 volumes 中存在的 id。
- 非终章如果同时包含重大真相、核心回收、连续升级、强战斗、新地图或最终反派升级，提交会被拒绝；请主动拆分节奏。
${strictJsonOutputRules()}`,
  };
}

function buildChapterPrompt(input: PromptBuildInput): BuiltPrompt {
  const ch = input.state.currentChapter;
  const isFirstChapter = ch <= 1;
  return {
    purpose: 'chapter',
    expectedFormat: 'Markdown',
    prompt: `你是一位擅长创作长篇网络小说的职业作者。请直接完成第 ${ch} 章正文。

## 执行优先级
1. 先严格遵守"本章架构、用户补充要求、故事圣经硬约束、风格圣经、上一章承接"。
2. 再参考"角色状态表、卷级节奏板、活跃伏笔、历史相关记忆、历史原文证据"保证一致性。
3. 最后才参考"全本/本卷远场规划"，且不得提前写出尚未发生的情节。

## 如何使用上下文中的关键数据段
- **Character State Table（角色状态表）**：上下文末尾会附 \`## Character State Table\`，里面是各角色当前的境界/位置/伤势/目标/信念/秘密/关系/情绪。**严禁本章违反任何字段**——例如表里写"陈青云：炼气三层"，本章就不许出现金丹境的描写。任何变化必须发生在本章正文里且后续 memory_card 中会记录。
- **Volume Pacing Board（卷级节奏板）**：上下文里会附 \`## Volume Pacing Board\`，里面是当前卷的承诺/中点/高潮/payoffs/lingeringMysteries。本章应符合所在 beat 位置：rising_action 段不要提前写 climax 内容，midpoint 才能写 midpoint 反转，volume close 才能回收本卷 payoffs。
- **Active Foreshadow Threads（活跃伏笔）**：本章可推进/回收/新埋，但不得"无声删除"。
- **Retrieved Relevant Snippets**：仅作为历史原文参考，不要重写其内容。

## 字数目标
- 默认目标 3000 字（±20%）。如果本章架构里指定了 targetWords，按那个目标。
- 不要为了凑字数注水；也不要为了简洁牺牲冲突推进。

## 结构要求
${isFirstChapter
  ? '- 这是第 1 章，不需要"上回提要"。开篇直接立人物、立情境。'
  : '- 章首需要 2-3 句"上回提要"或"承接段"，让没读上一章的读者能续上（除非本章架构 requireRecap=false）。要自然带入，不要写成"上一章里……"的元叙述。'}
- 章末必须有清晰的"钩子"：可以是悬念、反转、剧情承诺、情绪余韵或卷末高潮——按本章架构 endHookFocus 字段决定。如果未指定，默认用悬念。

## 风格
- 严格执行上下文中的 Style Guide；sampleParagraph 只作为语言质感参考，不要复写其内容。
- 严格执行 Style Guide.proseRhythm：短句、单句段、重复句、破折号是强调资源，不是默认叙述单位；常规叙述要形成自然句群。
- 文风必须与本书题材、世界观、人物身份、情感基调一致。
- 语言自然、稳定、可读，优先服务叙事推进、人物塑造和情绪积累。
- 对话符合人物身份、关系和处境；重要情绪通过动作、神态、节奏、潜台词体现。
- 场景描写有必要的感官细节与氛围支撑，但篇幅服务剧情。
- POV 严格按本章架构 povCharacter（如有），中途不切换视角。

## 执行规则
- 只写本章架构明确覆盖的内容，不得提前写后续章节具体事件或人物揭示。
- 不得新增本章架构未授权的主要人物；功能性角色轻描淡写。
- 所有人物称谓、物品、场景、能力、时间线必须与既有设定一致。
- 如果上一章结尾仍在动作、对话或同一场景中，本章开头必须连续衔接。
- 活跃伏笔列表中的条目本章可以"推进"或"回收"，但**不得无声无息地删除**——若选择不触碰也要让它仍然成立。
- 禁止无代价越级碾压、强行降智配角、突兀机械反转、硬灌设定、空洞抒情。
- 禁止总结腔、条目腔、说教腔，不要输出解释性前言或"我修改了什么"之类的元文本。

## AI 句式禁忌（每违反一次都会被审稿计为 high severity，直接进 chapter_revision）
- "**不是X，而是Y**" / "与其说X不如说Y"：整章最多 1 次，且必须是真正的反差。不要用它做心理过渡。
- "**这一刻 / 此刻 / 这一瞬间 / 就在此时**"：整章最多 1 次。不要每个情绪高点都用。
- **排比堆叠**：不要写"他看见A。他听见B。他闻到C。"这种感官三连。
- **形容词三连**：不要写"冰冷、坚硬、永恒"这种逗号串联三个形容词。
- **段尾顿悟句**：不要写"他终于明白"/"这就是答案"/"原来如此"/"真相只有一个"。顿悟用动作或留白。
- **解释型旁白**：动作之后不要立刻揭示心理（"他笑了笑，那笑容里藏着……"）。让动作自己说话。
- **总分总收束**："X。X的Y。Y的Z。最终Z就是W。"——不要写。
- **拽形容词**：不要堆"那种说不清的"/"那种近乎本能的"/"那种几乎刻进骨头里的"等空洞限定。
- **比喻堆砌**：同一段不要同时出现"仿佛"+"如同"+"就像"三个比喻词。
- **主语重复**：不要"陈青云。陈青云走过去。陈青云说。"——用代词或动作连续。
- **反问腔**：不要"难道不是吗 / 又何尝不是 / 谁能想到"这种 LLM 强行抒情结构。

${input.context ? `## 生成上下文\n${input.context}\n` : ''}## 输出要求
- 输出 Markdown。
- 第一行使用本章标题作为 H1，例如：# 章标题
- H1 后直接进入正文。

## 自我审查（输出前默念一遍）
扫一遍上面 11 条"AI 句式禁忌"。任何一条超标，**重写后再输出**，不要在输出里承认你重写过。`,
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
  "openThreads": ["尚未解决的伏笔、承诺、危险或疑问"],
  "wordCount": 本章实际字数（整数估算即可）,
  "threadActions": [
    {
      "kind": "plant | build | pay | drop",
      "threadId": "已有伏笔的 id（如果是 plant 留空让系统分配；build/pay/drop 必须填活跃伏笔列表里的 id）",
      "description": "新伏笔的描述（plant 时必填）或本章如何推进/回收/丢弃这条伏笔的一句话"
    }
  ],
  "characterUpdates": [
    {
      "name": "人物姓名",
      "role": "角色定位（如本章确认或改变）",
      "goal": "本章结束时的当前目标",
      "belief": "本章结束时影响其行动的核心认知/信念",
      "relationships": [
        { "name": "相关人物", "dynamic": "本章结束时的关系状态" }
      ],
      "abilities": ["本章结束时确认拥有的能力、资源或限制"],
      "secrets": ["本章结束时仍未公开或只被部分人知道的秘密"],
      "emotionalState": "本章结束时的情绪状态"
    }
  ]
}

要求：
- 只记录已经在本章发生或被确认的信息。
- 不要推测后续剧情。
- facts 和 stateChanges 要具体，便于后续章节引用。
- wordCount 用中文字符数（去掉空格和 Markdown 标记），近似估算即可。
- threadActions 是关键：
  · 任何"上下文里 Active Foreshadow Threads"列出的活跃伏笔，如果本章推进了，请发 kind="build"；如果本章正式回收/兑现，请发 kind="pay"；如果本章决定放弃，请发 kind="drop"。这三种情况 threadId 必填。
  · 本章新埋设的伏笔，请发 kind="plant"，description 写清楚是什么伏笔。
  · 活跃伏笔本章没动也没关系，不需要为它发动作；但**不要悄悄删除**——只要不发 drop，它就继续保留活跃。
- characterUpdates 用于维护独立角色状态表：只输出本章有明确变化或被重新确认的重要人物；目标、信念、关系、能力、秘密、情绪状态必须以本章结尾为准。
${strictJsonOutputRules()}`,
  };
}

function buildContinuityReviewPrompt(input: PromptBuildInput): BuiltPrompt {
const end = Math.max(input.state.plannedTotalChapters ?? input.state.targetChapters, input.state.currentChapter - 1);
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
- 这是强制章节验收门槛：只要任一验收项 fail，status 必须是 "issues_found"，不能进入下一章。
- 采取怀疑式审稿：不要为了推进流程而自证清白；只要存在可执行修复建议，就应该输出 issues_found。
- requiredBeats 是否全部完成；缺失项必须写入 acceptance.requiredBeats.missingBeats。
- 本章是否推进主线、人物状态或活跃伏笔；如果完全原地踏步，narrativeProgress/characterProgress/foreshadowProgress 至少一项必须 fail。
- 是否违反故事圣经、角色状态表、卷级节奏板或历史记忆。
- 是否违反 Style Guide：叙事声音、句式密度、题材词汇、对白规则和禁用模式。
- 是否违反 Style Guide.proseRhythm：短句密度过高、连续单句短段、靠换行制造伪节奏、心理解释过直白、重复同一句式。
- 是否出现明显 AI 文痕迹：反复使用“不是X，而是Y”、过多“像是”、解释性总结句、现代吐槽破坏题材沉浸、对话承担设定说明过重。

### proseRhythm 强制 AI 句式审计（必须逐条计数）
评估 proseRhythm 时**必须**数下面 11 种 AI 病句的出现次数。**任意一条超标**，proseRhythm.status 必须为 "fail"，并且在 issues 里写一条 category="style", severity="high"，evidence 必须引用原文片段。

| 编号 | 病句 | 整章上限 |
|------|------|---------|
| 1 | "不是X，而是Y" / "与其说X不如说Y" | 1 次 |
| 2 | "这一刻 / 此刻 / 这一瞬间 / 就在此时" | 1 次 |
| 3 | 感官排比三连："他看见A。他听见B。他闻到C。" | 0 次 |
| 4 | 形容词三连："冰冷、坚硬、永恒"风格的逗号串联 | 0 次 |
| 5 | 段尾顿悟句："他终于明白" / "这就是答案" / "原来如此" / "真相只有一个" | 0 次 |
| 6 | 解释型旁白：动作之后立刻揭示心理（"他笑了笑，那笑容里藏着……"） | 0 次 |
| 7 | 总分总收束："X。X的Y。Y的Z。最终Z就是W。" | 0 次 |
| 8 | 拽形容词："那种说不清的 / 那种近乎本能的 / 那种几乎刻进骨头里的" | 0 次 |
| 9 | 比喻堆砌：同一段同时出现"仿佛"+"如同"+"就像" | 0 次 |
| 10 | 主语重复："陈青云。陈青云走过去。陈青云说。" | 0 次 |
| 11 | 反问腔："难道不是吗 / 又何尝不是 / 谁能想到" | 0 次 |

evidence 字段里**必须列出**统计结果，例如："AI 句式审计：#1=2(超标，应≤1)，#5=1(超标，应=0)，其他=0"。
- 章末是否有清晰钩子，且符合本章 endHookFocus。
- 是否重复之前章节已经完成的桥段、冲突结构、信息揭示或对话功能。
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
  "acceptance": {
    "requiredBeats": {
      "status": "pass | fail",
      "evidence": "逐条说明 requiredBeats 完成证据",
      "missingBeats": []
    },
    "narrativeProgress": {
      "status": "pass | fail",
      "evidence": "本章如何推进主线/阶段目标"
    },
    "characterProgress": {
      "status": "pass | fail",
      "evidence": "本章如何改变或确认关键人物目标、信念、关系、能力、秘密或情绪"
    },
    "foreshadowProgress": {
      "status": "pass | fail",
      "evidence": "本章如何埋设、推进、回收或有意识保留伏笔"
    },
    "storyBibleConsistency": {
      "status": "pass | fail",
      "evidence": "是否符合故事圣经、角色状态表和世界规则"
    },
    "proseRhythm": {
      "status": "pass | fail",
      "evidence": "是否符合 Style Guide.proseRhythm；说明短句/单句段/重复句/心理解释是否被合理控制"
    },
    "endingHook": {
      "status": "pass | fail",
      "evidence": "章末钩子的具体段落和作用"
    },
    "repetition": {
      "status": "pass | fail",
      "evidence": "是否重复既有桥段；无重复也要说明依据"
    }
  },
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
- 只有所有 acceptance 项都是 "pass" 时，status 才能为 "clean"。
- status 为 "clean" 时 issues 必须为空；issues 非空时 status 必须为 "issues_found"。
- acceptance.requiredBeats.missingBeats 非空时 requiredBeats.status 必须为 "fail"。
- 任一 acceptance 项为 "fail" 时，必须在 issues 中写出对应问题与修复建议。
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
        prompt: `请基于当前已有故事圣经与本次反馈，输出"修订后的完整故事圣经 Markdown"。

${input.context ? `## 修订上下文\n${input.context}\n` : ''}## 输出要求
- 输出完整的 story-bible.md 内容，覆盖式替换旧版（旧版会自动归档到 story-bible-versions/）。
- 保留旧版仍然成立的内容，仅修改 / 新增 / 删除有明确依据的部分。
- 不要输出 diff、变更说明、bullet 总结，直接输出新 bible 全文。`,
      };
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
