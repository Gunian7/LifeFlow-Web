import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { handleOrder, type OrderProvider } from './order'
import { handleParse } from './parse'
import { handleBriefing } from './briefing'
import { createChat } from './chat'
import { createOpenAiCompatibleProvider } from './provider'

type Bindings = {
  PARSE_PROVIDER?: Parameters<typeof handleParse>[1]
  BRIEFING_PROVIDER?: Parameters<typeof handleBriefing>[1]
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  ORDER_PROVIDER?: OrderProvider
}

const app = new Hono<{ Bindings: Bindings }>()

const allowedOrigins = [
  'https://gunian7.github.io',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]

app.use('*', cors({ origin: allowedOrigins, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }))

app.get('/health', (context) => context.json({ ok: true, service: 'lifeflow-api' }))

function envChat(env?: Bindings) {
  if (!env?.LLM_API_KEY) return undefined
  return createChat({ apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: env.LLM_MODEL ?? 'gpt-4o-mini' })
}

app.post('/v1/ai/order', (context) => {
  const injected = context.env?.ORDER_PROVIDER
  const provider = injected ?? (context.env?.LLM_API_KEY ? createOpenAiCompatibleProvider({ apiKey: context.env.LLM_API_KEY, baseUrl: context.env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: context.env.LLM_MODEL ?? 'gpt-4o-mini' }) : undefined)
  return handleOrder(context, provider)
})
app.post('/v1/ai/parse', (context) => handleParse(context, context.env?.PARSE_PROVIDER ?? envChat(context.env)))
app.post('/v1/ai/briefing', (context) => handleBriefing(context, context.env?.BRIEFING_PROVIDER ?? envChat(context.env)))

export default app
