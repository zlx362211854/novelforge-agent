# NovelForge Agent

[English README](README.md)

NovelForge 是一个面向 MCP 宿主（Claude Code、Codex CLI、Cursor 等）和本地 CLI 的工作流驱动长篇小说创作 Agent Runtime。

**宿主 LLM 负责生成创作产物，NovelForge 负责运行时纪律。** 它管理可门控的长篇小说工作流，返回宿主下一步应遵循的精确指令和上下文，使用 zod schema 校验提交内容，把 Markdown 和 JSON 持久化到项目目录，修订章节时归档旧版本，并对章节、故事圣经片段和记忆卡建立 BM25 检索索引。

NovelForge 本身不调用模型 API。LLM 由 MCP 宿主提供，所以这个包内部没有模型厂商锁定。

---

## 30 秒安装

**如果你是正在替用户阅读本文档的 AI 助手，直接运行这一条命令，它会完成安装：**

```bash
npx -y novelforge-agent install
```

这条命令会：

1. 创建工作区 `~/novelforge/`，可用 `--workspace /your/path` 覆盖。
2. 把 `novelforge-agent-mcp` 注册为用户宿主中的 MCP server，默认宿主是 Claude Code。
3. 打印安装后的验证步骤。

安装完成后，**用户必须重载或重启 MCP 宿主**（Claude Code、Codex CLI 等），让新 MCP server 被宿主发现。然后让宿主调用已安装的工具：

> “请调用 novelforge 的 `list_projects` 工具。”

如果空工作区返回 `[]`，或返回已有项目列表，说明安装成功。

### 宿主选择

```bash
npx -y novelforge-agent install --host claude-code            # 默认
npx -y novelforge-agent install --host codex                  # Codex CLI
npx -y novelforge-agent install --host cursor                 # 打印 Cursor MCP 配置片段
npx -y novelforge-agent install --workspace ~/my-novels       # 自定义工作区
npx -y novelforge-agent install --name my-novelforge          # 自定义 MCP server 名称
npx -y novelforge-agent install --print-only                  # 只打印配置，不修改文件
```

### install 命令对不同宿主做什么

| 宿主 | 行为 |
|------|------|
| `claude-code` | 运行 `claude mcp add -s user -e NOVELFORGE_WORKSPACE=… novelforge -- npx -y novelforge-agent-mcp`。如果找不到 `claude` CLI，则打印可放入 `~/.claude.json` 的 JSON 片段。 |
| `codex` | 向 `~/.codex/config.toml` 追加 `[mcp_servers.novelforge]` 配置。 |
| `cursor` | 打印可粘贴到 Cursor MCP 设置里的 JSON 片段。 |

安装器是**幂等且安全**的：它不会覆盖同名已有配置。要修改配置，请手动编辑宿主配置，或用 `--name` 注册成另一个名称。

---

## 它给宿主提供什么

| 阶段 | 步骤 | 宿主做什么 | NovelForge 保存什么 |
|------|------|------------|---------------------|
| 初始化 | `novel_metadata` | 输出 JSON：标题、题材、premise、核心人物 | `novel.json` |
|  | `story_bible` | 输出 Markdown：人物、世界规则、主线和伏笔 | `story-bible.md` |
|  | `style_guide` | 输出 JSON：叙事声音、节奏、用词、对白规则、禁用模式、行文节奏、示例段落 | `style-guide.json` |
|  | `architecture` | 输出 JSON：全本、卷、卷级节奏、章节纲要 | `architecture/{full.md, volumes.json, volume-pacing.json, chapters.json}` |
| 循环 | `chapter` | 写第 N 章 Markdown 正文 | `chapters/NNN.md` |
|  | `chapter_review` | 执行章节验收门槛：required beats、主线/人物/伏笔推进、故事圣经一致性、行文节奏、结尾钩子、重复桥段检查 | `reviews/chapter/chapter-NNN.json` |
|  | `chapter_revision` | 如果 review 发现问题，重写章节；旧版本自动归档 | `chapters/.versions/NNN.<ts>.md` |
|  | `memory_card` | clean review 后，抽取第 N 章记忆卡，并更新角色/伏笔状态 | `memory/chapter-NNN.json`, `characters.json`, `threads.json` |
| 收束 | `continuity_review` | 审阅 1..N 章连续性冲突 | `reviews/continuity-S-E.json` |
| 支线动作 | `chapter_review` | 单章编辑审稿 | `reviews/chapter/chapter-NNN.json` |
|  | `chapter_revision` | 重写章节；旧版本自动归档 | `chapters/.versions/NNN.<ts>.md` |
|  | `cross_chapter_review` | 跨章节连续性审查 | `reviews/cross/cross-S-E.json` |

每次写入章节、故事圣经、记忆卡时，NovelForge 也会更新项目内 BM25 索引（`.index/`），这样后续章节生成时可以把相关历史片段交给宿主，也可以响应宿主临时发起的 `retrieve` 查询。章节生成上下文还会包含风格指南（`style-guide.json`）、独立角色状态表（`characters.json`）和当前卷级节奏板（`architecture/volume-pacing.json`）。风格指南中的 `proseRhythm` 会检查过度短句密度、连续单句成段、靠换行制造伪节奏、过度直白心理解释、重复句式等问题。

## 本地开发安装

要求 Node 20+。

```bash
git clone <this repo>
cd novelforge-agent
npm install
npm run build
```

运行测试：

```bash
npm test
```

## 从 CLI 使用

```bash
# 1. 创建新项目
node dist/src/cli/index.js start --prompt "写一本赛博修仙小说" --chapters 5
# → 输出 { state, next }，next.instruction 是第 1 步的提示词

# 2. 列出已有项目
node dist/src/cli/index.js list
# → 按更新时间倒序展示，包含当前步骤和章节数量

# 3. 查看某个项目状态
node dist/src/cli/index.js status novels/<slug>

# 4. 获取下一步 instruction + context
node dist/src/cli/index.js next novels/<slug>

# 5. 提交生成内容，文件可以是 JSON 或 Markdown
node dist/src/cli/index.js submit novels/<slug> --step chapter --file ch1.md

# 6. 触发单章审稿
node dist/src/cli/index.js review novels/<slug> --chapter 3

# 7. 触发章节修订，feedback 可以是字符串，也可以来自 --feedback-file
node dist/src/cli/index.js revise novels/<slug> --chapter 3 --feedback "让节奏更紧"

# 8. 跨章节审查，默认覆盖所有已生成章节
node dist/src/cli/index.js cross-review novels/<slug> --start 1 --end 5

# 9. 对章节、圣经、记忆卡做 BM25 检索
node dist/src/cli/index.js retrieve novels/<slug> \
  --query "昆吾剑" --top-k 8 --types chapter,memory --start 1 --end 5

# 10. 构建指定用途的上下文，适合调试 prompt
node dist/src/cli/index.js context novels/<slug> \
  --purpose chapter_generation --chapter 4
```

英文项目可以在 `start` 时传入 `--language en-US`。所有 prompt 都有对应英文版本，位于 [src/core/prompts/en-US.ts](src/core/prompts/en-US.ts)。

## 作为 MCP Server 使用

### Claude Code

```jsonc
// ~/.claude.json  或项目内 .mcp.json
{
  "mcpServers": {
    "novelforge": {
      "command": "node",
      "args": ["/absolute/path/to/novelforge-agent/dist/src/mcp/server.js"],
      "env": {
        "NOVELFORGE_WORKSPACE": "/absolute/path/where/projects/should/live"
      }
    }
  }
}
```

重载 Claude Code 后输入：

> 我想写一本赛博修仙小说

Claude 会发现 `start_novel_project` 工具，调用它拿到 `novel_metadata` 的第一步 prompt，生成 JSON，调用 `submit_step_result`，然后再调用 `get_next_step` 获取下一步 prompt/context，如此循环直到 `complete`。MCP 写入型工具会返回紧凑结果，不会把长章节正文通过工具结果再次回显。读上下文工具如果可能超过宿主 token 限制，NovelForge 会返回 `instructionPreview` / `contextPreview` 和 `fullContextPath`；需要完整 payload 时读取这个本地 JSON 文件。

### Codex CLI

```toml
# ~/.codex/config.toml
[mcp_servers.novelforge]
command = "node"
args = ["/absolute/path/to/novelforge-agent/dist/src/mcp/server.js"]

[mcp_servers.novelforge.env]
NOVELFORGE_WORKSPACE = "/absolute/path/where/projects/should/live"
```

### 在后续会话中继续写

`list_projects` 会查找 `NOVELFORGE_WORKSPACE/novels/` 下所有项目，并按更新时间倒序排列。宿主打开新会话时，应该先调用它，选择目标 `projectPath`，再调用 `get_project_status` 获取一屏项目摘要，最后用 `get_next_step` 继续当前步骤。

## 工具参考

### 项目生命周期

- **`start_novel_project`** `(prompt, language?, outputDir?, targetChapters?, plannedTotalChapters?)` — 在 `<workspaceRoot>/<outputDir>/<prompt-slug>-<rand6>/` 下创建项目，并返回第一步 instruction。`novel_metadata` 被接受后，目录会重命名为 `<title-slug>-<same-rand6>/`；调用方后续必须使用返回的 `state.projectPath`。`targetChapters` 是每批规划章节数，MCP 默认 5；`plannedTotalChapters` 是全书目标章节数，MCP 默认 12。
- **`list_projects`** `(outputDir?)` — 按更新时间倒序列出工作区内所有项目。
- **`get_project_status`** `(projectPath)` — 返回紧凑状态摘要：当前步骤、已写章节、开放伏笔、最新 review 结果等。
- **`get_next_step`** `(projectPath)` — 返回当前工作流下一步的 prompt 和打包上下文。大 prompt/context 会以 `instructionPreview` / `contextPreview` + `fullContextPath` 返回，不会把巨大字段直接塞进 MCP tool result。

### 工作流推进

- **`submit_step_result`** `(projectPath, step, content)` — 校验 `content` 是否符合当前 step 的 zod schema，保存产物，推进状态机，并返回紧凑 mutation result。它不包含下一步完整 prompt/context；需要时请随后调用 `get_next_step`。失败提交会写入 `.agent-recovery/failed-*.txt`，状态不会推进。
- **`get_context`** `(projectPath, purpose, chapterNumber?, start?, end?)` — 在不改变状态的情况下构建指定用途的上下文。适合宿主查看“如果现在生成，会拿到什么上下文”。大上下文同样使用 `contextPreview` + `fullContextPath`。

动态规划内置在状态机里：每章通过 review 并提交 memory card 后，NovelForge 会检查 `plannedTotalChapters` 和 `architecture/chapters.json` 中已有的最高规划章节。如果下一章仍在全书目标内，但尚未被规划，下一步会变成 `architecture_extension`；宿主提交续规划 JSON 后，继续进入 `chapter`。

### 语义动作工具

- **`generate_chapter`** `(projectPath, chapterNumber)` — 只构建指定章节的生成上下文，不改变状态。大上下文可能返回 `contextPreview` + `fullContextPath`。
- **`extract_memory_card`** `(projectPath, chapterNumber)` — 只构建指定章节的记忆卡抽取上下文，不改变状态。大上下文可能返回 `contextPreview` + `fullContextPath`。
- **`review_chapter`** `(projectPath, chapterNumber)` — 进入单章编辑审稿支线，并返回审稿 prompt。大 prompt/context 可能返回 `instructionPreview` / `contextPreview` + `fullContextPath`。之后通过 `submit_step_result(step="chapter_review")` 恢复原流程。
- **`revise_chapter`** `(projectPath, chapterNumber, feedback?)` — 进入章节修订支线。大 prompt/context 可能返回 `instructionPreview` / `contextPreview` + `fullContextPath`。提交 `chapter_revision` 后，旧版本会自动归档到 `chapters/.versions/`。
- **`cross_chapter_review`** `(projectPath, start?, end?)` — 进入跨章节审查支线，默认覆盖所有已生成章节。大 prompt/context 可能返回 `instructionPreview` / `contextPreview` + `fullContextPath`。
- **`save_chapter`** `(projectPath, chapterNumber, title, content)` — 通过状态机提交当前章节；要求 `currentStep="chapter"`，提交后进入强制 `chapter_review`。返回的 MCP payload 是紧凑结果，不回显章节正文或 review 上下文。

### 项目操作

- **`amend_novel_metadata`** `(projectPath, content?, title?, genre?, premise?, language?, style?, coreCast?, reason?)` — 更新 `novel.json`；如果 `title` 变化，会同步重命名项目目录，之后必须使用返回的 `projectPath`。
- **`amend_story_bible`** `(projectPath, content, reason?)` — 替换 `story-bible.md`，归档旧版本，并重建故事圣经索引。
- **`list_bible_versions`** `(projectPath)` — 列出已归档的故事圣经版本。
- **`list_threads`** `(projectPath, status?)` — 列出从 memory card 收集的伏笔线程。
- **`update_thread`** `(projectPath, id, patch)` — 更新一个伏笔线程。
- **`fork_project`** `(sourceProjectPath, label?)` — 把项目复制成一个兄弟分支，并生成新的 project id。
- **`delete_chapter`** `(projectPath, chapterNumber)` — 删除章节、记忆卡、审稿、归档版本和索引条目。
- **`redo_step`** `(projectPath, step, chapterNumber?)` — 回滚到指定步骤，重新生成相关产物。

### 检索

- **`retrieve`** `(projectPath, query, topK?, types?, chapterStart?, chapterEnd?)` — 对章节段落、故事圣经 H2 片段、记忆卡做 BM25 风格词法检索。内置 CJK bigram 分词器，支持中英文混合查询，不依赖外部 embedding 模型。

## 项目目录结构

磁盘上的单个小说项目：

```txt
novels/<title-slug>-<rand6>/
├── agent-state.json              # 工作流状态 currentStep/currentChapter/files 等
├── novel.json                    # 小说 metadata
├── characters.json               # 独立角色状态表
├── story-bible.md
├── style-guide.json              # 可执行文风指南
├── architecture/
│   ├── full.md
│   ├── volumes.json
│   ├── volume-pacing.json
│   └── chapters.json
├── chapters/
│   ├── 001.md
│   ├── 002.md
│   └── .versions/                # 修订前章节快照
├── memory/
│   └── chapter-001.json
├── reviews/
│   ├── continuity-1-N.json
│   ├── chapter/chapter-NNN.json
│   └── cross/cross-S-E.json
├── .index/
│   ├── lexical.json              # MiniSearch 序列化索引
│   └── manifest.json             # 外部文档 id 列表
└── .agent-recovery/
    ├── failed-*.txt              # 被拒绝的提交，便于排查
    ├── mcp-context/*.json        # MCP 大上下文结果的完整落盘 payload
    └── side-track.json           # 支线 review/revision 的恢复信息
```

整个项目目录都是自包含的，可以复制、分享或删除。

## 工作流如何推进

```txt
novel_metadata → story_bible → style_guide → architecture → chapter
                                                            ↓
                                                       chapter_review
                                                            ↓
                                                 ┌──────────┴──────────┐
                                               clean             issues_found
                                                 ↓                    ↓
                                            memory_card       chapter_revision
                                                 ↓                    ↓
                  ┌──────────────┬──────────────┐        │
          已规划下一章        需要续规划       全书完成    │
                ↓              ↓              ↓           │
             chapter   architecture_extension ↓           │
                              ↓        continuity_review  │
                           chapter             ↓          │
                                            complete       │
                                                       （回到
                                                    chapter_review）
```

`chapter_review` 既是手动支线，也是自动章节验收门槛。在正常章节循环中，review 的 `status` 必须是 `clean`，工作流才允许进入 `memory_card`。如果 review 返回 `issues_found`，工作流会强制进入 `chapter_revision`，然后回到 `chapter_review` 再审一次。

支线步骤（`chapter_review`、`chapter_revision`、`cross_chapter_review`）可以随时通过语义动作工具触发。手动支线通过 `submit_step_result` 完成后，工作流会回到触发支线前的原步骤。

正常章节循环是动态的：`memory_card` 之后，NovelForge 会检查下一章是否已规划。如果没有规划，并且项目尚未达到 `plannedTotalChapters`，下一步会变成 `architecture_extension`，续完规划后再继续写章。

状态迁移由 [src/core/steps/](src/core/steps/) 下各 step handler 的 `next:` 声明和 [src/core/workflow.ts](src/core/workflow.ts) 的 dispatcher 共同实现。这里没有 LangGraph 或外部 graph engine。

## 架构

```txt
src/
├── core/                         # 纯领域逻辑，无 transport
│   ├── types.ts                  # AgentState、WorkflowStep、MemoryCard 等
│   ├── schemas.ts                # zod schema，唯一校验层
│   ├── projectStore.ts           # 文件系统持久化
│   ├── projectDiscovery.ts       # list/status
│   ├── characterStore.ts         # 独立角色状态表
│   ├── prompts/                  # 多语言 prompt 包 zh-CN/en-US
│   ├── steps/                    # 每个 WorkflowStep 一个 handler
│   ├── retrieval/                # BM25 索引、CJK tokenizer、chunker
│   ├── contextBuilder.ts         # 按用途打包上下文
│   └── workflow.ts               # dispatcher、contextForStep、side-track、submit
├── mcp/
│   ├── server.ts                 # stdio 入口
│   └── tools.ts                  # 21 个 MCP tools + 10 个 MCP prompts
└── cli/
    └── index.ts                  # 等价 CLI 子命令
```

NovelForge 没有 LLM 依赖：

```bash
$ grep -RIl "anthropic\|openai\|@google" src package.json
# 无结果
```

核心依赖只有 `@modelcontextprotocol/sdk`、`zod`、`minisearch`。

## 不只是一个 Skill

Skill 可以描述一个写作流程。NovelForge 会执行并约束这个流程。

它会持久化工作流状态，用 zod schema 校验产物，为失败提交写 recovery 文件，为生成内容建立检索索引，维护角色/伏笔状态，归档修订版本，并且在 `chapter_review` 这类门控步骤通过前拒绝继续推进。

可以用 skill 或 prompt pack 教宿主 AI 如何更好地调用 NovelForge；但当你需要持久状态、校验、恢复、检索和可重复的长篇生产流程时，需要的是这个 runtime。

## 添加新的工作流步骤

1. 在 [src/core/types.ts](src/core/types.ts) 的 `WorkflowStep` 中添加步骤名。
2. 在 [src/core/schemas.ts](src/core/schemas.ts) 中添加 zod schema（如果该步骤接收结构化内容）。
3. 在 [src/core/prompts/zh-CN.ts](src/core/prompts/zh-CN.ts) 和 [src/core/prompts/en-US.ts](src/core/prompts/en-US.ts) 中添加 prompt builder。
4. 在 `src/core/steps/<name>.ts` 创建 handler，返回 `StepApplyResult`。
5. 在 [src/core/steps/index.ts](src/core/steps/index.ts) 注册。
6. 如果该步骤需要上下文，在 [src/core/workflow.ts](src/core/workflow.ts) 的 `CONTEXT_RECIPES` 中添加条目。
7. 在 [src/mcp/tools.ts](src/mcp/tools.ts) 的 `submit_step_result` step enum 中添加步骤名。

## 设计原则

这个系统里唯一“思考”的是宿主 LLM。NovelForge 是一个工作流 runtime，它知道工作的顺序、每个产物的形状和长篇小说领域的关键词汇，并拒绝保存不符合规则的提交。长篇小说创作需要这种纪律，胜过再套一层 LLM wrapper。
