'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { Button } from '@/components/ui/button'
import type { AgentRun } from '@/lib/runs'

type WorkerStatus = { paused: boolean; active: { title: string; kind: string } | null; lastConnection: string | null; lastError: string | null; fallback: string; automations: { id: string; name: string; trigger: string; enabled: boolean }[] }
type Job = { _id: string; kind: string; status: string; attempts: number; summary?: string; updatedAt: number }
const names: Record<string, string> = { 'crm-research': 'CRM research', 'crm-drafts': 'CRM drafts', 'crm-publications': 'Publication research', 'crm-intake': 'Publication discovery' }

export function AutomationActivityPanel() {
  const params = useSearchParams()
  const [agent, setAgent] = useState(params.get('agent') || '')
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [total, setTotal] = useState(0)
  const [worker, setWorker] = useState<WorkerStatus | null>(null)
  const [workerError, setWorkerError] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AgentRun | null>(null)
  const [pending, setPending] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [showJobs, setShowJobs] = useState(false)
  const load = useCallback(async () => {
    const query = new URLSearchParams({ limit: '25', offset: String(offset), automation: '1', summaries: '1' })
    if (agent) query.set('agent_id', agent)
    if (filter) query.set('status', filter)
    await Promise.all([
      apiFetch<{ runs: AgentRun[]; total: number }>(`/api/v1/runs?${query}`).then(data => { setRuns(data.runs); setTotal(data.total); setError('') }).catch(e => setError(e.message)),
      apiFetch<WorkerStatus>('/api/automations').then(data => { setWorker(data); setWorkerError('') }).catch(e => { setWorker(null); setWorkerError(e.message) }),
    ])
  }, [agent, filter, offset])
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15_000); return () => clearInterval(timer) }, [load])
  const loadJobs = useCallback(async () => {
    if (!showJobs) return
    try {
      const data = await apiFetch<{ page: Job[]; isDone: boolean; continueCursor: string }>(`/api/automations?action=jobs${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      setJobs(data.page); setNextCursor(data.isDone ? null : data.continueCursor)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load queue') }
  }, [cursor, showJobs])
  useEffect(() => { void loadJobs() }, [loadJobs])
  async function control(action: string, id?: string) {
    setPending(true)
    try { await apiFetch(`/api/automations?action=${action}${id ? `&id=${encodeURIComponent(id)}` : ''}`, { method: 'POST' }); await load(); await loadJobs() }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed') }
    finally { setPending(false) }
  }
  async function openRun(id: string) {
    try { const data = await apiFetch<AgentRun>(`/api/v1/runs/${id}`); setSelected(data) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load result') }
  }
  return <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Automations</h1><p className="text-sm text-muted-foreground mt-1">CRM activity and results. CRM records continue to update automatically.</p></div>
      <div className="flex gap-2"><Button variant="secondary" disabled={pending || !worker || worker.paused} onClick={() => control('run')}>Run now</Button><Button variant="outline" disabled={pending || !worker} onClick={() => control(worker?.paused ? 'resume' : 'pause')}>{worker?.paused ? 'Resume' : 'Pause'}</Button></div>
    </div>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <section className="rounded-lg border border-border divide-y divide-border">
      <div className="p-4 flex flex-wrap justify-between gap-2"><span className="font-medium">{worker ? worker.paused ? 'Paused' : worker.active ? `Running: ${worker.active.title}` : 'Listening for CRM changes' : 'Worker offline'}</span><span className="text-sm text-muted-foreground">{worker?.lastConnection ? `Last connected ${new Date(worker.lastConnection).toLocaleTimeString()}` : workerError}</span></div>
      {worker?.lastError && <p className="p-4 text-amber-400">{worker.lastError}</p>}
      {(worker?.automations || Object.entries(names).filter(([id]) => id !== 'crm-intake').map(([id, name]) => ({ id, name, trigger: 'Worker unavailable', enabled: false }))).map(item => <div className="p-4 grid gap-1 sm:grid-cols-3 text-sm" key={item.id}><button className="text-left text-primary hover:underline" onClick={() => { setAgent(item.id); setOffset(0) }}>{item.name}</button><span>{item.trigger}</span><span className="text-muted-foreground sm:text-right">{item.enabled ? 'Enabled' : !worker ? 'Offline' : worker.paused ? 'Paused' : 'Disabled'}</span></div>)}
      {worker && <p className="p-4 text-xs text-muted-foreground">Fallback: {worker.fallback}. One item runs at a time.</p>}
    </section>
    <div className="flex flex-wrap gap-3 items-center"><h2 className="text-lg font-medium mr-auto">Run history</h2>
      <select aria-label="Automation" className="bg-card border border-border rounded p-2" value={agent} onChange={e => { setAgent(e.target.value); setOffset(0); setSelected(null) }}><option value="">All automations</option>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label="Run status" className="bg-card border border-border rounded p-2" value={filter} onChange={e => { setFilter(e.target.value); setOffset(0); setSelected(null) }}><option value="">All outcomes</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option></select>
      <Button variant="ghost" onClick={() => { void load(); if (selected) void openRun(selected.id) }}>Refresh</Button>
    </div>
    <div className="overflow-x-auto border border-border rounded-lg"><table className="w-full text-sm text-left"><thead className="bg-surface-2 text-muted-foreground"><tr><th className="p-3">Work</th><th className="p-3">Automation</th><th className="p-3">Started</th><th className="p-3">Outcome</th></tr></thead><tbody className="divide-y divide-border">{runs.map(run => <tr key={run.id} className="hover:bg-surface-2"><td className="p-3"><button className="text-primary text-left hover:underline" onClick={() => openRun(run.id)}>{String(run.metadata?.title || 'View run')}</button></td><td className="p-3">{names[run.agent_id] || run.agent_name}</td><td className="p-3 whitespace-nowrap">{new Date(run.started_at).toLocaleString()}</td><td className={`p-3 ${run.status === 'failed' ? 'text-red-400' : run.status === 'completed' ? 'text-green-400' : 'text-primary'}`}>{run.status}</td></tr>)}</tbody></table>{!runs.length && <p className="p-6 text-muted-foreground">No runs to show.</p>}</div>
    <div className="flex justify-between items-center text-sm"><span>{total ? `${offset + 1}–${Math.min(offset + 25, total)} of ${total}` : '0 runs'}</span><div className="flex gap-2"><Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button><Button variant="outline" disabled={offset + 25 >= total} onClick={() => setOffset(offset + 25)}>Next</Button></div></div>
    {selected && <section aria-label="Run details" className="rounded-lg border border-border p-5 space-y-4">
      <div className="flex justify-between gap-3"><h2 className="text-lg font-medium">{String(selected.metadata?.title || 'Run details')}</h2><Button variant="ghost" onClick={() => setSelected(null)}>Close details</Button></div>
      <MarkdownRenderer content={String(selected.metadata?.result || selected.error || (selected.status === 'running' ? 'Work is in progress.' : 'No summary available.'))} />
      <p className="text-xs text-muted-foreground">{selected.model} · {selected.cost.input_tokens + selected.cost.output_tokens} tokens{selected.duration_ms ? ` · ${Math.round(selected.duration_ms / 1000)} seconds` : ''}</p>
      <a className="text-sm text-primary hover:underline" href="https://crm.neuroqp.com" target="_blank" rel="noreferrer">Open CRM</a>
      <details><summary className="cursor-pointer text-sm">Input</summary><pre className="mt-3 whitespace-pre-wrap break-all text-xs max-h-96 overflow-auto">{JSON.stringify(selected.metadata?.input, null, 2)}</pre></details>
      <details><summary className="cursor-pointer text-sm">CRM updates</summary><pre className="mt-3 whitespace-pre-wrap break-all text-xs max-h-96 overflow-auto">{JSON.stringify(selected.metadata?.operations || [], null, 2)}</pre></details>
      <details><summary className="cursor-pointer text-sm">Thread and execution details</summary><p className="my-3 text-xs break-all">Thread: {String(selected.metadata?.codex_thread_id || 'Not available')}</p>{Boolean(selected.metadata?.events_truncated) && <p className="text-xs text-muted-foreground">Showing the latest captured events.</p>}<div className="space-y-3 max-h-96 overflow-auto">{selected.steps.map((step, index) => <pre key={`${step.id}-${index}`} className="whitespace-pre-wrap break-all text-xs p-3 bg-surface-2 rounded">{step.output_preview}</pre>)}</div></details>
    </section>}
    <section className="border-t border-border pt-4"><Button variant="ghost" onClick={() => setShowJobs(!showJobs)}>{showJobs ? 'Hide processing queue' : 'Show processing queue'}</Button>{showJobs && <div className="mt-3 space-y-2">{jobs.map(job => <div key={job._id} className="flex flex-wrap justify-between gap-2 p-3 border border-border rounded text-sm"><div>{job.kind} · {job.status}<p className="text-xs text-muted-foreground">{job.summary || `${job.attempts} attempts`}</p></div>{job.status === 'failed' && <Button variant="outline" disabled={pending} onClick={() => control('retry', job._id)}>Retry</Button>}</div>)}<div className="flex gap-2"><Button variant="outline" disabled={!cursor} onClick={() => setCursor(null)}>First page</Button><Button variant="outline" disabled={!nextCursor} onClick={() => setCursor(nextCursor)}>Next page</Button><Button variant="ghost" onClick={() => void loadJobs()}>Refresh queue</Button></div></div>}</section>
  </div>
}
