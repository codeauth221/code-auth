/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Instructor, Lobby, Submission, Theme } from './types';
import {
  clearAuthSession,
  createLobby as createRemoteLobby,
  deleteLobby as deleteRemoteLobby,
  extendAndReopenLobby as extendRemoteLobby,
  getAuthToken,
  getSubmissionCode,
  getSavedInstructor,
  loadInstructorData,
  saveAuthSession,
  setLobbyLocked,
  subscribeToLobbyUpdates,
} from './utils/api';
import { getStoredTheme, saveStoredTheme } from './utils/storage';
import { Navbar } from './components/Navbar';
import { HomeIntro } from './components/HomeIntro';
import { InstructorLogin } from './components/InstructorLogin';
import { InstructorDashboard } from './components/InstructorDashboard';
import { StudentDashboard } from './components/StudentDashboard';
import instructorBg from './assets/BG ins.jpg';

export default function App() {
  const [theme, setTheme] = useState<Theme>('dark');
  const activeTokenRef = useRef<string | null>(null);
  const refreshSequenceRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'instructor' | 'student'>('home');
  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [initialStudentLobbyCode, setInitialStudentLobbyCode] = useState('');
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const refreshDashboardData = useCallback((): Promise<void> => {
    if (!authToken) return Promise.resolve();
    if (refreshInFlightRef.current) {
      // If an event arrives during a fetch, run one follow-up fetch (not N).
      refreshQueuedRef.current = true;
      return refreshInFlightRef.current;
    }
    const sequence = ++refreshSequenceRef.current;
    const pending = loadInstructorData(authToken)
      .then((data) => {
        if (activeTokenRef.current !== authToken || sequence !== refreshSequenceRef.current) return;
        setLobbies(data.lobbies);
        setSubmissions(data.submissions);
        setDashboardError(null);
      })
      .catch((error: unknown) => {
        if (activeTokenRef.current !== authToken || sequence !== refreshSequenceRef.current) return;
        setDashboardError(error instanceof Error ? error.message : 'Unable to load instructor data.');
      })
      .finally(() => {
        if (refreshInFlightRef.current !== pending) return;
        refreshInFlightRef.current = null;
        if (refreshQueuedRef.current && activeTokenRef.current === authToken) {
          refreshQueuedRef.current = false;
          void refreshDashboardData();
        }
      });
    refreshInFlightRef.current = pending;
    return pending;
  }, [authToken]);

  useEffect(() => {
    const savedTheme = getStoredTheme();
    setTheme(savedTheme);
    saveStoredTheme(savedTheme);

    const params = new URLSearchParams(window.location.search);
    // Accept both current ?lobby=UUID links and older /lobby/UUID links.
    const legacyMatch = window.location.pathname.match(/^\/lobby\/([^/]+)\/?$/i);
    const codeParam = params.get('lobby') || (legacyMatch ? decodeURIComponent(legacyMatch[1]) : null);
    if (codeParam) {
      setInitialStudentLobbyCode(codeParam);
      setCurrentView('student');
      return;
    }

    const savedInstructor = getSavedInstructor();
    const savedToken = getAuthToken();
    if (savedInstructor && savedToken) {
      setInstructor(savedInstructor);
      activeTokenRef.current = savedToken;
      setAuthToken(savedToken);
      setCurrentView('instructor');
    }
  }, []);

  // While a submission is running, refresh regularly even if the WebSocket is
  // healthy; inference may take long and its completion event can be missed.
  // After 10 minutes, return to normal polling to avoid hammering the backend
  // if an analysis is genuinely stalled.
  const hasRecentUnfinishedAnalysis = submissions.some((submission) => {
    if (submission.status !== 'pending' && submission.status !== 'analyzing') return false;
    const submittedAt = Date.parse(submission.submittedAt);
    return !Number.isFinite(submittedAt) || Date.now() - submittedAt < 10 * 60_000;
  });

  // Fetch on login once. WebSocket notifications refresh the live view;
  // polling slows down while a socket is healthy, but never stops entirely.
  useEffect(() => {
    if (!authToken) return;
    void refreshDashboardData();
  }, [authToken, refreshDashboardData]);

  useEffect(() => {
    if (!authToken) return;
    const timer = window.setInterval(
      () => void refreshDashboardData(), hasRecentUnfinishedAnalysis ? 5_000 : socketConnected ? 60_000 : 10_000,
    );
    return () => window.clearInterval(timer);
  }, [authToken, refreshDashboardData, socketConnected, hasRecentUnfinishedAnalysis]);

  const lobbyIdsKey = lobbies.map((lobby) => lobby.id).join(',');
  useEffect(() => {
    setSocketConnected(false);
    if (!authToken || !lobbyIdsKey) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refreshDashboardData(); }, 350);
    };
    const unsubscribe = subscribeToLobbyUpdates(
      authToken, lobbyIdsKey.split(','), scheduleRefresh, setSocketConnected,
    );
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [authToken, lobbyIdsKey, refreshDashboardData]);

  const handleToggleTheme = () => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    saveStoredTheme(nextTheme);
  };

  const handleLogin = (newInstructor: Instructor, token: string) => {
    saveAuthSession(newInstructor, token);
    setInstructor(newInstructor);
    activeTokenRef.current = token;
    setAuthToken(token);
    setCurrentView('instructor');
  };

  const handleLogout = () => {
    activeTokenRef.current = null;
    refreshSequenceRef.current += 1;
    refreshInFlightRef.current = null;
    refreshQueuedRef.current = false;
    setSocketConnected(false);
    clearAuthSession();
    setInstructor(null);
    setAuthToken(null);
    setLobbies([]);
    setSubmissions([]);
    setDashboardError(null);
    setCurrentView('home');
  };

  const handleLoadSubmissionCode = async (submission: Submission) => {
    if (!authToken) throw new Error('Please sign in again to view student code.');
    return getSubmissionCode(authToken, submission.lobbyId, submission.id);
  };

  const handleCreateLobby = async (data: {
    subject: string;
    title: string;
    language: 'c' | 'java' | 'python';
    durationMinutes: number;
    maxStudents: number;
  }): Promise<Lobby> => {
    if (!authToken) throw new Error('Please sign in again to create a lobby.');
    const lobby = await createRemoteLobby(
      authToken,
      data.subject,
      data.title,
      data.language,
      data.durationMinutes,
      data.maxStudents,
    );
    // Commit already succeeded. No full dashboard reload on the button path.
    refreshSequenceRef.current += 1; // Reject any older in-flight GET.
    setLobbies((previous) => [lobby, ...previous.filter((item) => item.id !== lobby.id)]);
    setDashboardError(null);
    return lobby;
  };

  const handleToggleLock = async (lobbyId: string) => {
    if (!authToken) throw new Error('Please sign in again to update this lobby.');
    const lobby = lobbies.find((item) => item.id === lobbyId);
    if (!lobby) throw new Error('This lobby is no longer available.');
    const updated = await setLobbyLocked(authToken, lobbyId, lobby.status === 'ACTIVE');
    refreshSequenceRef.current += 1;
    setLobbies((previous) => previous.map((item) => item.id === lobbyId ? updated : item));
    setDashboardError(null);
  };

  const handleExtendAndReopenLobby = async (lobbyId: string, durationMinutes: number) => {
    if (!authToken) throw new Error('Please sign in again to reopen this lobby.');
    const updated = await extendRemoteLobby(authToken, lobbyId, durationMinutes);
    refreshSequenceRef.current += 1; // Do not let an older GET undo this update.
    setLobbies((previous) => previous.map((item) => item.id === lobbyId ? updated : item));
    setDashboardError(null);
  };

  const handleDeleteLobby = async (lobbyId: string) => {
    if (!authToken) throw new Error('Please sign in again to delete this lobby.');
    await deleteRemoteLobby(authToken, lobbyId);
    refreshSequenceRef.current += 1;
    setLobbies((previous) => previous.filter((item) => item.id !== lobbyId));
    setSubmissions((previous) => previous.filter((item) => item.lobbyId !== lobbyId));
    setDashboardError(null);
  };

  const handleSwitchToStudentView = (lobbyCode: string) => {
    setInitialStudentLobbyCode(lobbyCode);
    setCurrentView('student');
  };

  const handleSetCurrentView = (view: 'home' | 'instructor' | 'student') => {
    setCurrentView(view);
  };

  return (
    <div className="ca-page flex flex-col font-sans transition-colors duration-200">
      <Navbar
        currentView={currentView}
        setCurrentView={handleSetCurrentView}
        instructor={instructor}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        logoutConfirmOpen={logoutConfirmOpen}
        setLogoutConfirmOpen={setLogoutConfirmOpen}
      />

      <main className="flex-1 w-full min-w-0">
        {currentView === 'home' ? (
          <HomeIntro
            onNavigateToStudent={() => setCurrentView('student')}
            onNavigateToInstructor={() => setCurrentView('instructor')}
            isInstructorLoggedIn={!!instructor}
          />
        ) : currentView === 'instructor' && !instructor ? (
          <InstructorLogin onLogin={handleLogin} />
        ) : currentView === 'instructor' && instructor ? (
          <section className="ca-hero ca-hero--app">
            <img src={instructorBg} alt="" className="ca-hero__media" aria-hidden="true" />
            <div className="ca-hero__scrim" aria-hidden="true" />
            <div className="ca-hero__content max-w-7xl mx-auto px-3 sm:px-6 w-full min-w-0">
              <InstructorDashboard
                instructor={instructor}
                lobbies={lobbies}
                submissions={submissions}
                onCreateLobby={handleCreateLobby}
                onToggleLock={handleToggleLock}
                onExtendAndReopen={handleExtendAndReopenLobby}
                onDeleteLobby={handleDeleteLobby}
                onSwitchToStudentView={handleSwitchToStudentView}
                onRefresh={refreshDashboardData}
                onLoadSubmissionCode={handleLoadSubmissionCode}
                errorMessage={dashboardError}
                theme={theme}
                onToggleTheme={handleToggleTheme}
                onLogout={() => setLogoutConfirmOpen(true)}
              />
            </div>
          </section>
        ) : currentView === 'student' ? (
          <section className="ca-hero ca-hero--app">
            <img src={instructorBg} alt="" className="ca-hero__media" aria-hidden="true" />
            <div className="ca-hero__scrim" aria-hidden="true" />
            <div className="ca-hero__content max-w-7xl mx-auto px-3 sm:px-6 w-full min-w-0">
              <StudentDashboard initialLobbyCode={initialStudentLobbyCode} />
            </div>
          </section>
        ) : null}
      </main>

      <footer className="relative z-10 border-t border-ca-border bg-ca-surface/95 backdrop-blur-md py-4 sm:py-6 px-3 sm:px-4 text-center text-xs text-ca-faint">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="font-extrabold text-ca-ink">
              Code<span className="text-ca-brand">Authentic</span>
            </span>
            <span>• CCIS, Caraga State University</span>
          </div>
          <div className="text-[11px] text-ca-muted">
            Frozen CodeBERT 770-dim feature extractor • C, Java, Python • Max 3 files/student
          </div>
        </div>
      </footer>
    </div>
  );
}
