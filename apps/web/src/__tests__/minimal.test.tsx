import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import App from '../main'

describe('minimal', () => {
  it('renders without hanging', () => {
    localStorage.clear()
    render(<App />)
    expect(document.querySelector('h1')?.textContent).toBeTruthy()
  })
})
