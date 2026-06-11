# NovelForge Agent

> **用你已有的 LLM,写出能读得通的百章长篇。**
> 不用 API key。不用月费。文件归你。模型你选。

[English README](README.md) · [npm](https://www.npmjs.com/package/novelforge-agent) · [GitHub](https://github.com/zlx362211854/novelforge-agent)

NovelForge 把 Claude Code(或任何 MCP 宿主)变成一个**有纪律的长篇小说协作者**。**你出 LLM,NovelForge 强制执行让 100 章真正能串起来的那套规则** —— 它不允许你的 AI 悄悄忘记自己之前定下的设定。

---

## 为什么需要 NovelForge?

AI 辅助写长篇的难点从来不是写第 1 章 —— 是让第 73 章还相信第 12 章建立的设定。模型会漂移。AI 文痕会堆积。伏笔会被遗忘。修真境界写到一半莫名变了。

| 写长篇时一定会崩的事 | NovelForge 的做法 |
|---|---|
| 写到第 30 章,主角能力前后矛盾 | **独立角色状态表** —— 每章必须查阅并遵守,不能违反任何字段 |
| 第 12 章 AI 就把故事圣经忘了 | 圣经**注入每章 prompt** + **BM25 检索**返回相关历史片段 |
| AI 老用"不是X而是Y"、"这一刻"、破折号狂魔 | **15 条 AI 文痕清单 + 硬上限**;审稿门超标自动驳回 |
| 伏笔埋了就再也不回收 | **伏笔生命周期跟踪**(埋→推进→回收/放弃);活跃伏笔注入每章 prompt |
| 让 AI 修改但它写出来还是老样子 | **强制章节验收门** —— `chapter_review` 必须 clean 才能进下一章;有问题则强制 `chapter_revision`,3 轮不通过才允许人工放行 |
| 写到第 5 章风格就跑偏 | 自动生成的**风格圣经**(语气/节奏/用词/句式韵律)每章强制执行 |
| 30 章之后卷的结构变成一团泥 | **卷级节奏板**(承诺/中点/高潮/payoff/遗留悬念);章节会被告知自己在 beat 的哪个位置 |
| 不记得某条支线推进到哪儿了 | 内置 **BM25 检索** —— `retrieve("昆吾剑")` 立刻看到所有涉及那条线的章节和记忆卡 |
| 长 context 费钱 | **可缓存的 prompt 分段** + 每步 **`modelHint`**(memory 用 Haiku、正文用 Opus)。约省 30-50% token |
| 百章大纲根本规划不出来 | **动态架构续规划** —— 一次只规划 5 章,写到边界自动提示下一批,不必一次想完全书 |

---

## 你能拿到什么

### 🎯 带门控的工作流
每章必须通过 **8 维验收门**(必要 beats、主线推进、人物推进、伏笔推进、故事圣经一致性、句式韵律、章末钩子、重复检查)才能进入下一章。不通过 → 强制修订。3 轮上限,然后人工放行。

### 📚 跟着项目走的领域知识
- **故事圣经**(Markdown)—— 写到一半可以改,旧版自动归档
- **风格圣经**(JSON,含句式韵律反模式清单)
- **每卷的节奏板** —— 起点 / 承诺 / 关键转折 / 中点 / 高潮 / 计划回收的伏笔
- **角色状态表** —— 境界、目标、信念、秘密、关系 —— 每章记忆卡自动同步更新

### 🧵 伏笔生命周期跟踪
每章必须声明自己 plant/build/pay/drop 了哪些伏笔。Agent 维护活跃伏笔列表,**注入下一章 prompt** —— 这样 AI **物理上无法悄悄删除你的支线**。

### 🔍 本地 BM25 检索(无 embedding,无 API)
跨所有章节、圣经段落、记忆卡搜索任何关键词。**中文双字分词器**(unigram + bigram + 拉丁字符)。既被自动使用(每章 prompt 注入相关历史片段),也开放 `retrieve` 工具按需调用。

### 🚫 AI 文痕防御
15 条 LLM 文痕被列入清单 —— **"不是X而是Y"**、"在这一刻"、单句段链、括号内心独白段、破折号滥用、感官三连、段尾顿悟句、比喻堆砌、总分总收束、主语重复、反问腔、对白破折号切片等。章节生成 prompt 显式禁用,审稿 prompt 逐条计数,超标必修。

### 💾 项目就是一个目录
所有内容都是纯文本 + JSON,放在一个文件夹里。**拷走、邮件发、明天再回来继续。** 不依赖任何云端。

### 🛟 出问题时的逃生口
- `fork_project` —— 试不同的第 5 章走向,不丢原版
- `delete_chapter` —— 干净删除,索引也清
- `redo_step` —— 回退到某个 step 重做
- `force_advance` —— 卡在 review 循环里时手动放行
- 所有章节修订自动归档旧版到 `chapters/.versions/`

### 💰 设计上就考虑了成本
- 每步 `modelHint: 'cheap' | 'standard' | 'premium'` —— 宿主可以让 memory_card 跑 Haiku、正文跑 Opus
- **可缓存的 prompt 分段** —— 章节规则段(约 5K token)每章字节级一致,Anthropic prompt cache 每 5 分钟付一次而不是每章一次

---

## 和其他工具比

| | **NovelForge** | Sudowrite / NovelCrafter | LangChain 小说脚本 | 直接用 Claude / ChatGPT |
|---|---|---|---|---|
| 文件归你 | ✅ | ❌ SaaS | 看实现 | ❌ |
| 自带 LLM | ✅ | ❌ 用他家的 | ❌ 要你的 key | ✅ |
| 不用订阅 | ✅ | ❌ $20+/月 | ✅ 只付 token 钱 | ✅ 但没结构 |
| 百章连贯性 | ✅ 结构化 | ⚠️ 尽力 | ❌ | ❌ |
| AI 文痕强制管控 | ✅ 15 条 + 审计 | ⚠️ | ❌ | ❌ |
| 直接在你的 MCP 宿主里跑 | ✅ 原生 | ❌ | ❌ | ❌ |
| 自由切换模型(Sonnet/Opus/Haiku/Gemini/GPT) | ✅ | ❌ | ⚠️ 要改代码 | ✅ |
| 开源 | ✅ MIT | ❌ | ✅ | — |

---

## 30 秒安装

装了 **Claude Code** 就跟它说:

> "安装 novelforge-agent"

它会跑 install 命令、注册 MCP server,然后让你重启。或者自己跑:

```bash
npx -y novelforge-agent install
```

然后 **Cmd+Q 退出 Claude Code,重开**。试试:

> "开一个新小说项目,赛博修真题材,30 章"

Claude 会自动发现工具,把整个工作流跑完。

### 其他宿主

```bash
npx -y novelforge-agent install --host claude-code   # 默认
npx -y novelforge-agent install --host codex         # 写入 ~/.codex/config.toml
npx -y novelforge-agent install --host cursor        # 打印 JSON 配置片段
npx -y novelforge-agent install --workspace ~/novels # 自定义工作区
npx -y novelforge-agent install --print-only         # 不改任何配置文件,只打印
```

任何支持 stdio MCP server 的宿主都能用 —— 把打印的 JSON 片段粘贴到 Cline、Continue、LibreChat、Goose、Zed、VS Code MCP 扩展里。

---

## 写一章实际发生了什么

```
你说: "继续写下一章"
  │
  ▼
Claude → get_project_status      (知道你写到哪)
Claude → get_next_step           (拿到第 N 章的 prompt)
        │
        │  Prompt 里附带:
        │   • 故事圣经(截 4K 字)
        │   • 当前角色状态
        │   • 卷级 beat 位置("rising_action,中点在第 12 章")
        │   • 活跃伏笔列表
        │   • BM25 检索到的相关历史片段
        │   • 风格圣经(含句式韵律反模式)
        │   • 15 条 AI 文痕禁忌
        │   • 字数目标(~3000 字 ±20%)
        ▼
Claude 生成章节 → save_chapter
  │
  ▼
chapter_review(自动门,8 维度审计)
  │
  ├── clean? ─────────► memory_card → 自动更新伏笔 & 角色表 → 下一章
  │
  └── issues_found? ──► chapter_revision(旧版自动归档)
                          │
                          └─► 回到 chapter_review
                              (3 轮上限,超限触发 force_advance + 审计记录)
```

**每章背后是多次 LLM 调用**,但你只说了一句话。**纪律对你不可见,对模型不可绕过。**

---

## 这个工具适合谁

**你会喜欢,如果你是**:
- 个人作者 / 网文写手,想要 AI 帮忙但**不放弃文件控制权**
- 已经在用 Claude Code / Codex / Cursor,不想再装一堆工具
- 受够了"Sudowrite 类工具长得都一样" —— 你想自己选模型
- 在写 10 万字以上,第 50 章必须记得第 5 章发生了什么

**别选 NovelForge,如果**:
- 你想要一个带时间线、剧情板、可视化大纲的 web 工具(去用 Plottr / Scrivener + Sudowrite)
- 你只写 3 页短篇(Claude 单独用就够了)
- 你没装 MCP 宿主也不想装(这不是独立 web app)

---

## 工具清单(26 个,按类别折叠)

<details>
<summary><strong>项目生命周期 & 状态(4 个)</strong></summary>

- `start_novel_project` —— 创建新项目,返回第一步指令
- `list_projects` —— 列出所有项目(最新优先)
- `get_project_status` —— 一屏摘要
- `get_next_step` —— 返回下一步的 prompt + 打包好的 context
</details>

<details>
<summary><strong>工作流(3 个)</strong></summary>

- `submit_step_result` —— 提交当前步骤的产物(zod schema 校验)
- `get_context` —— 按用途构造 context,不改变状态
- `save_chapter` —— 通过工作流门提交章节(自动进入 chapter_review)
</details>

<details>
<summary><strong>语义化动作(5 个)</strong></summary>

- `generate_chapter` —— 返回某章的生成 context
- `extract_memory_card` —— 返回某章的记忆卡提取 context
- `review_chapter` —— 单章审稿 side-track
- `revise_chapter` —— 修订某章(自动归档旧版)
- `cross_chapter_review` —— 跨章节连续性审计
</details>

<details>
<summary><strong>领域知识编辑(5 个)</strong></summary>

- `amend_novel_metadata` —— 更新标题/题材/人物(改 title 时自动重命名项目目录)
- `amend_story_bible` —— 替换圣经,归档旧版,重建索引
- `list_bible_versions` —— 列出历史圣经版本
- `list_threads` / `update_thread` —— 读写伏笔跟踪器
</details>

<details>
<summary><strong>检索(1 个)</strong></summary>

- `retrieve` —— BM25 检索章节 / 圣经 / 记忆卡,支持中文
</details>

<details>
<summary><strong>逃生口(5 个)</strong></summary>

- `fork_project` —— 把项目复制成新分支
- `delete_chapter` —— 删除章节 + memory + reviews + 索引
- `redo_step` —— 回退到某个 step 重做
- `force_advance` —— 卡在 review/revision 循环时手动放行
</details>

<details>
<summary><strong>可观测性(4 个)</strong></summary>

- `get_recent_events` —— 最近的审计事件
- `list_runs` —— 按 runId 分组的工具调用历史
- `get_run_log` —— 一次工具调用的完整事件
- `get_artifact_summary` —— 不暴露内容的情况下返回文件 sha256 + 大小 + 修改时间
</details>

所有工具默认返回 Markdown 摘要;传 `verbose: true` 同时附带原始 JSON 数据。工作流工具的 instruction / context 预览受边界限制,完整 payload 写入 `.agent-recovery/mcp-context/`。

---

## 工作流是怎么走的

```
novel_metadata → story_bible → style_guide → architecture → chapter
                                                            ↓
                                                       chapter_review
                                                       ┌────┴────┐
                                                    clean    issues_found
                                                       ↓          ↓
                                                memory_card  chapter_revision
                                                       ↓          ↓
                                ┌─────────────────────┐    回到 chapter_review
                          下一章已规划         所有章节写完
                              ↓                    ↓
                           chapter           continuity_review
                            (循环)                  ↓
                              ↑                  complete
                              │
                              │
                    architecture_extension
                    (规划 < 全本目标时自动触发)
```

`chapter_review` **既是线性流程里的自动门**,也是**任何时候都能手动触发的 side-track**。`chapter_review` / `chapter_revision` / `cross_chapter_review` 这三种 side-track 完成后,自动回到触发前的 step。

转移表写在 [src/core/steps/](src/core/steps/) 各个 handler 的 `next:` 字段 + [src/core/workflow.ts](src/core/workflow.ts) 的 dispatcher 里。没有外部 graph 引擎。

---

## 项目目录长什么样

```
novels/<title-slug>-<rand6>/
├── agent-state.json              # 当前 step、files 映射、修订计数
├── novel.json                    # 标题 / 题材 / premise / 人物
├── characters.json               # 独立角色状态表
├── story-bible.md
├── style-guide.json              # 语气 / 节奏 / 用词 / proseRhythm
├── architecture/
│   ├── full.md
│   ├── volumes.json
│   ├── volume-pacing.json
│   └── chapters.json
├── chapters/
│   ├── 001.md
│   └── .versions/                # 修订前的章节快照
├── memory/
│   └── chapter-001.json
├── threads.json                  # 伏笔跟踪器
├── reviews/
│   ├── chapter/chapter-NNN.json
│   ├── cross/cross-S-E.json
│   └── continuity-1-N.json
├── .index/                       # BM25(MiniSearch)
├── .agent-logs/events.jsonl      # 审计日志
└── .agent-recovery/              # 被拒提交 + 超大 context 溢出
```

**整个目录自包含** —— `cp -r` 拷到 U 盘、丢 Dropbox 同步、commit 到 git。没有外部状态。

---

## 直接在 shell 里用(不需要 MCP 宿主)

同一个引擎也能跑纯 CLI:

```bash
# 新建项目
novelforge-agent start --prompt "写一本赛博修仙小说" --length medium --chapters 5

# 查看 / 继续
novelforge-agent list
novelforge-agent status novels/<slug>
novelforge-agent next novels/<slug>

# 提交自己写的章节(或任何 LLM 生成的)
novelforge-agent submit novels/<slug> --step chapter --file ch1.md

# 审稿 / 修订 / 检索 / 跨章审计 —— 和 MCP 工具一一对应
novelforge-agent review novels/<slug> --chapter 3
novelforge-agent revise novels/<slug> --chapter 3 --feedback "让节奏更紧"
novelforge-agent retrieve novels/<slug> --query "昆吾剑" --top-k 8
novelforge-agent cross-review novels/<slug> --start 1 --end 5
```

默认输出 Markdown。脚本用 `--json` 取机器可读输出。

---

## 给宿主的成本优化接口

每个 step instruction 都带两个字段,宿主可以用它们大幅省 token。

### `modelHint`

```ts
type ModelHint = 'cheap' | 'standard' | 'premium';
```

| Step | 等级 | 理由 |
|---|---|---|
| `chapter` / `chapter_revision` / `story_bible` / `architecture` / `architecture_extension` | `premium` | 创意写作 |
| `style_guide` / `chapter_review` / `*_amend` / `cross_chapter_review` / `continuity_review` | `standard` | 分析 / 结构化输出 |
| `memory_card` / `complete` | `cheap` | 抽取 / 平凡操作 |

### `segments[]` —— prompt caching

每个 step instruction 拆成 `cacheable: true/false` 的几段。chapter 生成的 `rules` 段(约 5K token)**每章字节级一致**。Anthropic 风格 `cache_control: { type: 'ephemeral' }` 能让 30 章长篇省约 30% 输入开销。

---

## 工作区 & 路径安全

NovelForge 默认对"项目落地位置"是**宽松的**:只拒绝写入已知的**系统目录**(POSIX 的 `/etc`、`/usr`、`/bin`、`/sbin`、`/boot`、`/dev`、`/proc`、`/sys`、`/root`、`/System`、`/Library`、`/Applications`;Windows 的 `%SystemRoot%`、`%ProgramFiles%`、`%ProgramFiles(x86)%`、`%ProgramData%`)。**其他任何路径都接受** —— 包括 home 下、外接硬盘、应用特定的会话目录(如 `~/Library/Application Support/...`)、Windows 的其他盘符(如 `D:\novels`)。

正是这个默认行为,让"每个会话有独立工作目录"的 host(WorkBuddy、VS Code workspace、各种 AI 编辑器)**不需要额外配置就能直接用**。host 想往哪写,NovelForge 就往哪写。

### 严格模式(opt-in)

如果是多租户服务器、共享机器、或者偏执场景,在 MCP server 的环境变量里设 `NOVELFORGE_STRICT_WORKSPACE=1`。NovelForge 会**额外**要求所有路径必须在 `NOVELFORGE_WORKSPACE` 内:

```bash
# 锁定在 ~/novelforge,所有工具调用必须在范围内
NOVELFORGE_STRICT_WORKSPACE=1 \
NOVELFORGE_WORKSPACE=$HOME/novelforge \
novelforge-agent-mcp
```

即使在严格模式下,系统目录仍然无条件被拦(即使有人误把 `NOVELFORGE_WORKSPACE=/` 配偏了,`/etc/...` 也不会被放行)。

## 设计哲学

**这个系统里唯一动脑子的是宿主的 LLM。** NovelForge 是一个 runtime,它知道:

- 工作的**顺序**(状态机)
- 每个产物的**形状**(zod schema)
- 领域的**词汇**(prompts + rules)

…然后拒绝让宿主保存任何违反规则的内容。

我们刻意选了这条路,而不是更常见的"MCP server 内置 LLM"模式,原因:

- **你的数据,你的模型**:NovelForge 内部没有任何 API key,没有厂商锁定
- **成本透明**:token 走宿主账单,中间没有藏起来的中间商
- **模型自由**:从 Sonnet 换 Opus,换 Haiku,换 Gemini,换本地 Llama —— agent 不动
- **宿主无关**:今天 Claude Code,明天 Cursor,后天某个新 MCP 宿主 —— agent 不在乎

代价是:NovelForge **没有 MCP 宿主就没法用**,也不是一个独立的"AI 小说生成器" web app。它是**你已经在用的 LLM 下面的纪律层**。

---

## 架构

```
src/
├── core/                          # 纯领域逻辑,无 transport
│   ├── types.ts                   # AgentState、WorkflowStep、MemoryCard、…
│   ├── schemas.ts                 # zod schemas(唯一的校验器)
│   ├── projectStore.ts            # 文件系统持久化
│   ├── characterStore.ts          # 角色状态表
│   ├── threadStore.ts             # 伏笔生命周期
│   ├── prompts/                   # 按语言的 prompt 包(zh-CN、en-US)
│   ├── steps/                     # 一个 step 一个 handler 文件
│   ├── retrieval/                 # BM25 索引 + CJK 分词
│   ├── contextBuilder.ts          # 按用途打包 context
│   └── workflow.ts                # dispatcher: 状态机 + side-track
├── mcp/
│   ├── server.ts                  # stdio MCP 入口
│   └── tools.ts                   # 26 个 MCP 工具 + 10 个 MCP prompt
└── cli/
    └── index.ts                   # 等价的 CLI 子命令
```

Agent 零 LLM 依赖:

```bash
$ grep -RIl "anthropic\|openai\|@google" src package.json
# (无结果 —— 只有 @modelcontextprotocol/sdk、zod、minisearch)
```

---

## 从源码安装 / 贡献

```bash
git clone https://github.com/zlx362211854/novelforge-agent.git
cd novelforge-agent
npm install
npm run build
npm test            # 89 个单元 + 集成测试
npm run test:e2e    # 15 步 CLI 端到端 smoke(不需要 LLM)
```

加新 step 的步骤:

1. 在 [src/core/types.ts](src/core/types.ts) 的 `WorkflowStep` 加 step 名
2. 在 [src/core/schemas.ts](src/core/schemas.ts) 加 zod schema
3. 在 [src/core/prompts/zh-CN.ts](src/core/prompts/zh-CN.ts) 和 [en-US.ts](src/core/prompts/en-US.ts) 加 prompt builder
4. 在 `src/core/steps/<name>.ts` 写 handler
5. 在 [src/core/steps/index.ts](src/core/steps/index.ts) 注册
6. 如果需要打包 context,在 [src/core/workflow.ts](src/core/workflow.ts) 的 `CONTEXT_RECIPES` 里加一行
7. 在 [src/mcp/tools.ts](src/mcp/tools.ts) 的 `submit_step_result` 的 `step` enum 加它

---

## Anthropic API 直接调用示例

```ts
import Anthropic from '@anthropic-ai/sdk';

// 从 NovelForge 拿 step 的 segments + modelHint
const next = await getNextStepViaMcp(projectPath);
const rules = next.segments.find((s) => s.id === 'rules');
const meta  = next.segments.find((s) => s.id === 'chapter_meta');
const ctx   = next.segments.find((s) => s.id === 'context');

const anthropic = new Anthropic();
const model = ({ cheap: 'claude-haiku-4-5', standard: 'claude-sonnet-4-7', premium: 'claude-opus-4-7' })[next.modelHint];

const reply = await anthropic.messages.create({
  model,
  max_tokens: 8000,
  system: [{ type: 'text', text: rules.text, cache_control: { type: 'ephemeral' } }],
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: meta.text },
      { type: 'text', text: ctx.text },
    ],
  }],
});

await submitStepResult(projectPath, next.currentStep, reply.content[0].text);
```

---

## License

MIT。详见 [LICENSE](LICENSE)。
