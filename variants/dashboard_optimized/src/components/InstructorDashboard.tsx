import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Copy,
  Check,
  Lock,
  Unlock,
  Download,
  Trash2,
  Users,
  FileCode,
  CheckCircle2,
  Search,
  Eye,
  ExternalLink,
  BookOpen,
  LayoutDashboard,
  Layers,
  ChevronDown,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  ArrowUpRight,
  RefreshCw,
  LoaderCircle,
  CircleCheck,
} from 'lucide-react';
import { Instructor, Language, Lobby, RiskLevel, Submission, Theme } from '../types';
import { CodeModal } from './CodeModal';
import { formatPhilippineDateTime, formatPhilippineTime } from '../utils/dateTime';

/** Duration is measured by backend status-transition timestamps (not a simulated progress percentage). */
function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return minutes < 60 ? `${minutes}m ${remainder}s` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function elapsedSince(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  const start = Date.parse(value);
  if (!Number.isFinite(start)) return null;
  return Math.max(0, (nowMs - start) / 1000);
}

function analysisClock(sub: Submission, nowMs: number): string | null {
  if (sub.status === 'pending') {
    const seconds = elapsedSince(sub.submittedAt, nowMs);
    return seconds === null ? 'Queued' : `Queued · ${durationLabel(seconds)}`;
  }
  if (sub.status === 'analyzing') {
    const seconds = elapsedSince(sub.analysisStartedAt || sub.submittedAt, nowMs);
    return seconds === null ? 'Analyzing' : `Analyzing · ${durationLabel(seconds)}`;
  }
  if (!sub.analysisStartedAt || !sub.analysisFinishedAt) return null;
  const startMs = Date.parse(sub.analysisStartedAt);
  const endMs = Date.parse(sub.analysisFinishedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const worked = durationLabel((endMs - startMs) / 1000);
  return sub.status === 'done' ? `Worked for ${worked}` : `Stopped after ${worked}`;
}

/** Only the visible duration label ticks. Never re-render the entire 70KB
 * instructor dashboard, its charts, and both result layouts every second. */
const AnalysisTiming = React.memo(function AnalysisTiming({
  submission,
  className,
  missingClassName,
}: {
  submission: Submission;
  className: string;
  missingClassName?: string;
}) {
  const isRunning = submission.status === 'pending' || submission.status === 'analyzing';
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning, submission.status, submission.analysisStartedAt, submission.submittedAt]);

  const label = analysisClock(submission, nowMs);
  if (label) {
    return <span className={className} title="Server-recorded processing time; queued time is shown separately">{label}</span>;
  }
  if (submission.status === 'done') {
    return <span className={missingClassName ?? className} title="No analysis timestamps were saved for this record.">Duration not recorded</span>;
  }
  return null;
});

type InstructorSection = 'dashboard' | 'lobbies' | 'submissions';

interface InstructorDashboardProps {
  instructor: Instructor;
  lobbies: Lobby[];
  submissions: Submission[];
  onCreateLobby: (lobbyData: {
    subject: string;
    title: string;
    language: Language;
    durationMinutes: number;
    maxStudents: number;
  }) => Promise<Lobby>;
  onToggleLock: (lobbyId: string) => Promise<void>;
  onExtendAndReopen: (lobbyId: string, durationMinutes: number) => Promise<void>;
  onDeleteLobby: (lobbyId: string) => Promise<void>;
  onSwitchToStudentView: (lobbyCode: string) => void;
  onRefresh: () => Promise<void>;
  onActiveLobbyChange: (lobbyId: string | null) => void;
  onLoadSubmissionCode: (submission: Submission) => Promise<{ sourceCode: string; tokenCount: number | null }>;
  errorMessage: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export const InstructorDashboard: React.FC<InstructorDashboardProps> = ({
  instructor,
  lobbies,
  submissions,
  onCreateLobby,
  onToggleLock,
  onExtendAndReopen,
  onDeleteLobby,
  onSwitchToStudentView,
  onRefresh,
  onActiveLobbyChange,
  onLoadSubmissionCode,
  errorMessage,
}) => {
  const [section, setSection] = useState<InstructorSection>('dashboard');
  const [selectedLobbyId, setSelectedLobbyId] = useState<string>(
    lobbies.length > 0 ? lobbies[0].id : ''
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [inspectedSubmission, setInspectedSubmission] = useState<Submission | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingLobbyId, setDeletingLobbyId] = useState<string | null>(null);
  const [updatingLobbyId, setUpdatingLobbyId] = useState<string | null>(null);
  const [extendLobbyId, setExtendLobbyId] = useState<string | null>(null);
  const [extendMinutes, setExtendMinutes] = useState(60);
  const [extendError, setExtendError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<Language>('python');
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [maxStudents, setMaxStudents] = useState(35);

  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'All' | RiskLevel>('All');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [lobbyMenuOpen, setLobbyMenuOpen] = useState(false);
  const lobbyMenuRef = useRef<HTMLDivElement>(null);

  const activeLobby = lobbies.find((l) => l.id === selectedLobbyId) || lobbies[0];
  // Derive expiry from server UTC timestamps, regardless of the stored LOCKED label.
  // Database status remains backwards-compatible: ACTIVE or LOCKED only.
  const isExpired = (lobby: Lobby): boolean => {
    const time = Date.parse(lobby.expiresAt);
    return Number.isFinite(time) && time <= Date.now();
  };
  const activeLobbyExpired = activeLobby ? isExpired(activeLobby) : false;
  const extendLobby = lobbies.find((lobby) => lobby.id === extendLobbyId) || null;
  useEffect(() => {
    onActiveLobbyChange(activeLobby?.id ?? null);
  }, [activeLobby?.id, onActiveLobbyChange]);

  useEffect(() => {
    if (!lobbyMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!lobbyMenuRef.current?.contains(event.target as Node)) {
        setLobbyMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLobbyMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [lobbyMenuOpen]);

  const lobbySubmissions = submissions.filter(
    (s) => s.lobbyId === (activeLobby ? activeLobby.id : '')
  );

  // These are database job states, not a guessed percentage of ML progress.
  const analyzingCount = lobbySubmissions.filter((sub) => sub.status === 'analyzing').length;
  const queuedCount = lobbySubmissions.filter((sub) => sub.status === 'pending').length;
  const unfinishedCount = analyzingCount + queuedCount;
  const firstUnfinishedSubmission = lobbySubmissions.find(
    (sub) => sub.status === 'analyzing' || sub.status === 'pending',
  );
  // Keep the latest completed result visible when the processing banner closes.
  // The elapsed duration is calculated only from saved server timestamps.
  const latestCompletedSubmission = lobbySubmissions
    .filter((sub) => sub.status === 'done')
    .reduce<Submission | null>((latest, sub) => {
      if (!latest) return sub;
      const candidateTime = Date.parse(sub.submittedAt);
      const latestTime = Date.parse(latest.submittedAt);
      return Number.isFinite(candidateTime) && (!Number.isFinite(latestTime) || candidateTime > latestTime)
        ? sub : latest;
    }, null);
  const latestCompletedTime = latestCompletedSubmission
    ? analysisClock(latestCompletedSubmission, Date.now())
    : null;

  const displayedSubmissions = lobbySubmissions.filter((sub) => {
    const matchesSearch =
      sub.studentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.language.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRisk = riskFilter === 'All' || sub.riskLevel === riskFilter;
    return matchesSearch && matchesRisk;
  });

  const uniqueStudents = new Set(lobbySubmissions.map((s) => s.studentId)).size;
  const highRiskCount = lobbySubmissions.filter((s) => s.riskLevel === 'High').length;
  const mediumRiskCount = lobbySubmissions.filter((s) => s.riskLevel === 'Medium').length;
  const lowRiskCount = lobbySubmissions.filter((s) => s.riskLevel === 'Low').length;

  const totalHighRisk = submissions.filter((s) => s.riskLevel === 'High').length;
  const activeLobbyCount = lobbies.filter((l) => l.status === 'ACTIVE').length;
  const completedAnalyses = submissions.filter((s) => s.status === 'done' && s.aiProbability !== null).length;
  const pendingOrFailedAnalyses = submissions.length - completedAnalyses;

  const handleCreateLobbySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !title.trim()) return;

    setCreateError(null);
    setIsCreating(true);
    try {
      const newLobby = await onCreateLobby({
        subject: subject.trim(),
        title: title.trim(),
        language,
        durationMinutes: Number(durationMinutes),
        maxStudents: Number(maxStudents),
      });

      setSelectedLobbyId(newLobby.id);
      setShowCreateModal(false);
      setSubject('');
      setTitle('');
      setLanguage('python');
      setSection('lobbies');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create the lobby.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyCode = () => {
    if (!activeLobby) return;
    if (!navigator.clipboard?.writeText) {
      window.prompt('Share this lobby code:', activeLobby.code);
      return;
    }
    navigator.clipboard.writeText(activeLobby.code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }).catch(() => {
      window.prompt('Share this lobby code:', activeLobby.code);
    });
  };

  const handleCopyLink = () => {
    if (!activeLobby) return;
    if (!activeLobby.shareableUrl) {
      setActionError('This lobby does not have a shareable link yet. Refresh and try again.');
      return;
    }
    const url = activeLobby.shareableUrl;
    if (!navigator.clipboard?.writeText) {
      window.prompt('Share this lobby link:', url);
      return;
    }
    navigator.clipboard.writeText(url).then(() => {
      setActionError(null);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }).catch(() => {
      window.prompt('Share this lobby link:', url);
    });
  };

  const handleToggleActiveLobby = async () => {
    if (!activeLobby || updatingLobbyId || deletingLobbyId) return;
    setActionError(null);
    if (isExpired(activeLobby)) {
      setExtendError(null);
      setExtendMinutes(60);
      setExtendLobbyId(activeLobby.id);
      return;
    }
    setUpdatingLobbyId(activeLobby.id);
    try {
      await onToggleLock(activeLobby.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update the lobby.');
    } finally {
      setUpdatingLobbyId(null);
    }
  };

  const handleExtendLobby = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!extendLobby || updatingLobbyId || deletingLobbyId) return;
    if (!Number.isInteger(extendMinutes) || extendMinutes < 10 || extendMinutes > 1440) {
      setExtendError('Choose a whole number of minutes between 10 and 1440.');
      return;
    }
    setExtendError(null);
    setUpdatingLobbyId(extendLobby.id);
    try {
      await onExtendAndReopen(extendLobby.id, extendMinutes);
      setActionError(null);
      setExtendLobbyId(null);
    } catch (error) {
      setExtendError(error instanceof Error ? error.message : 'Could not extend this lobby.');
    } finally {
      setUpdatingLobbyId(null);
    }
  };

  const handleDeleteActiveLobby = async () => {
    if (!activeLobby || updatingLobbyId || deletingLobbyId) return;
    const confirmed = window.confirm(
      `Delete "${activeLobby.subject}${activeLobby.title ? ` - ${activeLobby.title}` : ''}"?\n\nThis also permanently deletes all submissions in this lobby.`,
    );
    if (!confirmed) return;

    setActionError(null);
    setDeletingLobbyId(activeLobby.id);
    try {
      await onDeleteLobby(activeLobby.id);
      setSelectedLobbyId('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to delete the lobby.');
    } finally {
      setDeletingLobbyId(null);
    }
  };

  const handleExportCSV = () => {
    if (!activeLobby || lobbySubmissions.length === 0) {
      alert('No submissions in this lobby to export.');
      return;
    }

    const headers = [
      'Student ID',
      'File Name',
      'Language',
      'AI Probability (%)',
      'Risk Level',
      'Token Count',
      'Submitted At',
    ];

    const rows = lobbySubmissions.map((sub) => [
      sub.studentId,
      sub.fileName,
      sub.language,
      sub.aiProbability !== null ? (sub.aiProbability * 100).toFixed(1) : 'N/A',
      sub.riskLevel || 'N/A',
      sub.tokenCount ?? 'N/A (open Inspect)',
      `${formatPhilippineDateTime(sub.submittedAt)} PHT`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${val}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `codeauthentic_${activeLobby.code}_${activeLobby.subject.replace(/[^a-zA-Z0-9]/g, '_')}_grades.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const navItemClass = (active: boolean) =>
    `ca-side-nav-item min-w-0 w-full flex flex-col sm:flex-row lg:flex-row items-center justify-center lg:justify-start gap-1 sm:gap-2.5 px-1.5 sm:px-3.5 py-2.5 lg:py-3 text-[11px] sm:text-sm font-semibold transition-colors cursor-pointer ${
      active ? 'is-active' : ''
    }`;

  const selectLobby = (lobbyId: string) => {
    if (activeLobby?.id === lobbyId) return;
    setSelectedLobbyId(lobbyId);
    // Other lobbies are updated by fallback polling, so fetch once when the
    // instructor explicitly switches to one that was not being observed.
    void onRefresh();
  };

  return (
    <div className="ca-instructor-shell flex flex-col lg:flex-row gap-3 lg:gap-6 py-0 sm:py-2 min-w-0 lg:min-h-[calc(100vh-8rem)]">
      <aside className="ca-instructor-side w-full lg:w-64 min-w-0 shrink-0">
        <div className="ca-sidebar-panel lg:sticky lg:top-[6.75rem] flex flex-col gap-2 lg:min-h-[calc(100vh-9.5rem)]">
          <div className="ca-sidebar-profile hidden lg:flex">
            <div className="ca-sidebar-avatar" aria-hidden="true">{instructor.name.trim().charAt(0).toUpperCase() || 'I'}</div>
            <div className="min-w-0">
              <p className="ca-sidebar-overline">INSTRUCTOR ACCOUNT</p>
              <p className="text-sm font-bold text-ca-ink truncate">{instructor.name}</p>
              <p className="text-[11px] text-ca-muted font-mono truncate">{instructor.idNumber}</p>
            </div>
          </div>
          <p className="ca-sidebar-section-label hidden lg:block">WORKSPACE</p>
          <nav className="ca-sidebar-nav grid grid-cols-3 lg:flex lg:flex-col gap-1 min-w-0" aria-label="Instructor workspace">
            <button type="button" onClick={() => setSection('dashboard')} className={navItemClass(section === 'dashboard')} aria-current={section === 'dashboard' ? 'page' : undefined}>
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>Dashboard</span>
            </button>
            <button type="button" onClick={() => setSection('lobbies')} className={navItemClass(section === 'lobbies')} aria-current={section === 'lobbies' ? 'page' : undefined}>
              <Layers className="w-4 h-4 shrink-0" />
              <span className="lg:whitespace-nowrap"><span className="lg:hidden">Lobbies</span><span className="hidden lg:inline">Examination Lobbies</span></span>
            </button>
            <button type="button" onClick={() => setSection('submissions')} className={navItemClass(section === 'submissions')} aria-current={section === 'submissions' ? 'page' : undefined}>
              <FileCode className="w-4 h-4 shrink-0" />
              <span className="lg:whitespace-nowrap"><span className="lg:hidden">Submissions</span><span className="hidden lg:inline">Live Student Submissions</span></span>
            </button>
          </nav>
          <div className="ca-sidebar-bottom hidden lg:block">
            <div className="ca-sidebar-assurance">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <div>
                <p className="text-xs font-bold">Review with context</p>
                <p className="text-[11px] leading-relaxed mt-1">AI indicators support instructor review. They are not proof of authorship.</p>
              </div>
            </div>
            <p className="ca-sidebar-footer-caption">CODEAUTHENTIC · INSTRUCTOR CONSOLE</p>
          </div>
        </div>
      </aside>

      <div className="ca-instructor-main flex-1 min-w-0 space-y-4 sm:space-y-6">
        {(errorMessage || actionError) && (
          <div className="rounded-xl border border-ca-border bg-ca-danger-soft px-4 py-3 text-sm text-ca-danger">
            {actionError || errorMessage}
          </div>
        )}
        {section === 'dashboard' && (
          <div className="space-y-4 sm:space-y-6 ca-fade-up">
            <div className="ca-screen-hero ca-screen-hero--dashboard flex flex-col xl:flex-row xl:items-center justify-between gap-5">
              <div className="ca-screen-hero-copy min-w-0">
                <p className="ca-screen-eyebrow"><Sparkles className="w-3.5 h-3.5" /> INSTRUCTOR / OVERVIEW</p>
                <h1 className="ca-screen-title font-display">Your exam workspace<span className="ca-title-dot">.</span></h1>
                <p className="ca-screen-subtitle">Manage examination sessions, review student uploads, and monitor analysis results in one place.</p>
                <div className="ca-screen-hero-meta">
                  <span><span className="ca-live-dot" /> {activeLobbyCount} active {activeLobbyCount === 1 ? 'lobby' : 'lobbies'}</span>
                  <span>{completedAnalyses} completed {completedAnalyses === 1 ? 'analysis' : 'analyses'}</span>
                </div>
              </div>
              <div className="ca-hero-actions grid grid-cols-2 sm:flex sm:items-center gap-2 w-full xl:w-auto">
                <button type="button" onClick={() => void onRefresh()} className="ca-hero-quiet-action">
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
                <button type="button" onClick={() => setShowDatasetModal(true)} className="ca-hero-quiet-action">
                  <BookOpen className="w-4 h-4" /> Datasets
                </button>
                <button type="button" onClick={() => setShowCreateModal(true)} className="ca-hero-primary-action col-span-2 sm:col-span-1">
                  <Plus className="w-4 h-4" /> New lobby
                </button>
              </div>
            </div>

            <div className="ca-stats-grid grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                { label: 'Total lobbies', value: String(lobbies.length), icon: Layers, kind: 'lobbies', meta: 'Exam sessions' },
                { label: 'Active lobbies', value: String(activeLobbyCount), icon: Activity, kind: 'active', meta: 'Currently unlocked' },
                { label: 'Files received', value: String(submissions.length), icon: FileCode, kind: 'files', meta: 'Student submissions' },
                { label: 'High-risk flags', value: String(totalHighRisk), icon: ShieldAlert, kind: 'risk', meta: 'For instructor review' },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className={`ca-stat-card ca-stat-card--${stat.kind}`}>
                    <div className="ca-stat-heading"><span>{stat.label}</span><span className="ca-stat-icon"><Icon className="w-[19px] h-[19px]" /></span></div>
                    <div className="ca-stat-body"><strong className="ca-stat-value">{stat.value}</strong></div>
                    <p className="ca-stat-meta">{stat.meta}</p>
                  </div>
                );
              })}
            </div>

            <div className="ca-dashboard-grid">
            <div className="ca-premium-panel ca-quick-lobbies p-3.5 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div><p className="ca-panel-eyebrow">YOUR EXAM SESSIONS</p><h2 className="ca-panel-heading">Quick access lobbies</h2></div>
                <button
                  type="button"
                  onClick={() => setSection('lobbies')}
                  className="text-sm font-semibold text-ca-brand hover:text-ca-brand-hover transition-colors cursor-pointer"
                >
                  View all →
                </button>
              </div>
              {lobbies.length === 0 ? (
                <p className="text-sm text-ca-muted">No lobbies yet. Generate one to start an exam session.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {lobbies.slice(0, 4).map((lobby) => {
                    const expired = isExpired(lobby);
                    const isLocked = lobby.status === 'LOCKED' || expired;
                    return (
                      <button
                        key={lobby.id}
                        type="button"
                        onClick={() => {
                          selectLobby(lobby.id);
                          setSection('lobbies');
                        }}
                        className="ca-quick-lobby-card text-left p-3.5 rounded-xl border border-ca-border bg-ca-surface-2/80 hover:border-ca-brand transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[11px] font-bold text-ca-brand shrink min-w-0 max-w-[6rem] sm:max-w-[9rem] truncate" title={lobby.code}>
                            {lobby.code}
                          </span>
                          <span className="text-sm font-semibold text-ca-ink truncate min-w-0 flex-1">
                            {lobby.subject}
                          </span>
                          <span
                            className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                              isLocked ? 'bg-ca-bg-elevated text-ca-muted' : 'bg-ca-ok-soft text-ca-ok'
                            }`}
                          >
                            {expired ? 'EXPIRED' : lobby.status}
                          </span>
                        </div>
                        <p className="text-xs text-ca-muted mt-1.5 line-clamp-1">{lobby.title}</p>
                        <p className="text-[11px] text-ca-brand mt-1 font-mono">
                          Required: {lobby.language.toUpperCase()} (.{lobby.language === 'python' ? 'py' : lobby.language})
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <aside className="ca-review-panel" aria-label="Submission analysis overview">
              <div className="ca-review-panel-top">
                <span className="ca-review-icon"><Activity className="w-5 h-5" /></span>
                <span className="ca-review-pill"><span className="ca-live-dot" /> LIVE OVERVIEW</span>
              </div>
              <p className="ca-panel-eyebrow">ANALYSIS SNAPSHOT</p>
              <h2 className="ca-review-heading">Submission insights</h2>
              <p className="ca-review-description">A quick view of saved submissions across your exam sessions.</p>
              <div className="ca-analysis-count-row"><strong>{completedAnalyses}</strong><span>completed / {submissions.length} total</span></div>
              <div className="ca-review-progress" role="progressbar" aria-label="Completed analyses" aria-valuenow={completedAnalyses} aria-valuemin={0} aria-valuemax={Math.max(1, submissions.length)}>
                <span style={{ width: `${submissions.length ? completedAnalyses / submissions.length * 100 : 0}%` }} />
              </div>
              <div className="ca-review-list">
                <div><span><CircleCheck className="w-4 h-4 text-ca-ok" /> Completed analyses</span><strong>{completedAnalyses}</strong></div>
                <div><span><ShieldAlert className="w-4 h-4 text-ca-danger" /> High-risk flags</span><strong>{totalHighRisk}</strong></div>
                <div><span><Activity className="w-4 h-4 text-ca-warn" /> Pending or failed</span><strong>{pendingOrFailedAnalyses}</strong></div>
              </div>
              <button type="button" className="ca-review-link" onClick={() => setSection('submissions')}>Review submissions <ArrowUpRight className="w-4 h-4" /></button>
              <p className="ca-review-disclaimer">Risk estimates are advisory, not evidence of misconduct.</p>
            </aside>
            </div>
          </div>
        )}

        {section === 'lobbies' && (
          <div className="space-y-4 sm:space-y-6 ca-fade-up">
            <div className="ca-screen-hero ca-screen-hero--compact flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="ca-screen-eyebrow"><Layers className="w-3.5 h-3.5" /> INSTRUCTOR / SESSIONS</p>
                <h1 className="ca-screen-title font-display">Examination lobbies<span className="ca-title-dot">.</span></h1>
                <p className="ca-screen-subtitle">Create sessions, share access links, and manage examination entry.</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(true)} className="ca-hero-primary-action self-start sm:self-auto">
                <Plus className="w-4 h-4" /><span>New lobby</span>
              </button>
            </div>

            <div className="grid lg:grid-cols-12 gap-3 sm:gap-5 items-start">
              <div className="ca-premium-panel ca-lobby-index lg:col-span-4 p-4 space-y-3">
                <h2 className="text-xs font-semibold tracking-wide text-ca-muted">
                  Lobbies · {lobbies.length}
                </h2>
                <div className="space-y-2 max-h-[235px] lg:max-h-[60vh] overflow-y-auto pr-1 ca-scroll">
                  {lobbies.length === 0 ? (
                    <p className="text-sm text-ca-muted py-6 text-center">No lobbies yet.</p>
                  ) : (
                    lobbies.map((lobby) => {
                      const isSelected = activeLobby && activeLobby.id === lobby.id;
                      const expired = isExpired(lobby);
                      const isLocked = lobby.status === 'LOCKED' || expired;
                      const subCount = submissions.filter((s) => s.lobbyId === lobby.id).length;

                      return (
                        <button
                          key={lobby.id}
                          type="button"
                          onClick={() => selectLobby(lobby.id)}
                          className={`ca-lobby-list-item w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-ca-brand-soft border-ca-brand'
                              : 'bg-ca-surface-2/80 border-ca-border hover:border-ca-border-strong'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[11px] font-bold text-ca-brand shrink min-w-0 max-w-[6rem] sm:max-w-[9rem] truncate" title={lobby.code}>
                              {lobby.code}
                            </span>
                            <span className="text-sm font-semibold text-ca-ink truncate min-w-0 flex-1">
                              {lobby.subject}
                            </span>
                            <span
                              className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md whitespace-nowrap ${
                                isLocked
                                  ? 'bg-ca-bg-elevated text-ca-muted'
                                  : 'bg-ca-ok-soft text-ca-ok'
                              }`}
                            >
                              {expired ? 'EXPIRED' : lobby.status}
                            </span>
                          </div>
                          <p className="text-xs text-ca-muted mt-1.5 line-clamp-1">{lobby.title}</p>
                          <div className="mt-3 flex items-center justify-between text-[11px] text-ca-faint">
                            <span>Max {lobby.maxStudents}</span>
                            <span>{subCount} files</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="lg:col-span-8">
                {activeLobby ? (
                  <div className="ca-premium-panel ca-lobby-detail p-3.5 sm:p-6 space-y-4 sm:space-y-6">
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="min-w-0 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-ca-brand break-all">
                              {activeLobby.code}
                            </span>
                            <span
                              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                                activeLobby.status === 'ACTIVE' && !activeLobbyExpired
                                  ? 'bg-ca-ok-soft text-ca-ok'
                                  : 'bg-ca-bg-elevated text-ca-muted'
                              }`}
                            >
                              {activeLobbyExpired ? 'EXPIRED' : activeLobby.status}
                            </span>
                          </div>
                          <h2 className="text-2xl font-bold font-display text-ca-ink leading-tight">
                            {activeLobby.subject}
                          </h2>
                          <p className="text-sm text-ca-muted">{activeLobby.title}</p>
                          <p className="text-xs text-ca-faint">Up to 3 uploads per student</p>
                          {activeLobbyExpired && (
                            <p className="text-xs text-ca-warn" role="status">
                              Expired {formatPhilippineDateTime(activeLobby.expiresAt)} PHT. Extend the exam window to accept new uploads.
                            </p>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
                          <button
                            onClick={handleCopyCode}
                            className="px-3 py-2 rounded-xl bg-ca-surface-2 hover:bg-ca-surface-hover text-ca-ink border border-ca-border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            {copiedCode ? <Check className="w-3.5 h-3.5 text-ca-ok" /> : <Copy className="w-3.5 h-3.5 text-ca-brand" />}
                            <span>{copiedCode ? 'Copied' : 'Copy code'}</span>
                          </button>
                          <button
                            onClick={handleCopyLink}
                            className="px-3 py-2 rounded-xl bg-ca-surface-2 hover:bg-ca-surface-hover text-ca-ink border border-ca-border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            {copiedLink ? <Check className="w-3.5 h-3.5 text-ca-ok" /> : <ExternalLink className="w-3.5 h-3.5 text-ca-brand" />}
                            <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
                          </button>
                          <button
                            onClick={() => void handleToggleActiveLobby()}
                            disabled={updatingLobbyId !== null || deletingLobbyId !== null}
                            className={`disabled:opacity-50 disabled:cursor-wait px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                              activeLobby.status === 'ACTIVE' && !activeLobbyExpired
                                ? 'bg-ca-danger-soft text-ca-danger border-transparent'
                                : 'bg-ca-ok-soft text-ca-ok border-transparent'
                            }`}
                          >
                            {updatingLobbyId === activeLobby.id ? (
                              <span>Updating...</span>
                            ) : activeLobby.status === 'ACTIVE' && !activeLobbyExpired ? (
                              <>
                                <Lock className="w-3.5 h-3.5" />
                                <span>Lock</span>
                              </>
                            ) : activeLobbyExpired ? (
                              <>
                                <Unlock className="w-3.5 h-3.5" />
                                <span>Extend &amp; Reopen</span>
                              </>
                            ) : (
                              <>
                                <Unlock className="w-3.5 h-3.5" />
                                <span>Unlock</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteActiveLobby()}
                            disabled={deletingLobbyId !== null || updatingLobbyId !== null}
                            title="Delete lobby and all its submissions"
                            className="px-3 py-2 rounded-xl bg-ca-danger-soft text-ca-danger border border-transparent text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{deletingLobbyId === activeLobby.id ? 'Deleting...' : 'Delete lobby'}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                      {[
                        {
                          label: 'Students',
                          value: String(uniqueStudents),
                          unit: `/ ${activeLobby.maxStudents}`,
                          valueClass: 'text-ca-ink',
                        },
                        {
                          label: 'Files',
                          value: String(lobbySubmissions.length),
                          unit: 'uploaded',
                          valueClass: 'text-ca-brand',
                        },
                        {
                          label: 'High risk',
                          value: String(highRiskCount),
                          unit: '≥ 70%',
                          valueClass: 'text-ca-danger',
                        },
                        {
                          label: 'Med / Low',
                          value: `${mediumRiskCount} / ${lowRiskCount}`,
                          unit: 'M / L',
                          valueClass: 'text-ca-ink',
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="ca-lobby-mini-stat h-[4.75rem] sm:h-[5.5rem] p-3 sm:p-3.5 rounded-xl bg-ca-surface-2/90 border border-ca-border flex flex-col justify-between"
                        >
                          <span className="text-[11px] font-medium text-ca-muted tracking-wide">
                            {stat.label}
                          </span>
                          <div className="flex items-baseline gap-1.5">
                            <span className={`text-2xl font-bold font-mono leading-none ${stat.valueClass}`}>
                              {stat.value}
                            </span>
                            <span className="text-[11px] text-ca-faint">{stat.unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSection('submissions')}
                      className="text-sm font-semibold text-ca-brand hover:text-ca-brand-hover transition-colors cursor-pointer"
                    >
                      Open live student submissions →
                    </button>
                  </div>
                ) : (
                  <div className="p-12 text-center rounded-2xl border border-ca-border bg-ca-surface/95 backdrop-blur-md text-ca-muted">
                    <h3 className="text-lg font-bold font-display text-ca-ink mb-2">No lobbies yet</h3>
                    <p className="text-sm mb-5">Generate a lobby to start an exam session.</p>
                    <button onClick={() => setShowCreateModal(true)} className="ca-btn-primary mx-auto">
                      Create exam lobby
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {section === 'submissions' && (
          <div className="space-y-4 sm:space-y-6 ca-fade-up">
            <div className="ca-screen-hero ca-screen-hero--compact flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="ca-screen-eyebrow"><FileCode className="w-3.5 h-3.5" /> INSTRUCTOR / CODE REVIEW</p>
                <h1 className="ca-screen-title font-display">Live submissions<span className="ca-title-dot">.</span></h1>
                <p className="ca-screen-subtitle">Review incoming code and CodeBERT estimates. Results are not proof of AI authorship.</p>
              </div>
              {lobbies.length > 0 && (
                <div ref={lobbyMenuRef} className="relative w-full sm:w-72 shrink-0 ca-hero-lobby-select">
                  <p className="text-[11px] font-semibold mb-1.5">SELECT LOBBY</p>
                  <button type="button" onClick={() => setLobbyMenuOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={lobbyMenuOpen}
                    className="ca-hero-select-button w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition-colors cursor-pointer">
                    <span className="min-w-0 truncate"><span className="font-mono text-[11px] font-bold mr-2">{activeLobby?.code}</span><span className="font-semibold">{activeLobby?.subject}</span></span>
                    <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${lobbyMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {lobbyMenuOpen && (
                    <div role="listbox" className="ca-hero-select-options absolute right-0 left-0 z-30 mt-2 max-h-64 overflow-y-auto rounded-xl border border-ca-border bg-ca-surface-2 shadow-[var(--ca-shadow)] p-1.5">
                      {lobbies.map((lobby) => (
                        <button key={lobby.id} type="button" role="option" aria-selected={activeLobby?.id === lobby.id}
                          onClick={() => { selectLobby(lobby.id); setLobbyMenuOpen(false); }}
                          className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${activeLobby?.id === lobby.id ? 'bg-ca-brand-soft text-ca-ink' : 'text-ca-ink hover:bg-ca-surface-hover'}`}>
                          <div className="flex items-center gap-2 min-w-0"><span className="font-mono text-[11px] font-bold text-ca-brand max-w-[7rem] truncate" title={lobby.code}>{lobby.code}</span><span className="text-sm font-semibold truncate">{lobby.subject}</span></div>
                          <p className="text-[11px] text-ca-muted mt-0.5 line-clamp-1">{lobby.title}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {activeLobby ? (
              <div className="ca-premium-panel ca-submissions-panel p-3.5 sm:p-6 space-y-4 sm:space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className="w-5 h-5 text-ca-brand shrink-0" />
                    <h3 className="text-lg font-semibold text-ca-ink truncate">
                      {activeLobby.code}
                      <span className="text-ca-muted font-medium"> · {displayedSubmissions.length} files</span>
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={handleExportCSV}
                      className="px-3 py-2 rounded-xl bg-ca-brand-soft hover:bg-ca-brand text-ca-brand hover:text-ca-brand-ink text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                    <button
                      onClick={() => onSwitchToStudentView(activeLobby.code)}
                      className="px-3 py-2 rounded-xl bg-ca-surface-2 hover:bg-ca-surface-hover text-ca-ink border border-ca-border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Users className="w-3.5 h-3.5 text-ca-brand" />
                      <span>Test as Student</span>
                    </button>
                  </div>
                </div>

                {unfinishedCount > 0 && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-ca-brand/25 bg-ca-brand-soft px-3.5 py-3 sm:px-4 sm:py-3.5"
                  >
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ca-brand/20 bg-ca-surface/70 text-ca-brand">
                      <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin motion-reduce:animate-none" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ca-ink">
                        {analyzingCount > 0 ? 'CodeBERT is analyzing code' : 'Files queued for CodeBERT analysis'}
                        <span className="ml-2 text-xs font-semibold text-ca-brand">
                          {unfinishedCount} {unfinishedCount === 1 ? 'file' : 'files'}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ca-muted">
                        {analyzingCount > 0
                          ? 'Please wait while the analysis runs. Results will appear automatically when ready.'
                          : 'Waiting for the backend to begin analysis. Results will appear automatically.'}
                        {analyzingCount > 0 && queuedCount > 0 ? ` ${queuedCount} queued.` : ''}
                      </p>
                      {firstUnfinishedSubmission && (
                        <AnalysisTiming submission={firstUnfinishedSubmission}
                          className="block mt-1 text-xs font-mono font-semibold text-ca-brand" />
                      )}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-ca-surface/75 px-2.5 py-1 text-[11px] font-semibold text-ca-brand sm:self-center">
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ca-brand animate-pulse motion-reduce:animate-none" />
                      Auto-refreshing
                    </span>
                  </div>
                )}

                {/* A completed result remains visible after the active spinner disappears. */}
                {unfinishedCount === 0 && latestCompletedSubmission && (
                  <div role="status" className="flex items-start gap-3 rounded-xl border border-ca-ok/25 bg-ca-ok-soft px-3.5 py-3 sm:px-4">
                    <CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0 mt-0.5 text-ca-ok" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ca-ink">Latest CodeBERT analysis completed</p>
                      <p className="mt-1 text-xs text-ca-muted break-words">
                        <span className="font-mono">{latestCompletedSubmission.fileName}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        {latestCompletedTime ?? 'Processing duration not recorded for this submission'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-0 w-full sm:min-w-[200px]">
                    <Search className="w-4 h-4 text-ca-faint absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search Student ID, filename, or language..."
                      className="ca-search-field w-full pl-9 pr-3 py-2.5 rounded-xl bg-ca-surface-2 border border-ca-border text-ca-ink placeholder:text-ca-faint text-sm focus:outline-none focus:border-ca-brand"
                    />
                  </div>
                  <div className="ca-risk-filter grid grid-cols-4 w-full sm:w-auto sm:flex items-center gap-1 bg-ca-surface-2 p-1 rounded-xl border border-ca-border text-xs">
                    {(['All', 'High', 'Medium', 'Low'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRiskFilter(r)}
                        className={`px-1.5 sm:px-2.5 py-2 sm:py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                          riskFilter === r ? 'bg-ca-brand text-ca-brand-ink' : 'text-ca-muted hover:text-ca-ink'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ca-submissions-table hidden md:block overflow-x-auto rounded-xl border border-ca-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-ca-surface-2 text-ca-muted text-[11px] font-medium tracking-wide border-b border-ca-border">
                      <tr>
                        <th className="py-3 px-4">Student ID</th>
                        <th className="py-3 px-4">File name</th>
                        <th className="py-3 px-4">Language</th>
                        <th className="py-3 px-4">AI prediction</th>
                        <th className="py-3 px-4">Risk</th>
                        <th className="py-3 px-4">Submitted</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ca-border bg-ca-surface-2/60">
                      {displayedSubmissions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-ca-faint text-sm">
                            No submissions match these filters.
                          </td>
                        </tr>
                      ) : (
                        displayedSubmissions.map((sub) => {
                          const hasScore = sub.status === 'done' && sub.aiProbability !== null;
                          const prob = hasScore ? sub.aiProbability! : 0;
                          const probPercent = hasScore ? `${(prob * 100).toFixed(1)}%` : '—';

                          return (
                            <tr key={sub.id} className="hover:bg-ca-surface-hover/60 transition-colors">
                              <td className="py-3 px-4 font-mono font-semibold text-ca-ink">{sub.studentId}</td>
                              <td className="py-3 px-4 font-mono text-ca-muted text-xs">{sub.fileName}</td>
                              <td className="py-3 px-4">
                                <span className="px-2 py-0.5 rounded-md bg-ca-bg-elevated text-ca-muted font-mono text-[10px] uppercase">
                                  .{sub.language}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="space-y-1.5">
                                  {hasScore ? (
                                    <>
                                      <span className="text-xs font-mono font-semibold text-ca-ink">{probPercent}</span>
                                      <div className="w-24 h-1.5 rounded-full bg-ca-bg-elevated overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${sub.riskLevel === 'High' ? 'bg-ca-danger' : sub.riskLevel === 'Medium' ? 'bg-ca-warn' : 'bg-ca-ok'}`}
                                          style={{ width: `${Math.min(100, prob * 100)}%` }}
                                        />
                                      </div>
                                    </>
                                  ) : sub.status === 'analyzing' || sub.status === 'pending' ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ca-brand whitespace-nowrap">
                                      <LoaderCircle aria-hidden="true" className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
                                      {sub.status === 'analyzing' ? 'Analyzing code…' : 'Waiting in queue…'}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-ca-muted" title={sub.errorMessage}>—</span>
                                  )}
                                  <AnalysisTiming submission={sub}
                                    className="block text-[11px] font-mono text-ca-muted whitespace-nowrap"
                                    missingClassName="block text-[11px] text-ca-faint" />
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-md font-semibold text-[10px] uppercase tracking-wide ${
                                    sub.status === 'failed'
                                      ? 'bg-ca-danger-soft text-ca-danger'
                                      : sub.status === 'analyzing' || sub.status === 'pending'
                                        ? 'bg-ca-brand-soft text-ca-brand'
                                        : sub.riskLevel === 'High'
                                          ? 'bg-ca-danger-soft text-ca-danger'
                                          : sub.riskLevel === 'Medium'
                                            ? 'bg-ca-brand-soft text-ca-brand'
                                            : sub.riskLevel === 'Low'
                                              ? 'bg-ca-ok-soft text-ca-ok'
                                              : 'bg-ca-bg-elevated text-ca-muted'
                                  }`}
                                >
                                  <span title={sub.status === 'failed' ? sub.errorMessage || 'Analysis did not complete.' : undefined} className="inline-flex items-center gap-1.5">
                                    {(sub.status === 'analyzing' || sub.status === 'pending') && (
                                      <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                                    )}
                                    {sub.status === 'failed' ? 'Failed' : sub.status === 'analyzing' ? 'Analyzing' : sub.status === 'pending' ? 'Queued' : sub.riskLevel || 'Done'}
                                  </span>
                                </span>
                              </td>
                              <td className="py-3 px-4 text-ca-muted font-mono text-xs">
                                <span title={`${formatPhilippineDateTime(sub.submittedAt)} PHT`}>
                                  {formatPhilippineTime(sub.submittedAt)} PHT
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => setInspectedSubmission(sub)}
                                  className="px-2.5 py-1.5 rounded-lg bg-ca-surface hover:bg-ca-brand hover:text-ca-brand-ink text-ca-muted border border-ca-border text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Inspect</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Phone-sized submission cards: same saved data/actions as the desktop table. */}
                <div className="ca-submissions-mobile md:hidden space-y-2" aria-label="Student submission results">
                  {displayedSubmissions.length === 0 ? (
                    <div className="rounded-xl border border-ca-border bg-ca-surface-2/70 px-4 py-8 text-center text-ca-muted text-sm">
                      No submissions match these filters.
                    </div>
                  ) : displayedSubmissions.map((sub) => {
                    const hasScore = sub.status === 'done' && sub.aiProbability !== null;
                    const probability = hasScore ? sub.aiProbability! : 0;
                    const isProcessing = sub.status === 'analyzing' || sub.status === 'pending';
                    const label = sub.status === 'failed' ? 'Failed' : sub.status === 'analyzing' ? 'Analyzing' : sub.status === 'pending' ? 'Queued' : sub.riskLevel || 'Done';
                    const riskColor = sub.status === 'failed' ? 'bg-ca-danger-soft text-ca-danger' :
                      isProcessing ? 'bg-ca-brand-soft text-ca-brand' :
                      sub.riskLevel === 'High' ? 'bg-ca-danger-soft text-ca-danger' :
                      sub.riskLevel === 'Medium' ? 'bg-ca-warn-soft text-ca-warn' :
                      sub.riskLevel === 'Low' ? 'bg-ca-ok-soft text-ca-ok' : 'bg-ca-bg-elevated text-ca-muted';
                    const barColor = sub.riskLevel === 'High' ? 'bg-ca-danger' :
                      sub.riskLevel === 'Medium' ? 'bg-ca-warn' : sub.riskLevel === 'Low' ? 'bg-ca-ok' : 'bg-ca-border';

                    return (
                      <article key={sub.id} className="min-w-0 rounded-xl border border-ca-border bg-ca-surface-2/80 p-3.5 space-y-3">
                        <div className="flex items-start justify-between gap-3 min-w-0">
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide font-semibold text-ca-faint">Student ID</p>
                            <p className="font-mono font-semibold text-sm text-ca-ink break-all">{sub.studentId}</p>
                          </div>
                          <span className={`shrink-0 px-2 py-1 rounded-md font-semibold text-[10px] uppercase ${riskColor}`}
                            title={sub.status === 'failed' ? sub.errorMessage || 'Analysis did not complete.' : undefined}>
                            <span className="inline-flex items-center gap-1.5">
                              {isProcessing && <LoaderCircle aria-hidden="true" className="w-3 h-3 animate-spin motion-reduce:animate-none" />}
                              {label}
                            </span>
                          </span>
                        </div>
                        <div className="min-w-0 flex items-center gap-2">
                          <FileCode className="w-4 h-4 shrink-0 text-ca-brand" />
                          <span className="min-w-0 truncate font-mono text-xs text-ca-ink" title={sub.fileName}>{sub.fileName}</span>
                          <span className="shrink-0 text-[10px] uppercase rounded bg-ca-bg-elevated text-ca-muted px-1.5 py-0.5">{sub.language}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-[11px] text-ca-faint">AI prediction</p>
                            {hasScore ? (
                              <>
                                <p className="font-mono font-bold text-ca-ink mt-0.5">{(probability * 100).toFixed(1)}%</p>
                                <div className="mt-1.5 h-1.5 rounded-full bg-ca-bg-elevated overflow-hidden">
                                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, probability * 100)}%` }} />
                                </div>
                              </>
                            ) : isProcessing ? (
                              <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-ca-brand">
                                <LoaderCircle aria-hidden="true" className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
                                {sub.status === 'analyzing' ? 'Analyzing code…' : 'Queued…'}
                              </p>
                            ) : (
                              <p className="font-mono font-bold text-ca-muted mt-0.5" title={sub.errorMessage}>—</p>
                            )}
                          </div>
                          <div>
                            <p className="text-[11px] text-ca-faint">Submitted</p>
                            <p className="font-mono text-ca-ink mt-0.5" title={`${formatPhilippineDateTime(sub.submittedAt)} PHT`}>
                              {formatPhilippineTime(sub.submittedAt)} PHT
                            </p>
                          </div>
                        </div>
                        <AnalysisTiming submission={sub}
                          className="block text-xs font-mono font-medium text-ca-muted"
                          missingClassName="block text-xs text-ca-faint" />
                        <button type="button" onClick={() => setInspectedSubmission(sub)}
                          className="w-full min-h-10 inline-flex items-center justify-center gap-2 rounded-lg border border-ca-border bg-ca-surface hover:bg-ca-brand hover:text-ca-brand-ink text-ca-ink text-xs font-semibold transition-colors">
                          <Eye className="w-4 h-4" /> Inspect code
                        </button>
                      </article>
                    );
                  })}
                </div>

                <div className="p-3.5 rounded-xl bg-ca-brand-soft text-sm text-ca-muted flex items-start gap-2.5">
                  <BookOpen className="w-4 h-4 text-ca-brand shrink-0 mt-0.5" />
                  <p>
                    <strong className="text-ca-brand font-semibold">Instructor guidance:</strong> scores
                    are probabilities for review support, not proof of dishonesty.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center rounded-2xl border border-ca-border bg-ca-surface/95 backdrop-blur-md text-ca-muted">
                <h3 className="text-lg font-bold font-display text-ca-ink mb-2">No lobby selected</h3>
                <p className="text-sm mb-5">Create a lobby first to review student submissions.</p>
                <button onClick={() => setShowCreateModal(true)} className="ca-btn-primary mx-auto">
                  Create exam lobby
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {extendLobby && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-ca-overlay backdrop-blur-sm ca-fade-in">
          <div role="dialog" aria-modal="true" aria-labelledby="extend-lobby-heading" className="relative w-full max-w-lg max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl sm:rounded-3xl border border-ca-border bg-ca-bg p-4 sm:p-8 space-y-5 ca-scroll">
            <div className="flex items-start justify-between gap-3 border-b border-ca-border pb-4">
              <div>
                <h3 id="extend-lobby-heading" className="text-lg font-black text-ca-ink">Extend &amp; Reopen Lobby</h3>
                <p className="text-xs text-ca-muted mt-1">{extendLobby.subject} · {extendLobby.title || extendLobby.code}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setExtendLobbyId(null)} disabled={updatingLobbyId !== null}
                className="p-1.5 rounded-lg text-ca-muted hover:text-ca-ink hover:bg-ca-bg-elevated disabled:opacity-50">✕</button>
            </div>
            <p className="text-sm text-ca-muted">
              The previous session expired {formatPhilippineDateTime(extendLobby.expiresAt)} PHT.
              Choose a fresh duration starting now. The lobby code, existing students, files, and analysis results will be preserved.
            </p>
            <form onSubmit={(event) => void handleExtendLobby(event)} className="space-y-4">
              {extendError && <p role="alert" className="rounded-xl border border-ca-border bg-ca-danger-soft px-3.5 py-3 text-sm text-ca-danger">{extendError}</p>}
              <label htmlFor="extend-lobby-minutes" className="block text-xs font-bold uppercase tracking-wider text-ca-muted">New exam window (minutes)</label>
              <input id="extend-lobby-minutes" type="number" required min={10} max={1440} step={1}
                value={extendMinutes} onChange={(event) => setExtendMinutes(Number(event.target.value))}
                className="w-full px-4 py-2.5 rounded-xl bg-ca-surface-2 border border-ca-border text-ca-ink text-sm focus:outline-none focus:border-ca-brand" />
              <p className="text-xs text-ca-faint">10–1440 minutes (up to 24 hours). Students can submit again while this window is active, subject to the existing 3-files-per-student limit.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" disabled={updatingLobbyId !== null} onClick={() => setExtendLobbyId(null)}
                  className="px-4 py-2.5 rounded-xl border border-ca-border bg-ca-surface-2 text-ca-muted text-xs font-semibold disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={updatingLobbyId !== null}
                  className="px-4 py-2.5 rounded-xl bg-ca-brand text-ca-brand-ink text-xs font-bold disabled:opacity-50">
                  {updatingLobbyId === extendLobby.id ? 'Reopening...' : 'Confirm & Reopen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-ca-overlay backdrop-blur-sm ca-fade-in">
          <div className="relative w-full max-w-lg max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-2xl sm:rounded-3xl border border-ca-border bg-ca-bg p-4 sm:p-8 space-y-4 sm:space-y-6 ca-scroll">
            <div className="flex items-center justify-between border-b border-ca-border pb-4">
              <div>
                <h3 className="text-lg font-black text-ca-ink">Generate Exam Lobby</h3>
                <p className="text-xs text-ca-muted">Configure subject, student limit, and upload rules.</p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-ca-muted hover:text-ca-ink hover:bg-ca-bg-elevated cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLobbySubmit} className="space-y-4">
              {createError && (
                <div className="rounded-xl border border-ca-border bg-ca-danger-soft px-3.5 py-3 text-sm text-ca-danger">
                  {createError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-ca-muted mb-1.5">
                  Subject / Course Code <span className="text-ca-brand">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. CS 111: Computer Programming 1"
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-ca-surface-2 border border-ca-border text-ca-ink placeholder:text-ca-faint text-xs focus:outline-none focus:border-ca-brand"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-ca-muted mb-1.5">
                  Exam Title / Section <span className="text-ca-brand">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Midterm Practical Exam - Room 302"
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-ca-surface-2 border border-ca-border text-ca-ink placeholder:text-ca-faint text-xs focus:outline-none focus:border-ca-brand"
                />
              </div>

              <div>
                <label htmlFor="lobby-language" className="block text-xs font-bold uppercase tracking-wider text-ca-muted mb-1.5">
                  Required Programming Language <span className="text-ca-brand">*</span>
                </label>
                <select
                  id="lobby-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className="w-full px-4 py-2.5 rounded-xl bg-ca-surface-2 border border-ca-border text-ca-ink text-xs focus:outline-none focus:border-ca-brand"
                >
                  <option value="c">C (.c)</option>
                  <option value="java">Java (.java)</option>
                  <option value="python">Python (.py)</option>
                </select>
                <span className="text-[10px] text-ca-muted mt-1 block">
                  Students can only submit files in this language.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-ca-muted mb-1.5">
                    Max Student Limit
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="150"
                    value={maxStudents}
                    onChange={(e) => setMaxStudents(Number(e.target.value))}
                    required
                    className="w-full px-4 py-2.5 rounded-xl bg-ca-surface-2 border border-ca-border text-ca-ink text-xs focus:outline-none focus:border-ca-brand"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-ca-muted mb-1.5">
                    Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="480"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    required
                    className="w-full px-4 py-2.5 rounded-xl bg-ca-surface-2 border border-ca-border text-ca-ink text-xs focus:outline-none focus:border-ca-brand"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-ca-brand-soft border border-ca-border text-xs text-ca-brand flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Upload restriction: Exactly up to 3 uploads per student in this lobby.</span>
              </div>

              <div className="pt-2 grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-ca-surface-2 hover:bg-ca-bg-elevated text-ca-muted text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-3 sm:px-5 py-2.5 rounded-xl bg-ca-brand hover:bg-ca-brand-hover text-ca-brand-ink font-black text-xs cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                >
                  {isCreating ? 'Saving lobby...' : 'Generate Lobby & Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDatasetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-ca-overlay backdrop-blur-sm ca-fade-in">
          <div className="relative w-full max-w-3xl rounded-2xl sm:rounded-3xl border border-ca-border bg-ca-bg p-4 sm:p-8 space-y-4 sm:space-y-6 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain ca-scroll">
            <div className="flex items-center justify-between border-b border-ca-border pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <h3 className="text-base sm:text-lg font-black text-ca-ink break-words">CodeBERT AI Detection — Training & Validation</h3>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-ca-brand-soft text-ca-brand border border-ca-border font-bold">
                    CodeBERT Frozen
                  </span>
                </div>
                <p className="text-xs text-ca-muted mt-1">
                  Real labeled human/AI examples are required before CodeBERT can classify authorship.
                </p>
              </div>
              <button
                onClick={() => setShowDatasetModal(false)}
                className="p-1.5 rounded-lg text-ca-muted hover:text-ca-ink hover:bg-ca-bg-elevated cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-ca-muted">
              <div className="p-4 rounded-2xl bg-ca-surface-2 border border-ca-border space-y-2">
                <h4 className="text-xs font-bold text-ca-ink">1. Research dataset — human and AI-written code</h4>
                <p>
                  Boukili et al. (2026) published a labeled 10,000-sample dataset covering
                  Python, Java, C and C++. Use the original dataset and review its license before training.
                </p>
                <a href="https://data.mendeley.com/datasets/kjh95n54f8/2"
                  target="_blank" rel="noopener noreferrer" className="text-ca-brand underline font-semibold">
                  Open the published dataset
                </a>
              </div>
              <div className="p-4 rounded-2xl bg-ca-surface-2 border border-ca-border space-y-2">
                <h4 className="text-xs font-bold text-ca-ink">2. Run the offline training pipeline on the backend computer</h4>
                <p>Import the labeled CSV and train one classifier per language. Solutions to the same coding problem remain together across evaluation splits.</p>
                <code className="block font-mono text-[11px] whitespace-pre-wrap break-all text-ca-brand">python -m ml.import_research_dataset --csv HumanVsAI_CodeDataset.csv</code>
                <code className="block font-mono text-[11px] whitespace-pre-wrap break-all text-ca-brand">python -m ml.train_head --language python --data dataset/python</code>
              </div>
              <div className="p-4 rounded-2xl bg-ca-surface-2 border border-ca-border space-y-2">
                <h4 className="text-xs font-bold text-ca-ink">3. Evaluate before activation</h4>
                <p>Review human false-positive rate and F1 in ml/candidates/python.json. Only evaluated candidates can be activated; a missing classifier must show Failed, never a fabricated score.</p>
                <code className="block font-mono text-[11px] whitespace-pre-wrap break-all text-ca-brand">python -m ml.activate_head --language python --confirm-reviewed</code>
                <p>Repeat for Java and C. Scores are advisory and never proof of academic misconduct.</p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowDatasetModal(false)}
                className="px-5 py-2.5 rounded-xl bg-ca-brand hover:bg-ca-brand-hover text-ca-brand-ink font-black text-xs cursor-pointer"
              >
                Close Pipeline Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      <CodeModal
        submission={inspectedSubmission ?
          submissions.find((sub) => sub.id === inspectedSubmission.id && sub.lobbyId === inspectedSubmission.lobbyId) || inspectedSubmission : null}
        onLoadCode={onLoadSubmissionCode}
        onClose={() => setInspectedSubmission(null)}
      />
    </div>
  );
};
