import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { createRun, getRun, updateRun, type AgentRun } from '@/lib/runs'
import { eventBus } from '@/lib/event-bus'

const report = z.object({ run: z.object({
  id: z.string().uuid(), agent_id: z.string().min(1).max(100), agent_name: z.string().min(1).max(100),
  status: z.enum(['running', 'completed', 'failed']), started_at: z.string().datetime(), ended_at: z.string().datetime().optional(),
  outcome: z.enum(['success', 'failed', 'partial', 'abandoned']).optional(), duration_ms: z.number().nonnegative().optional(),
  error: z.string().max(8000).optional(), model: z.string().max(100).optional(), runtime: z.string().max(100).optional(),
  provider: z.string().max(100).optional(), trigger: z.enum(['queue', 'cron', 'manual']).optional(),
  steps: z.array(z.object({ id: z.string(), type: z.enum(['message', 'reasoning', 'tool_result', 'error']), started_at: z.string(), output_preview: z.string().max(9000), success: z.boolean() })).max(150),
  cost: z.object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative(), cache_read_tokens: z.number().nonnegative().optional() }),
  metadata: z.record(z.string(), z.unknown()),
}) })

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const raw = await request.text()
  if (raw.length > 2_000_000) return NextResponse.json({ error: 'Report too large' }, { status: 413 })
  let parsed
  try { parsed = report.safeParse(JSON.parse(raw)) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!parsed.success) return NextResponse.json({ error: 'Invalid automation report' }, { status: 400 })
  const ws = auth.user.workspace_id ?? 1
  const run = parsed.data.run as AgentRun
  const db = getDatabase()
  let taskId: number | null = null
  db.transaction(() => {
    const previous = getRun(run.id, ws)
    // Ignore delayed progress reports after an outcome has already been recorded.
    if (previous && previous.status !== 'running') return
    if (previous) updateRun(run.id, run, ws)
    else createRun({ ...run, provenance: { run_hash: '' }, tags: ['automation'] }, ws)
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO agents (name, role, status, runtime_type, config, last_seen, created_at, updated_at, workspace_id)
      VALUES (?, 'automation', ?, 'custom', ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
      .run(run.agent_name, run.status === 'running' ? 'busy' : 'idle', JSON.stringify({ framework: 'codex-sdk' }), now, now, now, ws)
    db.prepare('UPDATE agents SET status = ?, last_seen = ?, last_activity = ?, updated_at = ? WHERE name = ? AND workspace_id = ?')
      .run(run.status === 'running' ? 'busy' : 'idle', now, String(run.metadata?.title || run.status), now, run.agent_name, ws)
    if (run.status === 'running') return
    const day = new Date(run.started_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
    const group = `${run.agent_name}:${day}`
    const task = db.prepare(`SELECT id, metadata FROM tasks WHERE workspace_id = ? AND archived_at IS NULL AND status = 'done' AND json_extract(metadata, '$.automation_group') = ? ORDER BY id DESC LIMIT 1`).get(ws, group) as { id: number; metadata: string } | undefined
    const counts = task ? JSON.parse(task.metadata) : { automation_group: group, completed: 0, failed: 0 }
    counts[run.status === 'completed' ? 'completed' : 'failed']++
    const title = `${run.agent_name}: ${counts.completed} completed${counts.failed ? `, ${counts.failed} failed` : ''}`
    const resolution = `Automation activity for ${day}.\n\n${counts.completed} completed${counts.failed ? `; ${counts.failed} failed` : ''}.\n\n[View results and run history](/automations?agent=${encodeURIComponent(run.agent_id)})`
    if (task) {
      taskId = task.id
      db.prepare('UPDATE tasks SET title = ?, resolution = ?, metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(title, resolution, JSON.stringify(counts), now, task.id, ws)
    } else {
      taskId = Number(db.prepare(`INSERT INTO tasks (title, description, resolution, status, priority, assigned_to, created_by, created_at, updated_at, completed_at, metadata, workspace_id) VALUES (?, ?, ?, 'done', 'medium', ?, 'automation-worker', ?, ?, ?, ?, ?)`).run(title, 'Activity summary. Archiving acknowledges this report without changing CRM records.', resolution, run.agent_name, now, now, now, JSON.stringify(counts), ws).lastInsertRowid)
    }
    db.prepare('UPDATE runs SET task_id = ? WHERE id = ? AND workspace_id = ?').run(String(taskId), run.id, ws)
  })()
  if (taskId) eventBus.broadcast('task.updated', { id: taskId, workspace_id: ws })
  return NextResponse.json({ id: run.id, taskId })
}
