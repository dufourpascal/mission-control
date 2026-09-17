# CRM automation activity

This fork adds `/automations` for the NeuroQP CRM worker. CRM records and decisions
stay in the CRM. Mission Control shows worker health, triggers, individual runs,
results, inputs, proposed/applied CRM operations, and captured Codex thread events.
It provides Run now, Pause, Resume, and Retry controls for execution only.

The companion implementation is in `neuroqp/crm`, under `automations/worker`.
Install its dependencies, deploy its Convex hooks, and install its systemd user
service as described in that directory's README. It uses an authenticated local
HTTP server on `127.0.0.1:3667`. Mission Control runs on port 3666 on this machine.

The proxy uses Mission Control's API key by default. For a separate worker key,
set `CRM_WORKER_KEY` on Mission Control and `MC_API_KEY` on the worker. Optional
`CRM_WORKER_PORT` and `CRM_WORKER_WORKSPACE_ID` select the local port and workspace,
defaulting to 3667 and 1. The worker must belong to that workspace.

## Runs and the inbox

The worker sends bounded, idempotent reports to `/api/automations/report`. Runs use
the existing run store and API. History loads 25 summaries per page; full inputs
and captured events load when a run is opened. Worker heartbeats register the
logical agents and their triggers, including disabled automations.

Completed and failed attempts update one Done card per automation per Zurich day.
Archiving a card acknowledges the displayed outcomes. New outcomes create a new
card after archive. Individual runs remain available. Empty checks create no runs
or cards. Retry attempts appear separately in history.

When the worker is offline, history remains readable. The worker buffers reports
if Mission Control is unavailable. Pause finishes the active item and prevents new
claims; Run now checks pending CRM work rather than rerunning completed records.
There is no CRM approval or outreach-sending action in this screen.

## Verification

`tests/automation-activity.spec.ts` exercises 100 reports, pagination, readable
results, thread details, duplicate/delayed reports, and archive behavior in Chromium.
The companion CRM tests cover claims, retries, revisions, and transactional writes.
