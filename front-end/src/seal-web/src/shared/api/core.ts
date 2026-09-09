const BASE_URL = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? 'http://localhost:8080';
export const API_BASE_URL = BASE_URL;

// ── CSRF helper ──────────────────────────────────────────────────────
// The JWT itself lives in an HttpOnly cookie the browser attaches automatically
// and JS can never read. The CSRF token rides in a separate, JS-readable
// cookie (double-submit pattern) — read it here and echo it back as a header
// on state-changing requests.
function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// The XSRF-TOKEN cookie is only set once the browser has processed a response
// from the backend. On a cold start (or right after logout) the very first
// state-changing request can fire before any response has set it — the request
// would then go out with no X-XSRF-TOKEN header and be rejected with 403 (the
// "forbidden for the first 1-3s, works on retry" symptom). Prime it here with a
// cheap GET (every response sets the cookie) so mutations never race the token.
//
// Bulk actions (e.g. "Release All") fire several mutations via Promise.all — if
// none of them has a cookie yet, each would otherwise fire its OWN priming GET,
// and the backend hands out a different random token per unauthenticated GET.
// Those responses race to overwrite document.cookie, so one request's header
// (captured right after ITS priming GET resolved) can end up mismatched against
// whatever the LAST priming GET wrote — a genuine 403. Dedupe concurrent primes
// into a single in-flight promise so every caller in the burst awaits the same
// GET and reads the same resulting cookie value.
let csrfPriming: Promise<string | null> | null = null;

async function ensureCsrfToken(force = false): Promise<string | null> {
  if (!force) {
    const existing = getCsrfToken();
    if (existing) return existing;
  }
  if (!csrfPriming) {
    csrfPriming = fetch(`${BASE_URL}/api/csrf`, { credentials: 'include' })
      .catch(() => {})
      .then(() => getCsrfToken())
      .finally(() => { csrfPriming = null; });
  }
  return csrfPriming;
}

// ── Error shape ──────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Pull a user-facing message out of any thrown value. Backend errors surface
// as ApiError (message from the API body); anything else gets the fallback.
// Used by CRUD handlers to feed the failure banner a meaningful message.
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ── Core fetch wrapper ───────────────────────────────────────────────
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false,
): Promise<T> {
  // For FormData (file uploads) let the browser set the multipart Content-Type
  // with its boundary — forcing application/json would break the request.
  const isFormData = options.body instanceof FormData;
  const method = (options.method ?? 'GET').toUpperCase();
  const isMutation = method !== 'GET' && method !== 'HEAD';
  // GET/HEAD don't need CSRF; for everything else make sure the token cookie
  // exists first (priming it if this is the first backend contact).
  const csrfToken = isMutation ? await ensureCsrfToken() : null;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include', // send/receive the HttpOnly auth cookie
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfToken ? { 'X-XSRF-TOKEN': csrfToken } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    // If a mutation failed with 403, it could be a stale/mismatched CSRF token.
    // Re-prime a fresh token from /api/csrf and retry once before failing.
    if (res.status === 403 && isMutation && !isRetry) {
      const freshCsrf = await ensureCsrfToken(true);
      if (freshCsrf) {
        return apiFetch<T>(path, options, true);
      }
    }

    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}
