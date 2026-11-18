import React from 'react';
import { X, FileCode, Copy, Check } from 'lucide-react';
import { Submission } from '../types';
import { formatPhilippineDateTime } from '../utils/dateTime';

interface CodeModalProps {
  submission: Submission | null;
  onClose: () => void;
  onLoadCode: (submission: Submission) => Promise<{ sourceCode: string; tokenCount: number | null }>;
}

export const CodeModal: React.FC<CodeModalProps> = ({ submission, onClose, onLoadCode }) => {
  const [copied, setCopied] = React.useState(false);
  const [code, setCode] = React.useState<string | null>(null);
  const [tokenCount, setTokenCount] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState(0);
  const [visibleLineCount, setVisibleLineCount] = React.useState(400);
  const submissionId = submission?.id;
  const lobbyId = submission?.lobbyId;

  React.useEffect(() => {
    if (!submission) return;
    let active = true;
    setCode(null);
    setVisibleLineCount(400);
    setTokenCount(null);
    setLoadError(null);
    setLoading(true);
    void onLoadCode(submission).then((result) => {
      if (!active) return;
      setCode(result.sourceCode);
      setTokenCount(result.tokenCount);
    }).catch((err: unknown) => {
      if (active) setLoadError(err instanceof Error ? err.message : 'Unable to load the saved code.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // The ID and retry counter define a fetch; parent callbacks need not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId, lobbyId, retry]);

  const lines = React.useMemo(() => code === null ? [] : code.split('\n'), [code]);
  const visibleLines = React.useMemo(() => lines.slice(0, visibleLineCount), [lines, visibleLineCount]);

  if (!submission) return null;

  const handleCopy = () => {
    if (code === null || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const getRiskClasses = (risk: string | null) => {
    if (risk === 'High') return 'text-ca-danger bg-ca-danger-soft border-ca-border';
    if (risk === 'Medium') return 'text-ca-warn bg-ca-warn-soft border-ca-border';
    if (risk === 'Low') return 'text-ca-ok bg-ca-ok-soft border-ca-border';
    return 'text-ca-muted bg-ca-bg-elevated border-ca-border';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-ca-overlay backdrop-blur-sm ca-fade-in">
      <div className="relative w-full max-w-4xl h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[90dvh] min-h-0 flex flex-col ca-panel !rounded-none sm:!rounded-2xl overflow-hidden">
        <div className="flex items-start sm:items-center justify-between gap-2 px-3 py-3 sm:px-6 sm:py-4 border-b border-ca-border bg-ca-surface-2">
          <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0">
            <div className="hidden sm:block p-2 rounded-xl bg-ca-brand-soft text-ca-brand border border-ca-border">
              <FileCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <h3 className="font-bold text-ca-ink text-sm sm:text-base min-w-0 break-all">{submission.fileName}</h3>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-ca-bg-elevated text-ca-muted border border-ca-border">
                  {submission.language}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-ca-muted break-words">
                Student ID:{' '}
                <span className="text-ca-brand font-mono font-bold">{submission.studentId}</span> •
                Submitted: {formatPhilippineDateTime(submission.submittedAt)} PHT
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button onClick={handleCopy} disabled={code === null} className="ca-btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-50">
              {copied ? <Check className="w-3.5 h-3.5 text-ca-ok" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden min-[375px]:inline">{copied ? 'Copied' : 'Copy Code'}</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Close code viewer"
              className="p-2 rounded-lg text-ca-muted hover:text-ca-ink hover:bg-ca-surface-hover transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-3 sm:px-6 py-3 bg-ca-bg-elevated border-b border-ca-border flex flex-wrap items-center justify-between gap-2 sm:gap-4 text-xs">
          <div className="grid grid-cols-3 gap-x-3 gap-y-2 w-full sm:w-auto sm:flex sm:items-center sm:gap-4 min-w-0">
            <div>
              <span className="text-ca-faint block text-[10px] uppercase font-bold">AI Probability</span>
              <span className="text-sm font-black font-mono text-ca-ink">
                {submission.status === 'done' && submission.aiProbability !== null
                  ? `${(submission.aiProbability * 100).toFixed(1)}%`
                  : '--'}
              </span>
            </div>
            <div>
              <span className="text-ca-faint block text-[10px] uppercase font-bold">Risk Assessment</span>
              <span
                className={`inline-block px-2 py-0.5 rounded-md font-bold text-xs border ${getRiskClasses(submission.riskLevel)}`}
              >
                {submission.riskLevel ? `${submission.riskLevel} RISK` : submission.status === 'failed' ? 'FAILED' : 'PENDING'}
              </span>
            </div>
            <div>
              <span className="text-ca-faint block text-[10px] uppercase font-bold">Token Count</span>
              <span className="font-mono text-ca-ink">{loading ? 'Loading…' : tokenCount === null ? 'Unavailable' : `${tokenCount} tokens`}</span>
            </div>
          </div>

          <div className="hidden sm:block text-right">
            <span className="text-ca-faint block text-[10px] uppercase font-bold">Model Engine</span>
            <span className="text-ca-brand font-mono">Frozen CodeBERT (770-dim)</span>
          </div>
        </div>

        {submission.status === 'failed' && submission.errorMessage && (
          <div role="alert" className="px-3 sm:px-6 py-2.5 bg-ca-danger-soft text-ca-danger text-xs border-b border-ca-border">
            Analysis failed: {submission.errorMessage}
          </div>
        )}

        {submission.indicators && submission.indicators.length > 0 && (
          <div className="px-3 sm:px-6 py-2.5 bg-ca-surface border-b border-ca-border text-xs flex flex-wrap items-center gap-2 text-ca-muted">
            <span className="font-bold text-ca-brand shrink-0">Signal Highlights:</span>
            <div className="flex flex-wrap gap-1.5">
              {submission.indicators.map((ind, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded bg-ca-bg-elevated text-ca-muted border border-ca-border text-[11px]"
                >
                  {ind}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 bg-ca-bg font-mono text-xs text-ca-ink ca-scroll">
          {loading && <p className="p-3 text-ca-muted">Loading saved code…</p>}
          {loadError && (
            <div className="p-3 text-ca-danger" role="alert">
              <p>{loadError}</p>
              <button className="ca-btn-secondary mt-3" onClick={() => setRetry((value) => value + 1)}>Retry loading code</button>
            </div>
          )}
          {!loading && !loadError && code !== null && (
          <div className="min-w-full">
            {visibleLines.map((line, idx) => (
              <div key={idx} className="flex w-max min-w-full hover:bg-ca-surface-hover py-0.5 px-1 sm:px-2 rounded">
                <span className="w-10 select-none text-ca-faint text-right pr-4 shrink-0 font-mono">
                  {idx + 1}
                </span>
                <span className="whitespace-pre text-ca-muted">{line || ' '}</span>
              </div>
            ))}
            {visibleLines.length < lines.length && (
              <button type="button" className="ca-code-more" onClick={() => setVisibleLineCount((count) => count + 400)}>
                Showing {visibleLines.length.toLocaleString()} of {lines.length.toLocaleString()} lines · Load next {Math.min(400, lines.length - visibleLines.length).toLocaleString()} lines
              </button>
            )}
          </div>
          )}
        </div>

        <div className="px-3 sm:px-6 py-2.5 sm:py-3 border-t border-ca-border bg-ca-surface-2 flex items-center justify-end sm:justify-between gap-3 text-xs text-ca-muted">
          <span className="hidden sm:inline">Treated purely as static text. Never compiled or executed.</span>
          <button onClick={onClose} className="ca-btn-primary !py-1.5 !px-4 text-xs">
            Done Reviewing
          </button>
        </div>
      </div>
    </div>
  );
};
