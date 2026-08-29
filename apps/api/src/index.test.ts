import { describe, expect, it } from 'vitest'
import app from '../src/index'

describe('LifeFlow API health', () => {
  it('reports the gateway as alive', async () => {
    const response = await app.request('http://localhost/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'lifeflow-api' })
  })
})
