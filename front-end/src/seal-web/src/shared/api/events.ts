import { apiFetch, type ApiResponse } from './core';

// ── Events ────────────────────────────────────────────────────────

export interface HackathonEvent {
  eventId: number;
  name: string;
  season: string;
  year: number;
  description?: string;
  topic?: string;
  registrationStart: string;
  registrationEnd: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'OPEN' | 'SETUP' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  trackSelectionMode?: 'SELF_SELECT' | 'RANDOM';
}

export interface CreateEventPayload {
  name: string;
  season: string;
  year: number;
  description?: string;
  topic?: string;
  registrationStart: string;
  registrationEnd: string;
  startDate: string;
  endDate: string;
  status?: string;
  trackSelectionMode?: string;
}

export interface UpdateEventPayload {
  name?: string;
  description?: string;
  topic?: string;
  status?: string;
  trackSelectionMode?: string;
  registrationStart?: string;
  registrationEnd?: string;
  startDate?: string;
  endDate?: string;
}

export const eventsApi = {
  getAll: () =>
    apiFetch<ApiResponse<HackathonEvent[]>>('/api/events'),

  getById: (eventId: number) =>
    apiFetch<ApiResponse<HackathonEvent>>(`/api/events/${eventId}`),

  create: (payload: CreateEventPayload) =>
    apiFetch<ApiResponse<HackathonEvent>>('/api/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: (eventId: number, payload: UpdateEventPayload) =>
    apiFetch<ApiResponse<HackathonEvent>>(`/api/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Complete a running event (IN_PROGRESS → COMPLETED). Backend: SYSTEM_ADMIN
  // only — a Coordinator token gets 403 here.
  complete: (eventId: number) =>
    apiFetch<ApiResponse<HackathonEvent>>(`/api/events/${eventId}/complete`, {
      method: 'POST',
    }),

  // Reopen a COMPLETED event (COMPLETED → IN_PROGRESS). Backend: SYSTEM_ADMIN
  // only — a Coordinator token gets 403 here.
  reopen: (eventId: number) =>
    apiFetch<ApiResponse<HackathonEvent>>(`/api/events/${eventId}/reopen`, {
      method: 'POST',
    }),
};

// ── Audit Log ──────────────────────────────────────────────────────
// Competition business-action trail for an event (CREATE_EVENT, DRAW_TRACKS,
// REDRAW_TRACKS...). Readable by the event's Coordinator and the System Admin.

export interface AuditLogEntry {
  logId: number;
  actorUserId: number;
  actorName?: string;
  action: string;
  targetType?: string;
  targetId?: number;
  reason?: string;
  metadataJson?: string;
  ipAddress?: string;
  createdAt: string;
}

export const auditLogsApi = {
  // Newest-first audit entries scoped to one event (target EVENT/eventId).
  getForEvent: (eventId: number) =>
    apiFetch<ApiResponse<AuditLogEntry[]>>(`/api/events/${eventId}/audit-logs`),
};
