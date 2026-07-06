import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { generate, stripToJson, AiError } from './client'

describe('stripToJson', () => {
  it('passes through bare JSON', () => {
    expect(stripToJson('{"a":1}')).toBe('{"a":1}')
    expect(stripToJson('  [1,2,3]  ')).toBe('[1,2,3]')
  })

  it('unwraps a ```json fence', () => {
    expect(stripToJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripToJson('```\n[1]\n```')).toBe('[1]')
  })

  it('grabs the outermost span when the model adds prose', () => {
    expect(stripToJson('Here is the level: {"a":1} enjoy!')).toBe('{"a":1}')
    expect(stripToJson('Sure — [1,2] done')).toBe('[1,2]')
  })

  it('grabs from the first bracket to the matching last one of that kind', () => {
    // First bracket is `[`, so it spans to the LAST `]` — here just `[1]`.
    expect(stripToJson('x [1] y {"a":1} z')).toBe('[1]')
  })
})

/** Build a fake Anthropic Messages response body wrapping some text content. */
function apiResponse(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const schema = z.object({ n: z.number() })

afterEach(() => vi.restoreAllMocks())

describe('generate', () => {
  it('parses and validates a good first response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(apiResponse('{"n": 42}')),
    )
    const out = await generate({ schema, prompt: 'give me n', maxAttempts: 2 })
    expect(out).toEqual({ n: 42 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries once when the first response is invalid, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse('not json at all'))
      .mockResolvedValueOnce(apiResponse('{"n": 7}'))
    vi.stubGlobal('fetch', fetchMock)

    const out = await generate({ schema, prompt: 'give me n', maxAttempts: 2 })
    expect(out).toEqual({ n: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // The retry turn must feed the error back: 2nd call's body has 3 messages
    // (user → assistant(bad) → user(fix it)).
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(secondBody.messages).toHaveLength(3)
    expect(secondBody.messages[2].content[0].text).toContain('did not match')
  })

  it('throws AiError after exhausting attempts on schema mismatch', async () => {
    // A fresh Response per call — a Response body can only be read once.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => apiResponse('{"n": "not a number"}')),
    )
    await expect(generate({ schema, prompt: 'x', maxAttempts: 2 })).rejects.toBeInstanceOf(AiError)
  })

  it('throws AiError on a non-2xx proxy response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response('nope', { status: 500 })),
    )
    await expect(generate({ schema, prompt: 'x' })).rejects.toBeInstanceOf(AiError)
  })
})
