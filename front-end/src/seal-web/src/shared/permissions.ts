// Event lifecycle authorization — single source of truth for the FE.
//
// These are PURE functions of the (frontend) role string so they are trivial to
// unit-test and to reuse across pages. They mirror the backend rules, which are
// the REAL gate (see HackathonEventController):
//   - SYSTEM_ADMIN and EVENT_COORDINATOR may create or reopen an event.
//   - Coordinators run an event's forward lifecycle (OPEN→SETUP→IN_PROGRESS→
//     COMPLETED) and can directly reopen a COMPLETED one.
//
// The FE role is the normalized value from AuthProvider
// ('ADMIN' | 'COORDINATOR' | 'JUDGE' | 'MENTOR' | 'PARTICIPANT'), NOT the raw
// backend role name (SYSTEM_ADMIN / EVENT_COORDINATOR).

import { useAuth } from "@/app/providers/AuthProvider";

export type AppRole = 'PARTICIPANT' | 'MENTOR' | 'JUDGE' | 'COORDINATOR' | 'ADMIN';

/** Creating a new event — Coordinator only. */
export function canCreateEvent(role: AppRole | null | undefined): boolean {
  return role === 'COORDINATOR';
}

/** Directly reopening a COMPLETED event (COMPLETED → IN_PROGRESS) — Coordinator only. */
export function canReopenEvent(role: AppRole | null | undefined): boolean {
  return role === 'COORDINATOR';
}

/**
 * Completing a running event (IN_PROGRESS → COMPLETED) — Coordinator only.
 */
export function canCompleteEvent(role: AppRole | null | undefined): boolean {
  return role === 'COORDINATOR';
}

/**
 * Driving the Coordinator-run lifecycle transitions (OPEN, SETUP, START...).
 */
export function canChangeEventStatus(role: AppRole | null | undefined): boolean {
  return role === 'COORDINATOR';
}

/**
 * Hook wrapper reading the current user's role from AuthProvider. Pages can call
 * `const perms = usePermissions()` and read `perms.canCreateEvent`, etc.
 */
export function usePermissions() {
  const { currentUser } = useAuth();
  const role = (currentUser?.role ?? null) as AppRole | null;
  return {
    role,
    canCreateEvent: canCreateEvent(role),
    canReopenEvent: canReopenEvent(role),
    canCompleteEvent: canCompleteEvent(role),
    canChangeEventStatus: canChangeEventStatus(role),
  };
}

