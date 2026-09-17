import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestTask, deleteTestTask } from './helpers'

test.describe('Task removal UI', () => {
  const username = `task-removal-ui-${Date.now()}`
  const password = 'task-removal-ui-pass!'
  const cleanup: number[] = []

  test.beforeAll(async ({ request }) => {
    const response = await request.post('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: { username, password, display_name: 'Task Removal UI', role: 'admin' },
    })
    expect(response.status()).toBe(201)
  })

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) await deleteTestTask(request, id).catch(() => {})
    cleanup.length = 0
  })

  test.beforeEach(async ({ page }) => {
    const response = await page.request.post('/api/auth/login', {
      data: { username, password },
      headers: { 'x-forwarded-for': '10.66.66.1' },
    })
    expect(response.status()).toBe(200)
    await page.addInitScript(() => sessionStorage.setItem('mc-onboarding-dismissed', '1'))
  })

  test('archiving and deleting from task details do not crash the board', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const archived = await createTestTask(request, { status: 'done' })
    const deleted = await createTestTask(request)
    expect(archived.res.status()).toBe(201)
    expect(deleted.res.status()).toBe(201)
    cleanup.push(archived.id, deleted.id)

    await page.goto('/tasks')
    await page.locator('[role="button"]').filter({ hasText: archived.title }).click()
    const archiveDialog = page.getByRole('dialog')
    await expect(archiveDialog).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`taskId=${archived.id}$`))
    await archiveDialog.getByRole('button', { name: 'Archive' }).click()
    await expect(archiveDialog).toBeHidden()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('button', { name: `${archived.title}, medium priority, done`, exact: true })).toHaveCount(0)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    await page.locator('[role="button"]').filter({ hasText: deleted.title }).click()
    const deleteDialog = page.getByRole('dialog')
    await expect(deleteDialog).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`taskId=${deleted.id}$`))
    page.once('dialog', dialog => dialog.accept())
    await deleteDialog.getByRole('button', { name: 'Delete' }).click()
    await expect(deleteDialog).toBeHidden()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('button', { name: `${deleted.title}, medium priority, inbox`, exact: true })).toHaveCount(0)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
