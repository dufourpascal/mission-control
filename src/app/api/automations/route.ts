import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

async function forward(request: NextRequest, write: boolean) {
  const auth = requireRole(request, write ? 'operator' : 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // This local worker belongs to one explicitly configured workspace.
  if ((auth.user.workspace_id ?? 1) !== Number(process.env.CRM_WORKER_WORKSPACE_ID || 1)) return NextResponse.json({ error: 'Worker not configured for this workspace' }, { status: 404 })
  const params = request.nextUrl.searchParams
  const action = params.get('action') || 'status'
  if (!(write ? ['run', 'pause', 'resume', 'retry'] : ['status', 'jobs']).includes(action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  const target = new URL(`http://127.0.0.1:${process.env.CRM_WORKER_PORT || '3667'}/${action}`)
  for (const key of ['cursor', 'id']) if (params.has(key)) target.searchParams.set(key, params.get(key)!)
  try {
    const response = await fetch(target, { method: write ? 'POST' : 'GET', headers: { 'x-api-key': process.env.CRM_WORKER_KEY || process.env.API_KEY || '' }, cache: 'no-store', signal: AbortSignal.timeout(8000) })
    // A worker credential mismatch must not log the dashboard user out.
    if (response.status === 401) return NextResponse.json({ error: 'CRM worker authentication failed. Check the worker API key.' }, { status: 502 })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ error: 'CRM worker is offline. Previous runs are still available below.' }, { status: 503 })
  }
}
export async function GET(request: NextRequest) { return forward(request, false) }
export async function POST(request: NextRequest) { return forward(request, true) }
