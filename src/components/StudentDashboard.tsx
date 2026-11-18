import React, { useEffect, useRef, useState } from 'react';
import {
  UploadCloud,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Terminal,
  X,
  Info,
  ShieldCheck,
  KeyRound,
  Fingerprint,
  Files,
  LockKeyhole,
  CalendarClock,
  RefreshCw,
  CircleCheck,
  ChevronDown,
  LoaderCircle,
  FileText,
  Sparkles,
} from 'lucide-react';
import { Language, Lobby } from '../types';
import { ApiRequestError, getPublicLobby, submitLobbyFiles } from '../utils/api';
import { EXT_TO_LANG } from '../utils/aiDetector';
import { SAMPLE_CODES } from '../utils/storage';
import { formatPhilippineTime, formatPhilippineDateTime, utcTimestamp } from '../utils/dateTime';
import './StudentDashboardPremium.css';

interface StudentDashboardProps {
  initialLobbyCode?: string;
}

interface StagedFile {
  name: string;
  code: string;
  language: Language;
  size: number;
}

type ClosedReason = 'expired' | 'instructor_locked' | null;
type PublicLobbyData = Awaited<ReturnType<typeof getPublicLobby>>;
type StudentLobby = Lobby & { closedReason: ClosedReason };

/** Keep the student view compatible with older backends that lack close details. */
function toStudentLobby(code: string, lobby: PublicLobbyData): StudentLobby {
  const now = new Date().toISOString();
  const deadline = lobby.expires_at ? utcTimestamp(lobby.expires_at) : now;
  const inferredExpired = lobby.expires_at && Date.parse(deadline) <= Date.now();
  const closedReason: ClosedReason = lobby.active
    ? null
    : lobby.closed_reason || (inferredExpired ? 'expired' : null);
  return {
    id: code,
    code,
    language: lobby.language,
    subject: lobby.subject || lobby.title,
    title: lobby.subject ? lobby.title : '',
    instructorId: '',
    instructorEmail: '',
    maxStudents: 35,
    durationMinutes: 1,
    createdAt: now,
    expiresAt: deadline,
    status: lobby.active ? 'ACTIVE' : 'LOCKED',
    maxUploadsPerStudent: 3,
    closedReason,
  };
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ initialLobbyCode = '' }) => {
  const [lobbyCode, setLobbyCode] = useState(initialLobbyCode);
  const [remoteLobby, setRemoteLobby] = useState<StudentLobby | null>(null);
  const [lookupPending, setLookupPending] = useState(false);
  const [recheckPending, setRecheckPending] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const stagedFilesRef = useRef<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successReceipt, setSuccessReceipt] = useState<{
    studentId: string;
    lobbyTitle: string;
    fileCount: number;
    submittedAt: string;
  } | null>(null);

  const activeLobby = remoteLobby;
  const remainingQuota = Math.max(0, 3 - stagedFiles.length);
  const sessionReady = activeLobby?.status === 'ACTIVE';
  const identityReady = studentId.trim().length > 0;
  const filesReady = stagedFiles.length > 0;
  const completedSteps = Number(sessionReady) + Number(identityReady) + Number(filesReady);
  const expectedExtension = activeLobby
    ? ({ c: '.c', java: '.java', python: '.py' } as const)[activeLobby.language]
    : null;
  const quickStudentIds = ['221', '222', '223', '224', '225', '226'];

  useEffect(() => {
    if (initialLobbyCode) setLobbyCode(initialLobbyCode);
  }, [initialLobbyCode]);

  useEffect(() => {
    const code = lobbyCode.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(code)) {
      setRemoteLobby(null);
      setLookupPending(false);
      setLookupError(null);
      return;
    }

    let cancelled = false;
    setRemoteLobby(null);
    setLookupError(null);
    setLookupPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const lobby = await getPublicLobby(code);
        if (cancelled) return;
        setRemoteLobby(toStudentLobby(code, lobby));
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unable to check this lobby.';
          setLookupError(
            error instanceof ApiRequestError && error.status === 404 && message === 'Lobby not found'
              ? 'Lobby not found in the shared database. Ask your instructor for a newly generated lobby link.'
              : message,
          );
        }
      } finally {
        if (!cancelled) setLookupPending(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lobbyCode]);

  // Instructors may change a lobby's status while a student is on this page.
  // Check this one public status endpoint, never the full instructor dashboard.
  useEffect(() => {
    if (!remoteLobby) return;
    const checkedCode = remoteLobby.code;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (document.hidden || cancelled) return;
      try {
        const updated = await getPublicLobby(checkedCode);
        if (!cancelled) {
          setRemoteLobby((current) => current?.code === checkedCode
            ? toStudentLobby(checkedCode, updated) : current);
          setRecheckError(null);
        }
      } catch {
        // Remain closed if status cannot be verified; never guess that uploads are open.
      }
    }, remoteLobby.status === 'LOCKED' ? 20_000 : 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [remoteLobby?.code, remoteLobby?.status]);

  const handleRecheckLobby = async () => {
    if (!remoteLobby || recheckPending) return;
    const code = remoteLobby.code;
    setRecheckPending(true);
    setRecheckError(null);
    try {
      const updated = await getPublicLobby(code);
      setRemoteLobby((current) => current?.code === code
        ? toStudentLobby(code, updated) : current);
    } catch {
      setRecheckError('Unable to check the session right now. Please check your connection and try again.');
    } finally {
      setRecheckPending(false);
    }
  };

  const handleDifferentLobby = () => {
    setRemoteLobby(null);
    setLobbyCode('');
    setRecheckError(null);
    setLookupError(null);
    setErrorMsg(null);
    stagedFilesRef.current = [];
    setStagedFiles([]);
    // Remove the old share-link query so refreshing doesn't reopen that old lobby.
    const url = new URL(window.location.href);
    url.searchParams.delete('lobby');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  };

  /** Atomically validate a selected batch instead of racing individual FileReaders. */
  const stageFiles = (incoming: StagedFile[]) => {
    const next = [...stagedFilesRef.current];
    const existingNames = new Set(next.map((f) => f.name.toLowerCase()));
    let error: string | null = null;

    if (next.length + incoming.length > 3) {
      error = 'You can submit a maximum of 3 files per lobby.';
    }
    for (const file of incoming) {
      if (error) break;
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!EXT_TO_LANG[ext]) {
        error = `File '${file.name}' has an invalid extension. Only Python (.py), Java (.java), and C (.c) are accepted.`;
      } else if (activeLobby && file.language !== activeLobby.language) {
        error = `This lobby accepts only ${activeLobby.language.toUpperCase()} (${expectedExtension}) files. '${file.name}' was not added.`;
      } else if (file.size > 200 * 1024) {
        error = `File '${file.name}' exceeds the maximum allowed size of 200 KB.`;
      } else if (existingNames.has(file.name.toLowerCase())) {
        error = `A file named '${file.name}' has already been added.`;
      } else if (!file.code.trim()) {
        error = `File '${file.name}' is empty. Please select a nonempty source file.`;
      }
      if (!error) {
        next.push(file);
        existingNames.add(file.name.toLowerCase());
      }
    }
    if (error) {
      setErrorMsg(error);
      return;
    }
    stagedFilesRef.current = next;
    setStagedFiles(next);
    setErrorMsg(null);
  };

  const validateAndAddFile = (fileName: string, content: string, sizeBytes: number) => {
    const ext = '.' + fileName.split('.').pop()?.toLowerCase();
    stageFiles([{ name: fileName, code: content, size: sizeBytes, language: EXT_TO_LANG[ext] || 'python' }]);
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      // Read all files before applying the max-three and duplicate checks once.
      const incoming = await Promise.all(files.map(async (file) => {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();
        return {
          name: file.name,
          code: await file.text(),
          language: EXT_TO_LANG[ext] || 'python',
          size: file.size,
        } satisfies StagedFile;
      }));
      stageFiles(incoming);
    } catch {
      setErrorMsg('Could not read one of the selected files. Try choosing the files again.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    void handleFiles(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!isSubmitting) void handleFiles(Array.from(e.dataTransfer.files || []));
  };

  const removeStagedFile = (index: number) => {
    const next = stagedFilesRef.current.filter((_, i) => i !== index);
    stagedFilesRef.current = next;
    setStagedFiles(next);
    setErrorMsg(null);
  };

  const handleLoadSample = (type: 'python_ai' | 'python_human' | 'c_ai' | 'java_human') => {
    if (stagedFiles.length >= 3) {
      setErrorMsg(`Cannot add more files: maximum 3 files per student quota reached.`);
      return;
    }

    if (type === 'python_ai') {
      validateAndAddFile('binary_search.py', SAMPLE_CODES.python_ai, SAMPLE_CODES.python_ai.length);
    } else if (type === 'python_human') {
      validateAndAddFile('searchNum.py', SAMPLE_CODES.python_human, SAMPLE_CODES.python_human.length);
    } else if (type === 'c_ai') {
      validateAndAddFile('matrix_mult.c', SAMPLE_CODES.c_ai, SAMPLE_CODES.c_ai.length);
    } else if (type === 'java_human') {
      validateAndAddFile('ScoreCalculator.java', SAMPLE_CODES.java_human, SAMPLE_CODES.java_human.length);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!activeLobby) {
      setErrorMsg('Invalid exam lobby code. Please enter a valid lobby code.');
      return;
    }

    if (activeLobby.status === 'LOCKED') {
      setErrorMsg('This exam session is locked by the instructor. Submissions are closed.');
      return;
    }

    const cleanId = studentId.trim();
    if (!cleanId) {
      setErrorMsg('Please input your Student ID Number (e.g. 221, 222, 223...).');
      return;
    }

    if (stagedFiles.length === 0) {
      setErrorMsg('Please attach at least 1 source file (.c, .java, or .py).');
      return;
    }

    const mismatchedFile = stagedFiles.find((file) => file.language !== activeLobby.language);
    if (mismatchedFile) {
      setErrorMsg(
        `This lobby accepts only ${activeLobby.language.toUpperCase()} (${expectedExtension}) files. '${mismatchedFile.name}' cannot be submitted.`
      );
      return;
    }

    if (stagedFiles.length > 3) {
      setErrorMsg('Upload limit exceeded. You may submit at most 3 files per exam lobby.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitLobbyFiles(
        activeLobby.id,
        cleanId,
        stagedFiles.map(({ name, code }) => ({ name, content: code })),
      );
      setSuccessReceipt({
        studentId: cleanId,
        lobbyTitle: activeLobby.title
          ? `${activeLobby.subject} (${activeLobby.title})`
          : activeLobby.subject,
        fileCount: stagedFiles.length,
        submittedAt: formatPhilippineTime(new Date().toISOString()) + ' PHT',
      });
      stagedFilesRef.current = [];
      setStagedFiles([]);
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : 'Unable to submit your files.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // A closed session has its own focused experience, rather than an unusable
  // identity/upload form. Submission enforcement still lives in FastAPI.
  if (activeLobby?.status === 'LOCKED' && !successReceipt) {
    const expired = activeLobby.closedReason === 'expired';
    const manuallyLocked = activeLobby.closedReason === 'instructor_locked';
    const heading = expired
      ? 'The submission window has ended.'
      : manuallyLocked
        ? 'This exam lobby is locked.'
        : 'This exam lobby is closed.';
    const explanation = expired
      ? 'The deadline for this exam has passed. New files cannot be submitted unless your instructor extends and reopens the session.'
      : manuallyLocked
        ? 'Your instructor has temporarily closed submissions for this exam. Only the instructor can unlock or reopen the lobby.'
        : 'This exam is not currently accepting files. It may be locked or past its deadline. Please contact your instructor for clarification.';
    const deadlineIsKnown = Boolean(activeLobby.closedReason && activeLobby.expiresAt);
    return (
      <main className="ca-student-workspace ca-student-workspace--closed ca-fade-up">
        <section className="ca-student-closed-panel" aria-labelledby="ca-closed-heading" role="status">
          <div className="ca-student-closed-shine" aria-hidden="true" />
          <div className="ca-student-closed-icon"><LockKeyhole size={36} strokeWidth={1.65}/></div>
          <div className="ca-student-closed-label">CODEAUTHENTIC / SESSION UNAVAILABLE</div>
          <span className="ca-student-closed-pill"><span aria-hidden="true" /> {expired ? 'Deadline expired' : manuallyLocked ? 'Locked by instructor' : 'Submissions closed'}</span>
          <h1 id="ca-closed-heading">{heading}</h1>
          <p className="ca-student-closed-description">{explanation}</p>

          <div className="ca-student-closed-info">
            <div><span>EXAM SESSION</span><strong>{activeLobby.subject}</strong><small>{activeLobby.title || 'Examination'}</small></div>
            {deadlineIsKnown && <div><span><CalendarClock size={14}/> SUBMISSION DEADLINE</span><strong>{formatPhilippineDateTime(activeLobby.expiresAt)}</strong><small>Philippine Time (PHT)</small></div>}
          </div>

          <div className="ca-student-closed-guidance">
            <ShieldCheck size={21} aria-hidden="true" />
            <div><strong>Need more time to submit?</strong><p>{expired
              ? 'Contact your instructor and ask them to use Extend & Reopen. Your existing lobby code will remain the same.'
              : 'Contact your instructor to request reopening or a deadline extension. Only an instructor can change the session status.'}</p></div>
          </div>

          <div className="ca-student-closed-actions">
            <button type="button" className="ca-student-closed-check" onClick={() => void handleRecheckLobby()} disabled={recheckPending}>
              <RefreshCw size={17} className={recheckPending ? 'ca-student-spinner' : ''}/>
              {recheckPending ? 'Checking session…' : 'Check session again'}
            </button>
            <button type="button" className="ca-student-closed-other" onClick={handleDifferentLobby}><KeyRound size={17}/> Use another lobby code</button>
          </div>
          {recheckError && <p className="ca-student-closed-error" role="alert">{recheckError}</p>}
          <p className="ca-student-closed-refresh"><CircleCheck size={14}/> Checking for instructor updates every 20 seconds while this page is open.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="ca-student-workspace ca-fade-up">
      <header className="ca-student-hero">
        <div className="ca-student-hero-top">
          <div className="ca-student-hero-copy">
            <div className="ca-student-eyebrow"><span className="ca-student-eyebrow-icon"><Terminal size={14} /></span> CODEAUTHENTIC / STUDENT WORKSPACE</div>
            <h1>Submit your work<span className="ca-student-title-period">.</span></h1>
            <p>A secure, straightforward way to send your programming files for instructor review.</p>
          </div>
          <div className="ca-student-hero-assurance">
            <span className="ca-student-assurance-icon"><ShieldCheck size={19} /></span>
            <div><strong>Instructor-only analysis</strong><span>Your results stay private to your instructor.</span></div>
          </div>
        </div>
        <div className="ca-student-steps" aria-label={`${completedSteps} of 3 submission steps ready`}>
          {([
            { index: '01', name: 'Exam session', ready: sessionReady },
            { index: '02', name: 'Student identity', ready: identityReady },
            { index: '03', name: 'Source files', ready: filesReady },
          ] as const).map((step, index) => (
            <div className={`ca-student-step${step.ready ? ' is-ready' : ''}`} key={step.index}>
              <span className="ca-student-step-number">{step.ready ? <CircleCheck size={16} /> : step.index}</span>
              <span className="ca-student-step-label">{step.name}</span>
              {index < 2 && <span className="ca-student-step-line" aria-hidden="true" />}
            </div>
          ))}
        </div>
      </header>

      {successReceipt ? (
        <section className="ca-student-receipt ca-fade-in" aria-live="polite">
          <div className="ca-student-receipt-mark"><CheckCircle2 size={30} /></div>
          <div className="ca-student-receipt-heading">
            <p className="ca-student-kicker">SUBMISSION CONFIRMED</p>
            <h2>Your files were received.</h2>
            <p>Your submission has been sent to the instructor dashboard. AI analysis scores are not shown to students.</p>
          </div>
          <div className="ca-student-receipt-grid">
            <div><span>Student ID</span><strong className="ca-student-break">{successReceipt.studentId}</strong></div>
            <div><span>Exam</span><strong className="ca-student-break">{successReceipt.lobbyTitle}</strong></div>
            <div><span>Submitted</span><strong>{successReceipt.fileCount} file{successReceipt.fileCount === 1 ? '' : 's'}</strong></div>
            <div><span>Receipt time</span><strong>{successReceipt.submittedAt}</strong></div>
          </div>
          <button type="button" className="ca-student-submit-button ca-student-again" onClick={() => setSuccessReceipt(null)}>
            Submit another set <ArrowRight size={17} />
          </button>
        </section>
      ) : (
        <form onSubmit={handleSubmit} className="ca-student-form" noValidate={false}>
          <div className="ca-student-form-grid">
            <div className="ca-student-details-col">
              <section className="ca-student-card ca-student-session-card" aria-labelledby="ca-student-session-title">
                <div className="ca-student-card-heading">
                  <div className="ca-student-section-icon"><KeyRound size={18} /></div>
                  <div className="ca-student-card-heading-text">
                    <span className="ca-student-kicker">STEP 01 / SESSION</span>
                    <h2 id="ca-student-session-title">Your exam lobby</h2>
                  </div>
                </div>
                <p className="ca-student-card-description">Paste the code shared by your instructor to connect to the correct exam.</p>
                <label className="ca-student-label" htmlFor="ca-student-lobby">Lobby code <span aria-hidden="true">*</span></label>
                <div className="ca-student-input-shell">
                  <span className="ca-student-input-leading"><KeyRound size={16} /></span>
                  <input
                    id="ca-student-lobby"
                    type="text"
                    value={lobbyCode}
                    onChange={(e) => {
                      setLobbyCode(e.target.value.toUpperCase());
                      stagedFilesRef.current = [];
                      setStagedFiles([]);
                      setErrorMsg(null);
                    }}
                    placeholder="Paste your lobby code"
                    autoComplete="off"
                    required
                    spellCheck={false}
                    className="ca-student-text-input ca-student-code-input"
                  />
                </div>

                {activeLobby ? (
                  <div className="ca-student-lobby-found" role="status">
                    <div className="ca-student-lobby-icon"><FileText size={17}/></div>
                    <div className="ca-student-lobby-info"><strong>{activeLobby.subject}</strong><span>{activeLobby.title || 'Exam lobby'}</span></div>
                    <span className={`ca-student-status-pill ${activeLobby.status === 'ACTIVE' ? 'is-active' : 'is-locked'}`}>
                      {activeLobby.status === 'ACTIVE' ? <CircleCheck size={12}/> : <LockKeyhole size={12}/>}
                      {activeLobby.status === 'ACTIVE' ? 'Open' : 'Locked'}
                    </span>
                  </div>
                ) : lobbyCode.trim() ? (
                  <p className={`ca-student-lookup-message ${lookupError ? 'is-error' : ''}`} role="status" aria-live="polite">
                    {lookupPending ? <LoaderCircle size={15} className="ca-student-spinner" /> : lookupError ? <AlertTriangle size={15}/> : <Info size={15}/>} 
                    {lookupPending ? 'Checking your exam lobby…' : lookupError || 'Enter the complete lobby code provided by your instructor.'}
                  </p>
                ) : (
                  <p className="ca-student-field-hint">A valid lobby code is required before submitting.</p>
                )}
              </section>

              <section className="ca-student-card ca-student-identity-card" aria-labelledby="ca-student-identity-title">
                <div className="ca-student-card-heading">
                  <div className="ca-student-section-icon"><Fingerprint size={19}/></div>
                  <div className="ca-student-card-heading-text"><span className="ca-student-kicker">STEP 02 / IDENTITY</span><h2 id="ca-student-identity-title">Student information</h2></div>
                </div>
                <p className="ca-student-card-description">Use the Student ID assigned to you for this exam.</p>
                <label className="ca-student-label" htmlFor="ca-student-id">Student ID <span aria-hidden="true">*</span></label>
                <div className="ca-student-input-shell">
                  <span className="ca-student-input-leading"><Fingerprint size={17}/></span>
                  <input
                    id="ca-student-id"
                    type="text"
                    value={studentId}
                    onChange={(e) => {setStudentId(e.target.value); setErrorMsg(null);}}
                    placeholder="e.g. 221-0045"
                    autoComplete="off"
                    required
                    spellCheck={false}
                    className="ca-student-text-input"
                  />
                </div>
                <div className="ca-student-id-shortcuts">
                  <span>Quick-fill example IDs</span>
                  <div>
                    {quickStudentIds.map(id => (
                      <button type="button" key={id} className={`ca-student-quick-chip ${studentId === id ? 'is-selected' : ''}`} onClick={() => {setStudentId(id); setErrorMsg(null);}}>{id}</button>
                    ))}
                  </div>
                </div>
              </section>
              <div className="ca-student-guidance">
                <ShieldCheck size={19}/>
                <div><strong>Submission guidelines</strong><p>Maximum 3 files per lobby, up to 200 KB each. Your AI analysis is only visible to instructors.</p></div>
              </div>
            </div>

            <section className="ca-student-card ca-student-upload-card" aria-labelledby="ca-student-files-title">
              <div className="ca-student-card-heading ca-student-upload-heading">
                <div className="ca-student-section-icon"><Files size={19}/></div>
                <div className="ca-student-card-heading-text"><span className="ca-student-kicker">STEP 03 / UPLOAD</span><h2 id="ca-student-files-title">Source code files</h2></div>
                <span className="ca-student-count">{stagedFiles.length} <span>/ 3 files</span></span>
              </div>
              <p className="ca-student-card-description">Add your solution files. They must match the programming language for this lobby.</p>

              <div className="ca-student-file-meter" aria-label={`${stagedFiles.length} of 3 file slots filled`}>
                {[0,1,2].map(index => <span key={index} className={index < stagedFiles.length ? 'is-filled' : ''} />)}
              </div>
              <div
                className={`ca-student-dropzone ${isDragOver ? 'is-dragging' : ''} ${remainingQuota === 0 ? 'is-full' : ''}`}
                onDragOver={e => {e.preventDefault(); if (!isSubmitting) setIsDragOver(true);}}
                onDragLeave={e => {e.preventDefault(); setIsDragOver(false);}}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  id="student-file-input"
                  type="file"
                  multiple
                  accept={expectedExtension || '.py,.java,.c'}
                  className="ca-student-visually-hidden"
                  onChange={handleFileUpload}
                  tabIndex={-1}
                />
                <span className="ca-student-dropzone-icon"><UploadCloud size={28} strokeWidth={1.8}/></span>
                <strong>{remainingQuota === 0 ? 'All file slots are filled' : isDragOver ? 'Release files to add them' : 'Drag & drop your files here'}</strong>
                <p>or choose files from your device</p>
                <button type="button" className="ca-student-browse-button" onClick={() => fileInputRef.current?.click()} disabled={remainingQuota === 0 || isSubmitting}>
                  <UploadCloud size={16} /> Browse files
                </button>
                <div className="ca-student-file-types"><span>{expectedExtension ? `${expectedExtension} files only` : '.py · .java · .c'}</span><i aria-hidden="true"/><span>Max 200 KB each</span></div>
              </div>

              <div className="ca-student-samples">
                <button type="button" className="ca-student-samples-trigger" aria-expanded={showSamples} aria-controls="ca-student-samples-list" onClick={() => setShowSamples(!showSamples)}>
                  <span><Sparkles size={15}/> Load a demo sample <small>For testing</small></span><ChevronDown size={16} className={showSamples ? 'is-open' : ''}/>
                </button>
                {showSamples && (
                  <div id="ca-student-samples-list" className="ca-student-sample-list">
                    {([
                      ['python_ai', 'Python · AI sample'],
                      ['python_human', 'Python · beginner-style sample'],
                      ['c_ai', 'C · AI sample'],
                      ['java_human', 'Java · example sample'],
                    ] as const).map(([type,label]) => (
                      <button type="button" key={type} onClick={() => handleLoadSample(type)} disabled={isSubmitting || remainingQuota === 0}>{label}</button>
                    ))}
                  </div>
                )}
              </div>

              {stagedFiles.length > 0 ? (
                <div className="ca-student-staged-list" aria-live="polite">
                  <div className="ca-student-staged-heading"><span>READY TO SUBMIT</span><strong>{stagedFiles.length} file{stagedFiles.length === 1 ? '' : 's'}</strong></div>
                  {stagedFiles.map((file, idx) => (
                    <div className="ca-student-staged-file" key={`${file.name}-${idx}`}>
                      <span className="ca-student-staged-icon"><FileCode size={17}/></span>
                      <div className="ca-student-staged-info"><strong title={file.name}>{file.name}</strong><span>{file.language.toUpperCase()} · {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}</span></div>
                      <button type="button" className="ca-student-remove-file" onClick={() => removeStagedFile(idx)} aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`}><X size={17}/></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ca-student-empty-note"><CheckCircle2 size={15}/> Your files will appear here before submission.</div>
              )}
            </section>
          </div>

          {activeLobby?.status === 'LOCKED' && (
            <div className="ca-student-feedback is-locked" role="status"><LockKeyhole size={18}/><div><strong>This exam lobby is locked.</strong><span>Uploads are closed. Ask your instructor to unlock it before submitting.</span></div></div>
          )}
          {errorMsg && (
            <div className="ca-student-feedback is-error" role="alert"><AlertTriangle size={18}/><span>{errorMsg}</span></div>
          )}

          <div className="ca-student-form-footer">
            <div className="ca-student-footer-copy"><ShieldCheck size={20}/><div><strong>Ready when you are</strong><span>Only your instructor can view the analysis.</span></div></div>
            <button
              type="submit"
              disabled={isSubmitting || stagedFiles.length === 0 || !studentId.trim() || !activeLobby || activeLobby.status === 'LOCKED'}
              className="ca-student-submit-button"
            >
              {isSubmitting ? <><LoaderCircle className="ca-student-spinner" size={18}/> Submitting files…</> : <>Submit {stagedFiles.length || ''} file{stagedFiles.length === 1 ? '' : 's'} <ArrowRight size={18}/></>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
