import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const parsed = z.object({ agents: z.array(z.object({ name: z.string().min(1).max(100), trigger: z.string().max(200), busy: z.boolean(), enabled: z.boolean() })).max(10) }).safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid heartbeat' }, { status: 400 })
  const db = getDatabase(), ws = auth.user.workspace_id ?? 1, now = Math.floor(Date.now() / 1000)
  for (const agent of parsed.data.agents) {
    const config = JSON.stringify({ framework: 'codex-sdk', trigger: agent.trigger, enabled: agent.enabled, activity_url: '/automations' })
    db.prepare(`INSERT INTO agents (name, role, status, runtime_type, config, last_seen, created_at, updated_at, workspace_id) VALUES (?, 'automation', 'idle', 'custom', ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(agent.name, config, now, now, now, ws)
    db.prepare('UPDATE agents SET status = ?, config = ?, last_seen = ?, updated_at = ? WHERE name = ? AND workspace_id = ?').run(agent.busy ? 'busy' : 'idle', config, now, now, agent.name, ws)
  }
  return NextResponse.json({ ok: true })
}
