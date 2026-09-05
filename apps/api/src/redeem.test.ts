import { describe, expect, it } from 'vitest'
import { generateCode, codeDigest } from './redeem'

describe('redeem codes', () => {
  it('generates codes in LF-XXXX-XXXX-XXXX format', () => {
    const code = generateCode()
    expect(code).toMatch(/^LF-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateCode()))
    expect(codes.size).toBe(100)
  })

  it('codeDigest normalizes dashes and case', async () => {
    const a = await codeDigest('LF-ABCD-EFGH-JKMN')
    const b = await codeDigest('  lf-abcdef-gh-jkmn  ')
    expect(a).toBe(b)
  })
})
