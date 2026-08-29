import { describe, expect, it } from 'vitest'
import app from '../src/index'

describe('LifeFlow API CORS', () => {
  it('allows the deployed Web origin for health checks', async () => {
    const response = await app.request('http://localhost/health', { headers: { Origin: 'https://gunian7.github.io' } })
    expect(response.headers.get('access-control-allow-origin')).toBe('https://gunian7.github.io')
  })

  it('answers preflight for the AI endpoint', async () => {
    const response = await app.request('http://localhost/v1/ai/order', { method: 'OPTIONS', headers: { Origin: 'https://gunian7.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('does not grant browser access to an unrelated origin', async () => {
    const response = await app.request('http://localhost/health', { headers: { Origin: 'https://evil.example' } })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
