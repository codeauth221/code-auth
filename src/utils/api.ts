import { Instructor, Language, Lobby, Submission } from '../types';
import { utcTimestamp } from './dateTime';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

/** Share the frontend's public page, not the FastAPI origin or a development localhost. */
export function studentLobbyUrl(lobbyId: string): string {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('lobby', lobbyId);
  return url.toString();
}

const TOKEN_KEY = 'codeauthentic_token';

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface ApiLobby {
  id: string;
  subject: string;
  title: string;
  language: Language;
  max_students: number;
  status: 'ACTIVE' | 'LOCKED';
  created_at: string;
  expires_at: string;
  shareable_url: string;
  submissions?: ApiSubmission[];
}

interface ApiSubmission {
  id: number;
  lobby_id: string;
  student_id: string;
  file_name: string;
  language: Language;
  status: Submission['status'];
  ai_probability: number | null;
  risk_level: Submission['riskLevel'];
  error_message?: string | null;
  created_at: string;
  analysis_started_at?: string | null;
  analysis_finished_at?: string | null;
}

interface ApiSubmissionCode {
  id: number;
  lobby_id: string;
  source_code: string;
  token_count: number | null;
}

/** Instructor-only readiness; the backend verifies files but does not assert accuracy. */
export interface MlReadiness {
  ready_languages: Language[];
  experimental_languages: Language[];
  active_languages: Language[];
  languages: Record<Language, {
    evaluated_head_present: boolean;
    experimental: boolean;
    issue: string | null;
  }>;
}

interface ApiPublicLobby {
  active: boolean;
  subject: string;
  title: string;
  language: Language;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // Bounded waiting avoids buttons that spin indefinitely. A timed-out
  // write may still have committed; the error tells users to check first.
  const controller = new AbortController();
  const timeoutMs = path.endsWith('/submit') ? 120_000 : 45_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options, headers, signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      const mutation = options.method && options.method !== 'GET';
      throw new ApiRequestError(
        mutation
          ? 'The request timed out. It may have completed on the server. Refresh/check the dashboard before retrying to avoid duplicates.'
          : 'The server took too long to respond. Check the FastAPI backend and database connection.',
        0,
      );
    }
    throw new ApiRequestError(
      'Cannot connect to the CodeAuthentic backend. Check FastAPI, VITE_API_BASE_URL and backend CORS settings.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  const isJson = (response.headers.get('content-type') || '').toLowerCase().includes('json');
  if (!response.ok) {
    if (!isJson) {
      throw new ApiRequestError(
        response.status === 404
          ? 'The backend API endpoint was not found. Check VITE_API_BASE_URL; the frontend may be calling Vercel instead of FastAPI.'
          : `The backend returned HTTP ${response.status} instead of an API response. Check the deployed API and its logs.`,
        response.status,
      );
    }
    let message = `Request failed (${response.status})`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'detail' in body) {
        const detail = (body as { detail: unknown }).detail;
        if (typeof detail === 'string') message = detail;
      }
    } catch {
      // Preserve the status-specific error if JSON cannot be parsed.
    }
    throw new ApiRequestError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  if (!isJson) {
    throw new ApiRequestError(
      'The API returned a web page instead of JSON. Configure VITE_API_BASE_URL to the deployed FastAPI origin and redeploy the frontend.',
      response.status,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError('The backend returned invalid JSON. Check the API server logs.', response.status);
  }
}

function mapSubmission(submission: ApiSubmission): Submission {
  return {
    id: String(submission.id),
    lobbyId: submission.lobby_id,
    studentId: submission.student_id,
    fileName: submission.file_name,
    language: submission.language,
    sourceCode: '',
    status: submission.status === 'done' &&
      (typeof submission.ai_probability !== 'number' || !Number.isFinite(submission.ai_probability) ||
       submission.ai_probability < 0 || submission.ai_probability > 1 ||
       !['Low', 'Medium', 'High'].includes(submission.risk_level || ''))
        ? 'failed' : submission.status,
    aiProbability: submission.status === 'done' &&
      typeof submission.ai_probability === 'number' && Number.isFinite(submission.ai_probability) &&
      submission.ai_probability >= 0 && submission.ai_probability <= 1 &&
      ['Low', 'Medium', 'High'].includes(submission.risk_level || '')
        ? submission.ai_probability : null,
    riskLevel: submission.status === 'done' &&
      typeof submission.ai_probability === 'number' && Number.isFinite(submission.ai_probability) &&
      submission.ai_probability >= 0 && submission.ai_probability <= 1
        ? submission.risk_level : null,
    errorMessage: submission.error_message || (
      submission.status === 'done' &&
      (submission.ai_probability === null || !['Low', 'Medium', 'High'].includes(submission.risk_level || ''))
        ? 'The backend returned an incomplete analysis result. No score was assigned.' : undefined
    ),
    tokenCount: null,
    indicators: [],
    submittedAt: utcTimestamp(submission.created_at),
    analysisStartedAt: submission.analysis_started_at ? utcTimestamp(submission.analysis_started_at) : null,
    analysisFinishedAt: submission.analysis_finished_at ? utcTimestamp(submission.analysis_finished_at) : null,
  };
}

export function mapLobby(lobby: ApiLobby): Lobby {
  return {
    id: lobby.id,
    code: lobby.id,
    language: lobby.language,
    subject: lobby.subject || lobby.title,
    title: lobby.subject ? lobby.title : '',
    instructorId: '',
    instructorEmail: '',
    maxStudents: lobby.max_students,
    durationMinutes: Math.max(
      1,
      Math.ceil(
        (new Date(utcTimestamp(lobby.expires_at)).getTime() - new Date(utcTimestamp(lobby.created_at)).getTime()) /
          60_000,
      ),
    ),
    createdAt: utcTimestamp(lobby.created_at),
    expiresAt: utcTimestamp(lobby.expires_at),
    status: lobby.status,
    maxUploadsPerStudent: 3,
    // The API may run on another domain; the student's URL must open this React app.
    shareableUrl: studentLobbyUrl(lobby.id),
  };
}

export async function loginInstructor(
  email: string,
  password: string,
): Promise<string> {
  const result = await request<{ access_token: string }>('/auth/login/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return result.access_token;
}

export async function registerInstructor(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
}

export async function getMlReadiness(token: string): Promise<MlReadiness> {
  // Older FastAPI versions may omit these new fields. Normalize them rather
  // than crashing an instructor dashboard during a staggered update.
  const data = await request<Partial<MlReadiness>>('/ml/status', { cache: 'no-store' }, token);
  const ready = Array.isArray(data.ready_languages) ? data.ready_languages : [];
  const experimental = Array.isArray(data.experimental_languages) ? data.experimental_languages : [];
  return {
    ready_languages: ready,
    experimental_languages: experimental,
    active_languages: Array.isArray(data.active_languages)
      ? data.active_languages : ready.filter((lang) => !experimental.includes(lang)),
    languages: data.languages || {} as MlReadiness['languages'],
  };
}

export async function loadInstructorData(token: string): Promise<{
  lobbies: Lobby[];
  submissions: Submission[];
}> {
  let result: { lobbies: ApiLobby[]; submissions: ApiSubmission[] };
  try {
    // One owner-protected request replaces GET /lobbies + N detail requests.
    // The response includes only metadata, never student source code.
    result = await request<{ lobbies: ApiLobby[]; submissions: ApiSubmission[] }>(
      '/instructor/dashboard', {}, token,
    );
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      throw new ApiRequestError(
        'The FastAPI backend needs the matching performance update. Restart the updated backend and verify /instructor/dashboard in /docs.',
        404,
      );
    }
    throw error;
  }
  return {
    lobbies: result.lobbies.map(mapLobby),
    submissions: result.submissions.map(mapSubmission),
  };
}

/** Fetch a single source file privately; never include source code in live broadcasts. */
export async function getSubmissionCode(
  token: string,
  lobbyId: string,
  submissionId: string,
): Promise<{ sourceCode: string; tokenCount: number | null }> {
  let code: ApiSubmissionCode;
  try {
    code = await request<ApiSubmissionCode>(
      `/lobbies/${encodeURIComponent(lobbyId)}/submissions/${encodeURIComponent(submissionId)}/code`,
      { cache: 'no-store' },
      token,
    );
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      const missingRoute = /^(not found|the backend api endpoint was not found)/i.test(error.message);
      throw new ApiRequestError(
        missingRoute
          ? 'The running FastAPI backend is outdated or the API URL is incorrect. Deploy the matching backend, restart it, and verify this GET route exists in /docs.'
          : 'This saved submission was not found in your instructor lobby. Refresh the dashboard and retry.',
        404,
      );
    }
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      throw new ApiRequestError('Your instructor session is expired or not authorized for this submission. Sign in again.', error.status);
    }
    throw error;
  }
  if (String(code.id) !== submissionId || code.lobby_id.toLowerCase() !== lobbyId.toLowerCase() || typeof code.source_code !== 'string') {
    throw new Error('The backend returned invalid source-code details. Please refresh and try again.');
  }
  return { sourceCode: code.source_code, tokenCount: code.token_count ?? null };
}

/** Subscribe to existing lobby-scoped instructor sockets. Caller must clean up. */
export function subscribeToLobbyUpdates(
  token: string,
  lobbyIds: string[],
  onUpdate: () => void,
  onConnectionChange?: (connected: boolean) => void,
): () => void {
  if (typeof WebSocket === 'undefined') return () => {};
  const origin = new URL(API_BASE_URL || window.location.origin, window.location.origin);
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return () => {};
  origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';

  let stopped = false;
  const sockets = new Set<WebSocket>();
  const reconnectTimers = new Set<ReturnType<typeof setTimeout>>();
  const heartbeatTimers = new Set<ReturnType<typeof setInterval>>();
  let connectedCount = 0;
  const notifyConnection = () => { if (!stopped) onConnectionChange?.(connectedCount > 0); };

  for (const lobbyId of [...new Set(lobbyIds)]) {
    let retries = 0;
    let everConnected = false;
    const connect = () => {
      if (stopped) return;
      const url = new URL(`/ws/lobbies/${encodeURIComponent(lobbyId)}`, origin);
      // Browser WebSockets cannot send an Authorization header; subprotocols
      // keep the JWT out of the URL and ordinary proxy access logs.
      let socket: WebSocket;
      try {
        socket = new WebSocket(url.toString(), ['codeauthentic', `auth.${token}`]);
      } catch {
        // A malformed URL or disabled WebSocket must not crash the dashboard.
        const delay = Math.min(30_000, 2_000 * 2 ** Math.min(retries++, 4));
        const timer = setTimeout(() => { reconnectTimers.delete(timer); connect(); }, delay);
        reconnectTimers.add(timer);
        return;
      }
      sockets.add(socket);
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let opened = false;

      socket.onopen = () => {
        opened = true;
        connectedCount += 1;
        notifyConnection();
        retries = 0;
        // Lightweight keepalive for connections behind proxies/load balancers.
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        }, 25_000);
        heartbeatTimers.add(heartbeat);
        // The initial dashboard fetch has already loaded state; don't trigger
        // a redundant request for every first-opened lobby socket. On a later
        // reconnect, fetch once to recover any events missed while offline.
        if (everConnected) onUpdate();
        everConnected = true;
      };
      socket.onmessage = (event) => {
        try {
          const message: unknown = JSON.parse(event.data);
          if (message && typeof message === 'object' && 'type' in message &&
            (message.type === 'submission_created' || message.type === 'submission_updated')) {
            onUpdate();
          }
        } catch {
          // Ignore plain-text pong and malformed unsolicited events.
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = (event) => {
        if (opened) { opened = false; connectedCount = Math.max(0, connectedCount - 1); notifyConnection(); }
        sockets.delete(socket);
        if (heartbeat) { clearInterval(heartbeat); heartbeatTimers.delete(heartbeat); }
        if (stopped || event.code === 1008) return; // Forbidden/expired JWT: do not retry.
        const delay = Math.min(30_000, 2_000 * 2 ** Math.min(retries++, 4));
        const timer = setTimeout(() => { reconnectTimers.delete(timer); connect(); }, delay);
        reconnectTimers.add(timer);
      };
    };
    connect();
  }

  return () => {
    stopped = true;
    reconnectTimers.forEach(clearTimeout);
    heartbeatTimers.forEach(clearInterval);
    sockets.forEach((socket) => socket.close());
  };
}

export async function createLobby(
  token: string,
  subject: string,
  title: string,
  language: Language,
  durationMinutes: number,
  maxStudents: number,
): Promise<Lobby> {
  const lobby = await request<ApiLobby>(
    '/lobbies',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        title,
        language,
        duration_minutes: durationMinutes,
        max_students: maxStudents,
      }),
    },
    token,
  );
  return mapLobby(lobby);
}

export async function setLobbyLocked(
  token: string,
  lobbyId: string,
  locked: boolean,
): Promise<Lobby> {
  const updated = await request<ApiLobby>(
    `/lobbies/${encodeURIComponent(lobbyId)}/${locked ? 'lock' : 'unlock'}`,
    { method: 'POST' },
    token,
  );
  return mapLobby(updated);
}

export async function deleteLobby(token: string, lobbyId: string): Promise<void> {
  await request<void>(
    `/lobbies/${encodeURIComponent(lobbyId)}`,
    { method: 'DELETE' },
    token,
  );
}

export async function getPublicLobby(lobbyId: string): Promise<ApiPublicLobby> {
  return request<ApiPublicLobby>(
    `/public/lobbies/${encodeURIComponent(lobbyId)}/status`,
  );
}

export async function submitLobbyFiles(
  lobbyId: string,
  studentId: string,
  files: Array<{ name: string; content: string }>,
): Promise<void> {
  const body = new FormData();
  body.append('student_id', studentId);
  for (const file of files) {
    body.append('files', new Blob([file.content]), file.name);
  }
  await request(`/lobbies/${encodeURIComponent(lobbyId)}/submit`, {
    method: 'POST',
    body,
  });
}

export function saveAuthSession(instructor: Instructor, token: string): void {
  localStorage.setItem('codeauthentic_instructor', JSON.stringify(instructor));
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthSession(): void {
  localStorage.removeItem('codeauthentic_instructor');
  localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getSavedInstructor(): Instructor | null {
  const saved = localStorage.getItem('codeauthentic_instructor');
  if (!saved) return null;
  try {
    return JSON.parse(saved) as Instructor;
  } catch {
    return null;
  }
}
