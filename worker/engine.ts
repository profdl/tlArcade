/**
 * Engine — the Anthropic proxy for the Engine demo's AI converters.
 *
 * Mounted at `/api/engine/*` (see worker/worker.ts). Its ONLY job is to keep the
 * Anthropic API key server-side: the browser POSTs a Messages-API request body to
 * `/api/engine/messages`, this proxy attaches the key (a Worker secret, never
 * shipped to the client) and forwards it to Anthropic, then streams the response
 * straight back.
 *
 * It is deliberately thin — no prompt-building, no schema knowledge. The client
 * (src/demos/engine/game/ai/client.ts) owns the prompt, the Zod validation, and
 * the retry-on-invalid-JSON loop; the Worker is just the key-holding relay. That
 * split keeps all the converter logic in the demo where it's testable, and keeps
 * the secret out of the bundle.
 *
 * Set the secret with:  wrangler secret put ANTHROPIC_API_KEY
 */
import type { IRequest } from 'itty-router'

/** Env is Wrangler-generated (worker-configuration.d.ts) and doesn't include our
 *  secret, so declare it locally. Secrets are plain string bindings on env. */
interface EngineEnv {
  ANTHROPIC_API_KEY?: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Cap on the forwarded body so a runaway client can't POST an unbounded prompt
 *  (a perceive() PNG is large; 12 MB comfortably fits a scale-2 image + geometry). */
const MAX_BODY_BYTES = 12 * 1024 * 1024

/**
 * POST /api/engine/messages — forward an Anthropic Messages request, key attached.
 *
 * The client sends the exact Messages API body (model, messages, max_tokens, …);
 * we don't reshape it, so the client stays in control of the request and this
 * proxy needs no updates as prompts evolve.
 */
export async function handleEngineMessages(request: IRequest, env: EngineEnv): Promise<Response> {
  const key = env.ANTHROPIC_API_KEY
  if (!key) {
    return json(
      { error: 'ANTHROPIC_API_KEY is not configured on the Worker (wrangler secret put ANTHROPIC_API_KEY).' },
      500,
    )
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large.' }, 413)
  }

  // Validate it's JSON before forwarding (fail fast with a clear error rather than
  // relaying a malformed body and getting an opaque 400 from Anthropic).
  try {
    JSON.parse(raw)
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: raw,
    })
  } catch (e) {
    return json({ error: `Upstream request failed: ${(e as Error).message}` }, 502)
  }

  // Relay Anthropic's response verbatim (status + body). Force JSON content-type;
  // strip hop-by-hop headers by constructing a fresh Response.
  const body = await upstream.text()
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  })
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
