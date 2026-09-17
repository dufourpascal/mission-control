import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { API_KEY_HEADER } from './helpers'

test('100 automation runs stay paginated, produce one inbox summary, and retain details after archive', async ({ request, page }) => {
  const username = `automation-ui-${Date.now()}`, password = 'automation-test-pass!'
  await request.post('/api/auth/users', { headers: API_KEY_HEADER, data: { username, password, display_name: 'Automation UI', role: 'admin' } })
  const login = await page.request.post('/api/auth/login', { data: { username, password } })
  expect(login.ok()).toBeTruthy()
  await page.addInitScript(() => sessionStorage.setItem('mc-onboarding-dismissed', '1'))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const agent = `automation-test-${Date.now()}`
  let taskId = 0
  let lastRun: Record<string, unknown> = {}
  for (let i = 0; i < 100; i++) {
    lastRun = { id: randomUUID(), agent_id: agent, agent_name: agent, status: 'completed', outcome: 'success', runtime: 'codex-sdk', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), steps: [{ id: 'step-1', type: 'message', started_at: new Date().toISOString(), output_preview: 'Draft execution event', success: true }], cost: { input_tokens: 10, output_tokens: 5 }, metadata: { title: `Draft ${i + 1}`, result: 'Wrote a short follow-up for Ada. [Source](https://example.org/paper)', input: { name: 'Ada' }, operations: [{ name: 'people:applyAIDraft' }], codex_thread_id: 'thread-test-123' } }
    const response = await request.post('/api/automations/report', { headers: API_KEY_HEADER, data: { run: lastRun } })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json()
    if (taskId) expect(body.taskId).toBe(taskId)
    taskId = body.taskId
  }
  // Retried reports and delayed progress must not double-count or reopen a run.
  await request.post('/api/automations/report', { headers: API_KEY_HEADER, data: { run: lastRun } })
  await request.post('/api/automations/report', { headers: API_KEY_HEADER, data: { run: { ...lastRun, status: 'running' } } })
  const task = await (await request.get(`/api/tasks/${taskId}`, { headers: API_KEY_HEADER })).json()
  expect(task.task.title).toContain('100 completed')
  await page.goto(`/automations?agent=${agent}`)
  await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(25)
  await expect(page.getByText('1–25 of 100')).toBeVisible()
  await page.locator('tbody button').first().click()
  await expect(page.getByText('Wrote a short follow-up for Ada.')).toBeVisible()
  await page.getByText('Thread and execution details', { exact: true }).click()
  await expect(page.getByText('Thread: thread-test-123')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('26–50 of 100')).toBeVisible()
  await page.screenshot({ path: '/tmp/mission-control-automations.png', fullPage: true })
  const archived = await request.put(`/api/tasks/${taskId}`, { headers: API_KEY_HEADER, data: { archived_at: Math.floor(Date.now() / 1000) } })
  expect(archived.ok()).toBeTruthy()
  const newReport = await request.post('/api/automations/report', { headers: API_KEY_HEADER, data: { run: { ...lastRun, id: randomUUID() } } })
  expect((await newReport.json()).taskId).not.toBe(taskId)
  const oldTask = await (await request.get(`/api/tasks/${taskId}`, { headers: API_KEY_HEADER })).json()
  expect(oldTask.task.title).toContain('100 completed')
  expect((await request.get(`/api/v1/runs/${lastRun.id}`, { headers: API_KEY_HEADER })).ok()).toBeTruthy()
  expect(errors).toEqual([])
})
