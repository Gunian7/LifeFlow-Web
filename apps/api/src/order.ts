import type { Context } from 'hono'

export interface OrderTask {
  id: string
  title: string
  durationMinutes: number
  importance: 'must' | 'important' | 'want'
}

export interface OrderContext { now?: string; windowEndLocalTime?: string }

export interface OrderProvider {
  (tasks: OrderTask[], context: OrderContext): Promise<string>
}

interface OrderBody { tasks: unknown; context?: unknown }
interface ProviderResult { order: unknown; reason: unknown }

function normalizeContext(value: unknown): OrderContext {
  if (!value || typeof value !== 'object') return {}
  const raw = value as { now?: unknown; windowEndLocalTime?: unknown }
  return {
    now: typeof raw.now === 'string' ? raw.now : undefined,
    windowEndLocalTime: typeof raw.windowEndLocalTime === 'string' ? raw.windowEndLocalTime : undefined,
  }
}

function isTask(value: unknown): value is OrderTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<OrderTask>
  return typeof task.id === 'string' && task.id.trim().length > 0 && typeof task.title === 'string' && task.title.trim().length > 0 && Number.isInteger(task.durationMinutes) && (task.durationMinutes ?? 0) > 0 && (task.importance === 'must' || task.importance === 'important' || task.importance === 'want')
}

export function validateOrderTasks(body: unknown): OrderTask[] | null {
  if (!body || typeof body !== 'object') return null
  const bodyTasks = (body as OrderBody).tasks
  if (!Array.isArray(bodyTasks) || bodyTasks.length === 0 || bodyTasks.length > 20 || !bodyTasks.every((item: unknown) => isTask(item))) return null
  const ids = bodyTasks.map((task: OrderTask) => task.id)
  if (new Set(ids).size !== ids.length) return null
  return bodyTasks.map((value: OrderTask) => ({ id: value.id.trim(), title: value.title.trim(), durationMinutes: value.durationMinutes, importance: value.importance }))
}

export function parseProviderResponse(raw: string, taskIds: string[]): { order: string[]; reason: string } | null {
  let parsed: ProviderResult
  try { parsed = JSON.parse(raw) as ProviderResult } catch { return null }
  if (!Array.isArray(parsed.order) || !parsed.order.every((id) => typeof id === 'string') || typeof parsed.reason !== 'string') return null
  const order = parsed.order as string[]
  if (order.length !== taskIds.length || new Set(order).size !== order.length || !taskIds.every((id) => order.includes(id))) return null
  return { order, reason: parsed.reason }
}

export async function handleOrder(context: Context<{ Bindings: { ORDER_PROVIDER?: OrderProvider } }>, providerOverride?: OrderProvider): Promise<Response> {
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400) }
  const tasks = validateOrderTasks(body)
  if (!tasks) return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400)
  const provider = providerOverride ?? context.env?.ORDER_PROVIDER
  if (!provider) return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502)
  let raw: string
  try { raw = await provider(tasks, normalizeContext((body as OrderBody).context)) } catch { return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502) }
  const result = parseProviderResponse(raw, tasks.map((task) => task.id))
  if (!result) return context.json({ ok: false, error: 'INVALID_PROVIDER_RESPONSE' }, 502)
  return context.json({ ok: true, order: result.order, reason: result.reason })
}
