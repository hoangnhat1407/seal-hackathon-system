import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiFetch, ApiError, teamsApi } from "@/shared/apiClient";

// ── Public AuthUser shape ────────────────────────────────────────────
export interface AuthUser {
  user_id: number;
  full_name: string;
  email: string;
  role: 'PARTICIPANT' | 'MENTOR' | 'JUDGE' | 'COORDINATOR' | 'ADMIN';
  student_type: 'FPT' | 'EXTERNAL' | null;
  student_id: string | null;
  university: string | null;
  avatar_url: string | null;
  is_leader: boolean;
  team_id: number | null;
  // true when team_id resolves to a team with no live season entry (past
  // event completed, or disqualified) — the team still "exists" for My Team,
  // but season-scoped screens (Submit Project) should stay hidden.
  team_dormant: boolean;
  // true for a first-time OAuth account that hasn't picked its userType yet
  profile_incomplete: boolean;
  // false until a coordinator approves the account
  approved: boolean;
  // true means a participant can only read existing data
  is_active: boolean;
}

export type LoginResult =
  | 'ok'
  | 'ok:select-role'
  | 'invalid_credentials'
  | 'pending_approval'
  | 'account_inactive'
  | 'access_denied';

// ── Context type ─────────────────────────────────────────────────────
interface AuthContextType {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  availableRoles: string[];
  activeRole: string | null;
  setActiveRole: (role: string | null) => void;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResult>;
  logout: () => Promise<void>;
  updateLeaderStatus: (isLeader: boolean) => void;
  clearTeam: () => void;
  refreshTeamContext: () => Promise<void>;
  patchCurrentUser: (fields: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Non-sensitive UI preference (which role tab is active) — always localStorage.
// A stale value from a different account is safely discarded elsewhere by the
// allRoles.includes(saved) check, so there's no need to mirror "remember me".
export const ACTIVE_ROLE_KEY = 'activeRole';

function getStoredActiveRole(): string | null {
  return localStorage.getItem(ACTIVE_ROLE_KEY);
}

function setStoredActiveRole(role: string | null) {
  if (role) {
    localStorage.setItem(ACTIVE_ROLE_KEY, role);
  } else {
    localStorage.removeItem(ACTIVE_ROLE_KEY);
  }
}

// ── API response shape (defensive — backend may vary) ─────────────────
export interface ApiUserProfile {
  userId?: number;
  user_id?: number;
  email: string;
  fullName?: string;
  full_name?: string;
  userType?: string;
  user_type?: string;
  studentId?: string | null;
  student_id?: string | null;
  university?: string | null;
  avatarUrl?: string | null;
  avatar_url?: string | null;
  // Role — API may return any of these; we handle all cases
  roles?: string | string[];
  role?: string | string[];
  roleName?: string;
  role_name?: string;
  // Team context (optional — may not be in auth response)
  teamId?: number | null;
  team_id?: number | null;
  isLeader?: boolean;
  is_leader?: boolean;
  isApproved?: boolean;
  is_approved?: boolean;
  isActive?: boolean;
  is_active?: boolean;
}

// ── Collects all raw role strings from backend profile ────────────────
const STAFF_ROLE_KEYWORDS = ['ADMIN', 'JUDGE', 'MENTOR', 'COORDINATOR'];

export function resolveAllRoles(profile: ApiUserProfile): string[] {
  const raw: string[] = [];
  const collect = (v: unknown) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === 'string') raw.push(v.toUpperCase().trim());
    else if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      if (obj.roleName) collect(obj.roleName);
      if (obj.role_name) collect(obj.role_name);
      if (obj.name) collect(obj.name);
    }
  };
  collect(profile.roles);
  collect(profile.role);
  collect(profile.roleName);
  collect(profile.role_name);
  return [...new Set(raw.filter(r => STAFF_ROLE_KEYWORDS.some(k => r.includes(k))))];
}

// ── Maps a raw backend role string to frontend AuthUser role ──────────
export function mapBackendRole(backendRole: string): AuthUser['role'] {
  const r = backendRole.toUpperCase();
  if (r.includes('ADMIN'))       return 'ADMIN';
  if (r.includes('COORDINATOR')) return 'COORDINATOR';
  if (r.includes('JUDGE'))       return 'JUDGE';
  if (r === 'MENTOR')            return 'MENTOR';
  return 'PARTICIPANT';
}

// ── CRITICAL: role resolver ───────────────────────────────────────────
// Handles: string, string[], nested object, snake_case, camelCase
// Priority: ADMIN > COORDINATOR > JUDGE > MENTOR > PARTICIPANT
export function resolveRole(profile: ApiUserProfile): AuthUser['role'] {
  const raw: string[] = [];

  const collect = (v: unknown) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === 'string') raw.push(v.toUpperCase().trim());
    else if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      if (obj.roleName) collect(obj.roleName);
      if (obj.role_name) collect(obj.role_name);
      if (obj.name) collect(obj.name);
    }
  };

  collect(profile.roles);
  collect(profile.role);
  collect(profile.roleName);
  collect(profile.role_name);

  if (raw.some(r => r.includes('ADMIN')))       return 'ADMIN';
  if (raw.some(r => r.includes('COORDINATOR'))) return 'COORDINATOR';
  if (raw.some(r => r.includes('JUDGE')))       return 'JUDGE';
  if (raw.some(r => r === 'MENTOR'))            return 'MENTOR';
  return 'PARTICIPANT';
}

export function mapApiUser(profile: ApiUserProfile): AuthUser {
  const userType = profile.userType ?? profile.user_type ?? '';
  const isActive = profile.isActive ?? profile.is_active ?? true;
  return {
    user_id:      profile.userId ?? profile.user_id ?? 0,
    full_name:    profile.fullName ?? profile.full_name ?? '',
    email:        profile.email,
    role:         resolveRole(profile),
    student_type: userType === 'FPT_STUDENT'      ? 'FPT'
                : userType === 'EXTERNAL_STUDENT'  ? 'EXTERNAL'
                : null,
    student_id:   profile.studentId ?? profile.student_id ?? null,
    university:   profile.university ?? null,
    avatar_url:   profile.avatarUrl ?? profile.avatar_url ?? null,
    is_leader:    profile.isLeader ?? profile.is_leader ?? false,
    team_id:      profile.teamId ?? profile.team_id ?? null,
    team_dormant: false,
    profile_incomplete: userType === 'PENDING_PROFILE',
    approved:     profile.isApproved ?? profile.is_approved ?? true,
    is_active:    isActive,
  };
}

// ── Team context ──────────────────────────────────────────────────────
// team_id / is_leader are NOT in /api/auth/me — they live in /api/teams/my,
// which only PARTICIPANTs may call. Until the backend adds member userId / a
// myRole field to MyTeamResponse, leadership is inferred by matching the full
// name (temporary — see deferred backend note).
async function fetchTeamContext(role: AuthUser['role'], fullName: string, userId?: number): Promise<{ teamId: number | null; isLeader: boolean; teamDormant: boolean }> {
  if (role !== 'PARTICIPANT') return { teamId: null, isLeader: false, teamDormant: false };
  try {
    const res = await teamsApi.getMy();
    const t = res.data;
    if (!t || t.teamId == null) return { teamId: null, isLeader: false, teamDormant: false };
    const myRole = t.myRole
      ?? t.members?.find(m => userId != null && m.userId === userId)?.role
      ?? t.members?.find(m => m.memberName === fullName)?.role;
    // Same "dormant" condition TeamViewPage/ExistingTeamDashboard gate their
    // rejoin banner on — a team with no live season entry.
    const teamDormant = t.status === 'DISQUALIFIED' || t.eventStatus === 'COMPLETED';
    return { teamId: t.teamId, isLeader: (myRole ?? '').toString().toUpperCase() === 'LEADER', teamDormant };
  } catch {
    return { teamId: null, isLeader: false, teamDormant: false };
  }
}

// ── Provider ──────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [activeRole, setActiveRoleState] = useState<string | null>(
    () => getStoredActiveRole(),
  );

  // ── Active role setter (persists to localStorage) ───────────────────
  function setActiveRole(role: string | null) {
    setActiveRoleState(role);
    if (role) {
      setStoredActiveRole(role);
      setCurrentUser(prev => prev ? { ...prev, role: mapBackendRole(role) } : prev);
    } else {
      setStoredActiveRole(null);
      setCurrentUser(prev => prev ? { ...prev, role: 'PARTICIPANT' } : prev);
    }
  }

  // ── Restore session from the auth cookie on mount ─────────────────────
  // The cookie is HttpOnly — JS can't check for its presence, so just ask the
  // backend; a 401 means "not logged in".
  useEffect(() => {
    apiFetch<{ data: ApiUserProfile }>('/api/auth/me')
      .then(async res => {
        const allRoles = resolveAllRoles(res.data);
        setAvailableRoles(allRoles);

        let resolvedActive: string | null = null;
        if (allRoles.length === 1) {
          resolvedActive = allRoles[0];
          setStoredActiveRole(resolvedActive);
        } else if (allRoles.length > 1) {
          const saved = getStoredActiveRole();
          resolvedActive = (saved && allRoles.includes(saved)) ? saved : null;
          if (!resolvedActive) setStoredActiveRole(null);
        }

        setActiveRoleState(resolvedActive);
        const authUser = mapApiUser(res.data);
        if (resolvedActive) authUser.role = mapBackendRole(resolvedActive);
        const tc = await fetchTeamContext(authUser.role, authUser.full_name, authUser.user_id);
        authUser.team_id = tc.teamId;
        authUser.is_leader = tc.isLeader;
        authUser.team_dormant = tc.teamDormant;
        setCurrentUser(authUser);
      })
      .catch(() => {
        setStoredActiveRole(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // ── Login (real API) ────────────────────────────────────────────────
  async function login(
    email: string,
    password: string,
    rememberMe = false,
  ): Promise<LoginResult> {
    try {
      // Wipe any prior session before authenticating a new one — otherwise a
      // leftover activeRole / user from the previous account can bleed into
      // the new login and make subsequent requests carry the wrong identity.
      setStoredActiveRole(null);
      setCurrentUser(null);
      setAvailableRoles([]);
      setActiveRoleState(null);

      // Step 1: authenticate — backend sets the JWT as an HttpOnly cookie.
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, rememberMe }),
      });

      // Step 2: fetch full profile (roles live here, not in the login response)
      const meRes = await apiFetch<{ data: ApiUserProfile }>('/api/auth/me');
      const allRoles = resolveAllRoles(meRes.data);
      setAvailableRoles(allRoles);

      let resolvedActive: string | null = null;
      if (allRoles.length === 1) {
        resolvedActive = allRoles[0];
        setStoredActiveRole(resolvedActive);
      } else if (allRoles.length > 1) {
        // Check if there is a previously saved valid role
        const saved = getStoredActiveRole();
        resolvedActive = (saved && allRoles.includes(saved)) ? saved : null;
        if (!resolvedActive) setStoredActiveRole(null);
      }

      setActiveRoleState(resolvedActive);
      const authUser = mapApiUser(meRes.data);
      if (resolvedActive) authUser.role = mapBackendRole(resolvedActive);
      const tc = await fetchTeamContext(authUser.role, authUser.full_name, authUser.user_id);
      authUser.team_id = tc.teamId;
      authUser.is_leader = tc.isLeader;
      authUser.team_dormant = tc.teamDormant;
      setCurrentUser(authUser);
      // Signal to the caller that the user must pick a role before entering any dashboard
      return allRoles.length > 1 && resolvedActive === null ? 'ok:select-role' : 'ok';
    } catch (err) {
      setStoredActiveRole(null);
      if (err instanceof ApiError) {
        if (err.status === 403 && err.message.toLowerCase().includes('pending approval')) {
          return 'pending_approval';
        }
        if (err.status === 403 && err.message.toLowerCase().includes('inactive')) {
          return 'account_inactive';
        }
        if (err.status === 403) return 'access_denied';
        if (err.status === 401) return 'invalid_credentials';
      }
      return 'invalid_credentials';
    }
  }

  // ── Logout ──────────────────────────────────────────────────────────
  async function logout(): Promise<void> {
    // Clear local state immediately for snappy UX
    setStoredActiveRole(null);
    setCurrentUser(null);
    setAvailableRoles([]);
    setActiveRoleState(null);

    // Call backend to clear the HttpOnly auth cookie and CSRF cookie
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout — local state is already cleared
    }
  }

  function updateLeaderStatus(isLeader: boolean) {
    setCurrentUser(prev => prev ? { ...prev, is_leader: isLeader } : prev);
  }

  function clearTeam() {
    setCurrentUser(prev => prev ? { ...prev, team_id: null, is_leader: false, team_dormant: false } : prev);
  }

  // Apply edited profile fields to the in-memory user (after PUT /api/auth/me).
  function patchCurrentUser(fields: Partial<AuthUser>) {
    setCurrentUser(prev => prev ? { ...prev, ...fields } : prev);
  }

  // Re-pull team membership (team_id / is_leader) after the user creates,
  // joins, or leaves a team — keeps routing and the sidebar in sync.
  async function refreshTeamContext() {
    if (!currentUser) return;
    const tc = await fetchTeamContext(currentUser.role, currentUser.full_name, currentUser.user_id);
    setCurrentUser(prev => prev ? { ...prev, team_id: tc.teamId, is_leader: tc.isLeader, team_dormant: tc.teamDormant } : prev);
  }

  return (
    <AuthContext.Provider value={{
      currentUser,
      isAuthenticated: !!currentUser,
      isLoading,
      availableRoles, activeRole, setActiveRole,
      login, logout, updateLeaderStatus, clearTeam, refreshTeamContext, patchCurrentUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
