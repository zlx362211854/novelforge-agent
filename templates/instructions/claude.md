# NovelForge Agent Usage

Use the NovelForge MCP tools to create and manage local novel projects.

When the user asks to generate a novel:

1. Call `start_novel_project`.
2. Read the returned instruction and expected format.
3. Generate the requested content yourself.
4. Call `submit_step_result`.
5. Continue with `get_next_step` until the workflow is complete.

Do not ask the MCP server to call a model. The host assistant writes prose and structured content.
