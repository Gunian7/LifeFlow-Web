import type { ProviderOptions } from './provider'

interface CompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
}

export type ChatFn = (prompt: string) => Promise<string>

// One OpenAI-compatible chat completion: send a prompt, get the message
// content back. Failures collapse into a single generic error so upstream
// response bodies never leak.
export function createChat(options: ProviderOptions): ChatFn {
  const fetcher = options.fetcher ?? fetch
  return async (prompt: string): Promise<string> => {
    let response: Response
    try {
      response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ model: options.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      })
    } catch {
      throw new Error('PROVIDER_REQUEST_FAILED')
    }
    if (!response.ok) throw new Error('PROVIDER_REQUEST_FAILED')
    let body: CompletionResponse
    try { body = await response.json() as CompletionResponse } catch { throw new Error('PROVIDER_REQUEST_FAILED') }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('PROVIDER_REQUEST_FAILED')
    return content
  }
}
