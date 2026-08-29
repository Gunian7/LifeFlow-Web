import { Hono } from 'hono'
import { handleOrder, type OrderProvider } from './order'
import { createOpenAiCompatibleProvider } from './provider'

type Bindings = {
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  ORDER_PROVIDER?: OrderProvider
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/health', (context) => context.json({ ok: true, service: 'lifeflow-api' }))
app.post('/v1/ai/order', (context) => {
  const injected = context.env?.ORDER_PROVIDER
  const provider = injected ?? (context.env?.LLM_API_KEY ? createOpenAiCompatibleProvider({ apiKey: context.env.LLM_API_KEY, baseUrl: context.env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: context.env.LLM_MODEL ?? 'gpt-4o-mini' }) : undefined)
  return handleOrder(context, provider)
})

export default app
