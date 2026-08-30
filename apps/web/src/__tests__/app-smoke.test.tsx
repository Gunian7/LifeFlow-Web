import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../main'

afterEach(cleanup)

describe('App smoke', () => {
  it('renders the header and the quick capture row', () => {
    localStorage.clear()
    render(<App />)
    expect(document.querySelector('h1')?.textContent).toBeTruthy()
    expect(screen.getByPlaceholderText('加一件事')).toBeTruthy()
  })

  it('adds a task through quick capture and schedules it', () => {
    localStorage.clear()
    render(<App />)
    const title = screen.getByPlaceholderText('加一件事') as HTMLInputElement
    const minutes = screen.getByLabelText('预计分钟') as HTMLInputElement
    fireEvent.change(title, { target: { value: '冒烟测试任务' } })
    fireEvent.change(minutes, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    const tasks = JSON.parse(localStorage.getItem('lifeflow-web-tasks-v1') || '[]')
    expect(tasks.some((task: { title: string }) => task.title === '冒烟测试任务')).toBe(true)
  })

  it('expands the detail form and adds with chosen importance', () => {
    localStorage.clear()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /展开详细设置/ }))
    const title = screen.getByPlaceholderText('加一件事') as HTMLInputElement
    fireEvent.change(title, { target: { value: '重要的事' } })
    fireEvent.click(screen.getByRole('button', { name: '必须做' }))
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    const tasks = JSON.parse(localStorage.getItem('lifeflow-web-tasks-v1') || '[]')
    const created = tasks.find((task: { title: string }) => task.title === '重要的事')
    expect(created?.importance).toBe('must')
  })

  it('opens the settings page with all sections', () => {
    localStorage.clear()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    for (const label of ['外观', '计划', '重复', '数据', 'AI 与服务', '关于 LifeFlow']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
      expect(document.querySelectorAll('.settings-nav-item.selected').length).toBe(1)
    }
  })
})
