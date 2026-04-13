'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, Play, CheckCircle, XCircle, Clock, Loader2, ArrowLeft, ExternalLink, RotateCcw } from 'lucide-react';

interface BatchJobSummary {
  proposalId: string;
  proposalTitle: string;
  overallState: string;
  phase: number;
  error: string | null;
  productCount: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const STATE_CONFIG: Record<string, { label: string; badge: string; icon: React.ElementType }> = {
  PHASE1_RUNNING: { label: 'Phase 1 – Concepts', badge: 'bg-blue-100 text-blue-700 border-blue-200',   icon: Loader2 },
  PHASE2_RUNNING: { label: 'Phase 2 – Images',   badge: 'bg-purple-100 text-purple-700 border-purple-200', icon: Loader2 },
  COMPLETED:      { label: 'Completed',           badge: 'bg-green-100 text-green-700 border-green-200',   icon: CheckCircle },
  FAILED:         { label: 'Failed',              badge: 'bg-red-100 text-red-700 border-red-200',         icon: XCircle },
};

function elapsed(from: string, to?: string | null): string {
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function BatchJobsPage() {
  const [jobs, setJobs] = useState<BatchJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [workerResult, setWorkerResult] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-enrich-batch/queue');
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error('Failed to fetch batch jobs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const runWorker = async () => {
    setRunning(true);
    setWorkerResult(null);
    try {
      const res = await fetch('/api/ai-enrich-batch/worker', { method: 'POST' });
      const data = await res.json();
      setWorkerResult(`Worker ran: ${data.processed ?? 0} job(s) advanced.`);
      await fetchJobs();
    } catch (e) {
      setWorkerResult(`Worker error: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // Silently call the worker then refresh the job list
  const tickWorker = useCallback(async () => {
    try {
      await fetch('/api/ai-enrich-batch/worker', { method: 'POST' });
    } catch { /* silent */ }
    await fetchJobs();
  }, [fetchJobs]);

  // On mount: load jobs, then immediately advance any pending ones
  useEffect(() => {
    fetchJobs().then(() => {
      // run worker once right away so opening the page advances jobs immediately
      fetch('/api/ai-enrich-batch/worker', { method: 'POST' }).catch(() => {});
    });
  }, [fetchJobs]);

  // Auto-poll: call worker every 30s while there are pending jobs
  useEffect(() => {
    if (!autoRefresh) return;
    const hasPending = jobs.some(j => j.overallState === 'PHASE1_RUNNING' || j.overallState === 'PHASE2_RUNNING');
    if (!hasPending) return;
    const id = setInterval(tickWorker, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, jobs, tickWorker]);

  const handleResubmit = async (proposalId: string) => {
    setResetting(proposalId);
    try {
      const res = await fetch('/api/ai-enrich-batch/resubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Resubmit failed');
      await fetchJobs();
    } catch (e) {
      alert(`Resubmit failed: ${String(e)}`);
    } finally {
      setResetting(null);
    }
  };

  const pending = jobs.filter(j => j.overallState === 'PHASE1_RUNNING' || j.overallState === 'PHASE2_RUNNING');
  const done    = jobs.filter(j => j.overallState === 'COMPLETED' || j.overallState === 'FAILED');

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/proposals" className="text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Batch Jobs</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {lastRefreshed ? `Last refreshed ${lastRefreshed.toLocaleTimeString()}` : 'Loading…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={fetchJobs}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={runWorker}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-sky-500 rounded-lg hover:bg-sky-600 disabled:opacity-50 transition-colors"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Processing…' : 'Run Worker'}
          </button>
        </div>
      </div>

      {workerResult && (
        <div className="mb-4 px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-sm text-sky-700">
          {workerResult}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No batch jobs yet</p>
          <p className="text-sm mt-1">Submit a batch AI enrichment from a proposal to get started.</p>
        </div>
      ) : (
        <>
          {/* Pending jobs */}
          {pending.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                In Progress ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map(job => <JobRow key={job.proposalId} job={job} />)}
              </div>
            </section>
          )}

          {/* Finished jobs */}
          {done.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                History ({done.length})
              </h2>
              <div className="space-y-3">
                {done.map(job => (
                  <JobRow
                    key={job.proposalId}
                    job={job}
                    onResubmit={job.overallState === 'FAILED' ? () => handleResubmit(job.proposalId) : undefined}
                    resetting={resetting === job.proposalId}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

interface JobRowProps {
  job: BatchJobSummary;
  onResubmit?: () => void;
  resetting?: boolean;
}

function JobRow({ job, onResubmit, resetting }: JobRowProps) {
  const cfg = STATE_CONFIG[job.overallState] ?? { label: job.overallState, badge: 'bg-gray-100 text-gray-600 border-gray-200', icon: Clock };
  const Icon = cfg.icon;
  const isRunning = job.overallState === 'PHASE1_RUNNING' || job.overallState === 'PHASE2_RUNNING';
  const duration = elapsed(job.startedAt, job.completedAt);

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Status badge */}
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${cfg.badge}`}>
        <Icon className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
        {cfg.label}
      </span>

      {/* Proposal info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{job.proposalTitle}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {job.productCount} product{job.productCount !== 1 ? 's' : ''} · Started {fmt(job.startedAt)}
          {job.completedAt ? ` · Finished ${fmt(job.completedAt)}` : ''}
        </p>
        {job.error && (
          <p className="text-xs text-red-600 mt-1 truncate" title={job.error}>{job.error}</p>
        )}
      </div>

      {/* Duration */}
      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-gray-700">{duration}</p>
        <p className="text-xs text-gray-400">{isRunning ? 'elapsed' : 'total'}</p>
      </div>

      {/* Resubmit button (failed jobs only) */}
      {onResubmit && (
        <button
          onClick={onResubmit}
          disabled={resetting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors shrink-0"
          title="Clear failed job and go back to proposal to resubmit"
        >
          {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Resubmit
        </button>
      )}

      {/* Link to proposal */}
      <Link
        href={`/proposals/${job.proposalId}`}
        className="text-gray-400 hover:text-sky-500 transition-colors ml-1"
        title="View proposal"
      >
        <ExternalLink className="h-4 w-4" />
      </Link>
    </div>
  );
}
