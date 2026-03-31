import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import OpenAI from 'https://deno.land/x/openai@v4.53.2/mod.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

type Body = {
  conversation_id: string
  limit_messages?: number
  include_last_n_messages?: number
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function sanitizeMessages(messages: { sender_id: string; body: string; created_at: string }[]) {
  // Basic size guard; you can replace with stricter token logic.
  return messages.map((m) => ({
    sender: m.sender_id,
    at: m.created_at,
    text: m.body,
  }))
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization') || ''
  // Edge functions by default are typically verified via JWT depending on config.
  // This function uses service role for DB write, but we still validate the request’s user via JWT.
  // If your project enforces JWT verification on functions, you can remove/adjust this section.

  const { conversation_id, limit_messages = 80 } = (await req.json()) as Body

  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Use auth.uid() style in DB is not directly available here; so we validate membership manually
  // by calling auth.users isn't enough; we check membership based on JWT “sub”.
  // We’ll decode the JWT manually only if you pass one; otherwise you must rely on function JWT verification.
  // Minimal approach: require that your client uses Supabase "Authorization: Bearer <access_token>".

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing Authorization Bearer token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Get user id from JWT using Supabase Admin JWT verification is not available via client lib directly.
  // Instead, use Supabase Admin Auth to get the user via token:
  // (Auth verify endpoint is not documented here; simplest safe approach is:
  //  use `supabaseAdmin.auth.getUser(token)` with admin key)
  const userRes = await supabaseAdmin.auth.getUser(token).catch(() => null)
  const userId = userRes?.data?.user?.id
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verify membership
  const memberCheck = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('conversation_id', conversation_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!memberCheck.data) {
    return new Response(JSON.stringify({ error: 'Not a conversation member' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: messages, error: msgErr } = await supabaseAdmin
    .from('messages')
    .select('sender_id, body, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: false })
    .limit(limit_messages)

  if (msgErr) {
    return new Response(JSON.stringify({ error: 'Failed to load messages', details: msgErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ summary: '', summary_json: null, message_count: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Reverse to chronological order for better summarization context
  const chronological = [...messages].reverse()

  const model = 'gpt-4o-mini'
  const openai = new OpenAI({ apiKey: openaiKey })

  const sanitized = sanitizeMessages(chronological)

  const promptSystem = `
You are a helpful assistant that summarizes chat threads.
Return:
1) A short summary (1-3 sentences)
2) Key points (bullet list)
3) Decisions made (bullet list)
4) Open questions / next steps (bullet list)
5) Mention important named entities (people/projects/links if present)

Be faithful to the text. If the conversation is noisy, say so.
Respond ONLY as valid JSON in this exact shape:
{
  "summary": string,
  "key_points": string[],
  "decisions": string[],
  "open_questions": string[],
  "entities": string[]
}
`.trim()

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: promptSystem },
      {
        role: 'user',
        content: JSON.stringify(
          {
            conversation_id,
            messages: sanitized,
          },
          null,
          2
        ),
      },
    ],
    temperature: 0.2,
  })

  const content = response.choices[0]?.message?.content || ''
  let parsed: any = null
  try {
    parsed = JSON.parse(content)
  } catch {
    // Fallback: store raw content
    parsed = {
      summary: content.slice(0, 2000),
      key_points: [],
      decisions: [],
      open_questions: [],
      entities: [],
    }
  }

  const summaryText = parsed.summary ?? content

  const { error: writeErr } = await supabaseAdmin.from('message_summaries').insert({
    conversation_id,
    created_by: userId,
    summary: summaryText,
    summary_json: parsed,
    model,
  })

  if (writeErr) {
    return new Response(JSON.stringify({ error: 'Failed to store summary', details: writeErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ summary: summaryText, summary_json: parsed, message_count: sanitized.length }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
