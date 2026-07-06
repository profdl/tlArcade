/**
 * Engine — the AI client: one typed, Zod-validated call to Claude.
 *
 * Every converter (autoLevel, autoTune, autoRig, …) is a thin wrapper over
 * `generate()`. It:
 *  1. builds an Anthropic Messages request from a prompt (+ optional images/
 *     perception bundle),
 *  2. POSTs it to the Worker proxy (/api/engine/messages), which attaches the
 *     server-side API key (worker/engine.ts) — the key never reaches the browser,
 *  3. extracts the model's JSON, Zod-parses it against the caller's schema,
 *  4. on invalid/absent JSON, RETRIES ONCE, feeding the parse error back to Claude
 *     so it can correct its own output.
 *
 * The client owns the prompt, the schema, and the retry; the Worker is a dumb
 * key-holding relay. That keeps all converter logic here, in the demo, where it's
 * testable, and keeps the proxy stable as prompts evolve.
 */
import type { z } from 'zod'

/** Latest capable Claude model for vision + structured JSON authoring. */
const DEFAULT_MODEL = 'claude-sonnet-5'
const DEFAULT_MAX_TOKENS = 8192
const ENDPOINT = '/api/engine/messages'

/** An image block for a vision call — the base64 payload from perceive()'s PNG. */
export interface ImageInput {
  /** Raw base64 (no `data:` prefix) and the media type, split out for the API. */
  mediaType: 'image/png' | 'image/jpeg'
  base64: string
}

export interface GenerateOptions<T> {
  /** The Zod schema the model's JSON must satisfy. */
  schema: z.ZodType<T>
  /** The instruction — what to author, in what shape. Be explicit about the JSON. */
  prompt: string
  /** System prompt; defaults to a JSON-only authoring instruction. */
  system?: string
  /** Optional images (perceive() PNG/SVG-render) prepended to the user turn. */
  images?: ImageInput[]
  model?: string
  maxTokens?: number
  /** Total attempts including the first (default 2 = one retry on invalid JSON). */
  maxAttempts?: number
  /** Abort the in-flight request (e.g. the user cancels "generating…"). */
  signal?: AbortSignal
}

export class AiError extends Error {}

/** A single Anthropic content block we send or receive (text only, on our side). */
type TextBlock = { type: 'text'; text: string }
type ImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
type ContentBlock = TextBlock | ImageBlock

const DEFAULT_SYSTEM =
  'You are a game-data authoring engine. You output ONLY a single JSON value that ' +
  'matches the schema described in the user message. No prose, no markdown fences, ' +
  'no explanation — just the JSON.'

/**
 * Generate schema-valid data from Claude. Resolves with the parsed, typed value;
 * throws `AiError` if every attempt fails (network, API error, or JSON that never
 * validates).
 */
export async function generate<T>(opts: GenerateOptions<T>): Promise<T> {
  const {
    schema,
    prompt,
    system = DEFAULT_SYSTEM,
    images = [],
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    maxAttempts = 2,
    signal,
  } = opts

  // The conversation grows across retries: user asks → assistant replies (bad
  // JSON) → user reports the error → assistant retries. Feeding the real parse
  // error back is what makes the retry actually fix the output.
  const userContent: ContentBlock[] = [
    ...images.map(
      (img): ImageBlock => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      }),
    ),
    { type: 'text', text: prompt },
  ]
  const messages: { role: 'user' | 'assistant'; content: ContentBlock[] }[] = [
    { role: 'user', content: userContent },
  ]

  let lastError = ''
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const text = await callModel({ model, maxTokens, system, messages, signal })

    const parsed = tryParseJson(text)
    if (parsed.ok) {
      const result = schema.safeParse(parsed.value)
      if (result.success) return result.data
      lastError = formatZodError(result.error)
    } else {
      lastError = parsed.error
    }

    // Not the last attempt → record the exchange and ask Claude to fix it.
    if (attempt < maxAttempts - 1) {
      messages.push({ role: 'assistant', content: [{ type: 'text', text }] })
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Your previous output did not match the required schema.\n\n` +
              `Error:\n${lastError}\n\n` +
              `Reply again with ONLY the corrected JSON — no prose, no markdown fences.`,
          },
        ],
      })
    }
  }

  throw new AiError(`Model output failed validation after ${maxAttempts} attempt(s): ${lastError}`)
}

/** POST a Messages request through the Worker proxy; return the model's text. */
async function callModel(args: {
  model: string
  maxTokens: number
  system: string
  messages: { role: 'user' | 'assistant'; content: ContentBlock[] }[]
  signal?: AbortSignal
}): Promise<string> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.maxTokens,
        system: args.system,
        messages: args.messages,
      }),
      signal: args.signal,
    })
  } catch (e) {
    throw new AiError(`Request to the AI proxy failed: ${(e as Error).message}`)
  }

  const raw = await res.text()
  if (!res.ok) {
    throw new AiError(`AI proxy returned ${res.status}: ${raw.slice(0, 500)}`)
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new AiError(`AI proxy returned non-JSON: ${raw.slice(0, 200)}`)
  }

  const text = extractText(body)
  if (text == null) {
    throw new AiError(`AI response had no text content: ${raw.slice(0, 300)}`)
  }
  return text
}

/** Pull the concatenated text from an Anthropic Messages API response. */
function extractText(body: unknown): string | null {
  if (typeof body !== 'object' || body == null) return null
  const content = (body as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  const parts = content
    .filter((b): b is TextBlock => isTextBlock(b))
    .map((b) => b.text)
  return parts.length ? parts.join('') : null
}

function isTextBlock(b: unknown): b is TextBlock {
  return (
    typeof b === 'object' &&
    b != null &&
    (b as { type?: unknown }).type === 'text' &&
    typeof (b as { text?: unknown }).text === 'string'
  )
}

/**
 * Parse the model's text as JSON, tolerating a common failure mode: the model
 * wrapping its JSON in a ```json fence or adding a sentence around it. We strip a
 * fence if present, else grab the outermost {...} or [...] span.
 */
function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const candidate = stripToJson(text)
  try {
    return { ok: true, value: JSON.parse(candidate) }
  } catch (e) {
    return { ok: false, error: `Response was not valid JSON (${(e as Error).message}).` }
  }
}

/** Exported for unit testing the fence/span stripping in isolation. */
export function stripToJson(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fence) return fence[1].trim()
  // Outermost object or array span (handles a stray leading/trailing sentence).
  const firstObj = trimmed.indexOf('{')
  const firstArr = trimmed.indexOf('[')
  const start =
    firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstObj, firstArr)
  if (start === -1) return trimmed
  const openChar = trimmed[start]
  const closeChar = openChar === '{' ? '}' : ']'
  const end = trimmed.lastIndexOf(closeChar)
  if (end <= start) return trimmed
  return trimmed.slice(start, end + 1)
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
}
