export type LlmProvider =
  | 'alibaba'
  | 'deepseek'
  | 'doubao'
  | 'gemini'
  | 'glm'
  | 'kimi'
  | 'minimax'
  | 'mimo'
  | 'openai'
  | 'custom';

export type LlmAuthMode = 'api_key' | 'openai_oauth' | 'gemini_app';
export type LlmThinkingLevel = 'off' | 'on' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type TranslationReferenceContext = {
  source: 'x_tweet';
  currentTweetText: string;
  quotedTweetText?: string;
} | {
  source: 'pdf_document';
  pageNumber: number;
  currentPageText: string;
  previousPageText: string;
  nextPageText: string;
  previousTranslations: Array<{ pageNumber: number; sourceText: string; translatedText: string }>;
};

/** Shared protocol validation keeps untrusted reference data bounded. */
export function isTranslationReferenceContext(value: unknown): value is TranslationReferenceContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const only = (keys: string[]): boolean => Object.keys(item).every((key) => keys.includes(key));
  if (item.source === 'x_tweet') return only(['source', 'currentTweetText', 'quotedTweetText'])
    && typeof item.currentTweetText === 'string'
    && (item.quotedTweetText === undefined || typeof item.quotedTweetText === 'string');
  if (item.source !== 'pdf_document' || !only(['source', 'pageNumber', 'currentPageText', 'previousPageText', 'nextPageText', 'previousTranslations'])) return false;
  const text = (value: unknown, max: number): boolean => typeof value === 'string' && value.length <= max;
  return Number.isSafeInteger(item.pageNumber) && (item.pageNumber as number) > 0
    && text(item.currentPageText, 4000) && text(item.previousPageText, 2000) && text(item.nextPageText, 2000)
    && Array.isArray(item.previousTranslations) && item.previousTranslations.length <= 3
    && item.previousTranslations.every((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const prior = entry as Record<string, unknown>;
      return Object.keys(prior).every((key) => ['pageNumber', 'sourceText', 'translatedText'].includes(key))
        && Number.isSafeInteger(prior.pageNumber) && (prior.pageNumber as number) > 0
        && (prior.pageNumber as number) < (item.pageNumber as number)
        && text(prior.sourceText, 1500) && text(prior.translatedText, 1500);
    });
}

export type LlmChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmChatContentPart[];
};

export type LlmChatCompletionRequestBody = {
  model: string;
  messages: LlmChatMessage[];
  response_format?: { type: 'json_object' | 'text' };
  enable_thinking?: boolean;
  reasoning_effort?: Exclude<LlmThinkingLevel, 'on' | 'off'> | 'none';
  reasoning_split?: boolean;
  thinking?: { type: 'disabled' | 'enabled' | 'adaptive' };
};

export type LlmChatCompletionsProxyConfig = {
  provider: LlmProvider;
  authMode: LlmAuthMode;
  baseUrl: string;
  useCustomModel?: boolean;
  thinkingLevel?: LlmThinkingLevel;
};

export type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type ChatCompletionTransportRequest = {
  body: LlmChatCompletionRequestBody;
  providerBody?: LlmChatCompletionRequestBody;
  proxyConfig: LlmChatCompletionsProxyConfig;
  diagnosticRunId?: string;
  signal?: AbortSignal;
};

export type PlainTranslationTransportRequest = {
  text: string;
  from: string;
  to: string;
  signal?: AbortSignal;
};

export interface TextTranslationTransport {
  requestChatCompletion(request: ChatCompletionTransportRequest): Promise<ChatCompletionResponse>;
  translatePlain(request: PlainTranslationTransportRequest): Promise<string>;
}

export type TextTranslationConfig = {
  localTextOnly?: boolean;
  sourceLang: string;
  targetLang: string;
  translator: 'google_web' | 'llm';
  llmProvider: LlmProvider;
  llmAuthMode: LlmAuthMode;
  llmBaseUrl: string;
  llmModel: string;
  llmUseCustomModel?: boolean;
  llmThinkingLevel?: LlmThinkingLevel;
  translationContext?: TranslationReferenceContext;
  diagnosticRunId?: string;
};

export type TextTranslationRegion = {
  id: string;
  sourceText: string;
  direction?: 'h' | 'v';
  originalLineCount?: number;
  translatedText: string;
  translatedColumns?: string[];
};

export type TranslationDebugInfo = {
  llmBatchRawResponse?: string;
  llmBatchParseError?: string;
  llmBatchError?: string;
  llmBatchFailed?: boolean;
  llmBatchRequestedRegionCount?: number;
  llmBatchHitRegionCount?: number;
  llmFallbackUsed?: boolean;
  llmFallbackRegionCount?: number;
  llmFallbackRequestCount?: number;
  tweetContextLengthFallback?: boolean;
};

export type TextTranslationRequest<T extends TextTranslationRegion> = {
  regions: readonly T[];
  config: Readonly<TextTranslationConfig>;
  signal?: AbortSignal;
};

export type TextTranslationResult<T extends TextTranslationRegion> = {
  regions: T[];
  translationDebug: TranslationDebugInfo | null;
};

export interface TextTranslator {
  translateRegions<T extends TextTranslationRegion>(
    request: TextTranslationRequest<T>,
  ): Promise<TextTranslationResult<T>>;
}
