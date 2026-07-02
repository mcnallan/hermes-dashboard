import assert from 'node:assert/strict'
import test from 'node:test'
import { applyUsageEvent, emptyUsage, type UsageSession } from './usageState.ts'

function session(): UsageSession {
  return { usage: emptyUsage() }
}

test('context usage remains live while prompt tokens remain cumulative', () => {
  const s = session()

  applyUsageEvent(s, {
    usage: { prompt_tokens: 100_000, completion_tokens: 1_000, total_tokens: 101_000 },
    context_usage: {
      prompt_tokens: 100_000,
      context_length: 200_000,
    },
  })
  applyUsageEvent(s, {
    usage: { prompt_tokens: 100_000, completion_tokens: 1_000, total_tokens: 101_000 },
    context_usage: {
      prompt_tokens: 120_000,
      context_length: 200_000,
    },
  })

  assert.equal(s.usage.promptTokens, 200_000)
  assert.equal(s.usage.totalTokens, 202_000)
  assert.equal(s.contextTokenCount, 120_000)
  assert.equal(s.contextMaxTokens, 200_000)
})

test('missing context usage falls back to the current event usage', () => {
  const s = session()

  applyUsageEvent(s, {
    usage: { prompt_tokens: 100_000, completion_tokens: 1_000, total_tokens: 101_000 },
  })

  assert.equal(s.usage.promptTokens, 100_000)
  assert.equal(s.contextTokenCount, 100_000)
  assert.equal(s.contextMaxTokens, undefined)
})
