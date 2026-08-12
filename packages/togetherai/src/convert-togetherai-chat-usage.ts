import { convertOpenAICompatibleChatUsage } from '@ai-sdk/openai-compatible/internal';
import type { LanguageModelV4Usage } from '@ai-sdk/provider';

export function convertTogetherAIChatUsage(
  usage:
    | {
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
        total_tokens?: number | null;
        cached_tokens?: number | null;
        prompt_tokens_details?: {
          cached_tokens?: number | null;
        } | null;
        completion_tokens_details?: {
          reasoning_tokens?: number | null;
        } | null;
      }
    | undefined
    | null,
): LanguageModelV4Usage {
  const converted = convertOpenAICompatibleChatUsage(usage);

  if (usage == null) {
    return converted;
  }

  const promptTokens = converted.inputTokens.total ?? 0;
  const cacheReadTokens =
    usage.prompt_tokens_details?.cached_tokens || usage.cached_tokens || 0;

  return {
    ...converted,
    inputTokens: {
      ...converted.inputTokens,
      noCache: promptTokens - cacheReadTokens,
      cacheRead: cacheReadTokens,
    },
  };
}
