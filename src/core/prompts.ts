import { enUSPromptPack } from './prompts/en-US.js';
import { zhCNPromptPack } from './prompts/zh-CN.js';
import { BuiltPrompt, PromptBuildInput, PromptPack } from './prompts/types.js';

export type {
  BuiltPrompt,
  PromptBuildInput,
  PromptPack,
  PromptPurpose,
} from './prompts/types.js';

const promptPacks: Record<PromptBuildInput['state']['language'], PromptPack> = {
  'zh-CN': zhCNPromptPack,
  'en-US': enUSPromptPack,
};

function getPromptPack(language: PromptBuildInput['state']['language']): PromptPack {
  return promptPacks[language] || zhCNPromptPack;
}

export function strictJsonOutputRules(language: PromptBuildInput['state']['language'] = 'zh-CN'): string {
  return getPromptPack(language).strictJsonOutputRules();
}

export function buildPromptForStep(input: PromptBuildInput): BuiltPrompt {
  return getPromptPack(input.state.language).buildPromptForStep(input);
}
