import { describe, expect, it } from 'vitest'
import { defaultTheme, getTheme, themeIds, type ThemeId } from '../theme'

describe('visual themes', () => {
  it('contains the three product skin directions', () => {
    expect(themeIds).toEqual(['archive-terminal', 'warm-system', 'quiet-dark', 'paper-editorial'])
  })

  it('uses Warm System as the stable default', () => {
    expect(defaultTheme.id).toBe('archive-terminal')
    expect(getTheme(undefined).id).toBe('archive-terminal')
  })

  it('falls back safely for an unknown saved skin', () => {
    expect(getTheme('not-a-theme' as ThemeId).id).toBe('archive-terminal')
  })

  it('keeps accent semantics distinct across skins', () => {
    const accents = themeIds.map((id) => getTheme(id).tokens.accent)
    expect(new Set(accents).size).toBe(4)
  })
})
