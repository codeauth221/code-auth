import { useEffect, useState } from 'react';
import { Cpu, LoaderCircle, ShieldCheck, WifiOff } from 'lucide-react';
import { getAuthToken, getRemoteWorkerStatus, type RemoteWorkerStatus } from '../utils/api';

/** A tiny independent poll; does not refresh or re-render the full dashboard. */
export function RemoteWorkerStatusBanner() {
  const [status, setStatus] = useState<RemoteWorkerStatus | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (document.hidden) return;
      const token = getAuthToken();
      if (!token) return;
      try {
        const data = await getRemoteWorkerStatus(token);
        if (mounted) setStatus(data);
      } catch {
        // During staggered deployments the route may not exist yet.
        if (mounted) setStatus(null);
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 20_000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);
  if (!status || status.mode !== 'remote') return null;
  return (
    <div role="status" aria-live="polite" className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border px-3.5 py-3 sm:px-4 ${
      status.connected ? 'border-ca-ok/25 bg-ca-ok-soft' : 'border-ca-warn/30 bg-ca-brand-soft'
    }`}>
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ca-surface/75">
        {status.connected ? <ShieldCheck className="h-5 w-5 text-ca-ok" aria-hidden /> : <WifiOff className="h-5 w-5 text-ca-warn" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ca-ink">
          {status.connected ? 'AI Worker Connected' : 'AI Worker Offline'}
        </p>
        <p className="text-xs leading-relaxed text-ca-muted mt-0.5">
          {status.connected
            ? 'CodeBERT is available on the connected computer.'
            : 'Start START_AI_WORKER.bat on the designated computer. New submissions stay queued.'}
        </p>
      </div>
      <span className="text-[11px] font-mono text-ca-muted inline-flex gap-1.5 items-center self-start sm:self-center">
        {status.analyzing > 0 ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Cpu className="h-3.5 w-3.5" aria-hidden />}
        {status.queued} queued · {status.analyzing} analyzing
      </span>
    </div>
  );
}
