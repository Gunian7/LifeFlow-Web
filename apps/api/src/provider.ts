import type { OrderContext, OrderProvider, OrderTask } from './order'

export interface ProviderOptions {
  apiKey: string
  baseUrl: string
  model: string
  fetcher?: typeof fetch
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
}

export function createOpenAiCompatibleProvider(options: ProviderOptions): OrderProvider {
  const fetcher = options.fetcher ?? fetch
  return async (tasks: OrderTask[], context: OrderContext): Promise<string> => {
    const prompt = [
      'You are helping order today\'s tasks for a calm, realistic day planner.',
      'Consider importance (must > important > want), each task\'s duration, and how much usable time remains before the day ends.',
      'Put must-do tasks first. If everything cannot realistically fit the remaining time, order them so the most important work happens first; do not pretend it all fits.',
      'Return JSON only with this exact shape: {"order":[task ids in preferred order],"reason":"brief explanation"}.',
      'Do not create, delete, rename, or modify tasks. Include every id exactly once.',
      JSON.stringify({ tasks, context }),
    ].join('\n')
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
