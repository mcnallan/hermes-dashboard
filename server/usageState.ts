export interface UsageState {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  promptTokens: number
  totalTokens: number
  apiCallCount: number
  estimatedCostUsd: number
}

export interface UsageSession {
  usage: UsageState
  model?: string
  provider?: string
  contextTokenCount?: number
  contextMaxTokens?: number
  contextThresholdTokens?: number
  contextUsagePercent?: number
}

export function emptyUsage(): UsageState {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
    apiCallCount: 0,
    estimatedCostUsd: 0,
  }
}

export function numberValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

export function usageFromPayload(value: unknown): UsageState {
  const u = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const inputTokens = numberValue(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens)
  const outputTokens = numberValue(u.output_tokens ?? u.outputTokens ?? u.completion_tokens)
  const cacheReadTokens = numberValue(u.cache_read_tokens ?? u.cacheReadTokens ?? u.cache_read_input_tokens)
  const cacheWriteTokens = numberValue(u.cache_write_tokens ?? u.cacheWriteTokens ?? u.cache_creation_input_tokens)
  const reasoningTokens = numberValue(u.reasoning_tokens ?? u.reasoningTokens)
  const promptTokens = numberValue(u.prompt_tokens ?? u.promptTokens) || inputTokens + cacheReadTokens + cacheWriteTokens
  const totalTokens = numberValue(u.total_tokens ?? u.totalTokens) || promptTokens + outputTokens
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    promptTokens,
    totalTokens,
    apiCallCount: numberValue(u.api_call_count ?? u.apiCallCount),
    estimatedCostUsd: numberValue(u.estimated_cost_usd ?? u.estimatedCostUsd),
  }
}

export function mergeUsage(items: UsageSession[]): UsageState {
  return items.reduce((total, s) => ({
    inputTokens: total.inputTokens + s.usage.inputTokens,
    outputTokens: total.outputTokens + s.usage.outputTokens,
    cacheReadTokens: total.cacheReadTokens + s.usage.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + s.usage.cacheWriteTokens,
    reasoningTokens: total.reasoningTokens + s.usage.reasoningTokens,
    promptTokens: total.promptTokens + s.usage.promptTokens,
    totalTokens: total.totalTokens + s.usage.totalTokens,
    apiCallCount: total.apiCallCount + s.usage.apiCallCount,
    estimatedCostUsd: total.estimatedCostUsd + s.usage.estimatedCostUsd,
  }), emptyUsage())
}

export function applyUsageEvent(s: UsageSession, payload: Record<string, unknown>) {
  if (payload.model) s.model = String(payload.model)
  if (payload.provider) s.provider = String(payload.provider)

  applyContextUsage(s, payload.context_usage, payload.usage)

  const absolute = usageFromPayload(payload.session_usage)
  if (absolute.totalTokens > 0 || absolute.apiCallCount > 0) {
    s.usage = {
      ...absolute,
      apiCallCount: absolute.apiCallCount || numberValue(payload.api_call_count) || s.usage.apiCallCount,
      estimatedCostUsd: absolute.estimatedCostUsd || s.usage.estimatedCostUsd,
    }
    return
  }

  const delta = usageFromPayload(payload.usage)
  if (delta.totalTokens <= 0) return
  s.usage.inputTokens += delta.inputTokens
  s.usage.outputTokens += delta.outputTokens
  s.usage.cacheReadTokens += delta.cacheReadTokens
  s.usage.cacheWriteTokens += delta.cacheWriteTokens
  s.usage.reasoningTokens += delta.reasoningTokens
  s.usage.promptTokens += delta.promptTokens
  s.usage.totalTokens += delta.totalTokens
  s.usage.apiCallCount += 1
  s.usage.estimatedCostUsd += numberValue(payload.estimated_cost_usd ?? delta.estimatedCostUsd)
}

function applyContextUsage(s: UsageSession, value: unknown, fallbackUsage: unknown) {
  const u = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const fallback = fallbackUsage && typeof fallbackUsage === 'object'
    ? fallbackUsage as Record<string, unknown>
    : {}
  const hasPromptTokens = 'prompt_tokens' in u || 'promptTokens' in u || 'last_prompt_tokens' in u || 'lastPromptTokens' in u
  const hasContextLength = 'context_length' in u || 'contextLength' in u
  const hasThresholdTokens = 'threshold_tokens' in u || 'thresholdTokens' in u
  const hasUsagePercent = 'usage_percent' in u || 'usagePercent' in u
  const promptTokens = hasPromptTokens
    ? numberValue(u.prompt_tokens ?? u.promptTokens ?? u.last_prompt_tokens ?? u.lastPromptTokens)
    : numberValue(fallback.prompt_tokens ?? fallback.promptTokens)
  const contextLength = numberValue(u.context_length ?? u.contextLength)
  const thresholdTokens = numberValue(u.threshold_tokens ?? u.thresholdTokens)
  const usagePercent = numberValue(u.usage_percent ?? u.usagePercent)

  if (promptTokens >= 0 && (hasPromptTokens || promptTokens > 0)) s.contextTokenCount = promptTokens
  if (hasContextLength && contextLength > 0) s.contextMaxTokens = contextLength
  if (hasThresholdTokens && thresholdTokens > 0) s.contextThresholdTokens = thresholdTokens
  if (hasUsagePercent && usagePercent >= 0) s.contextUsagePercent = usagePercent
}
