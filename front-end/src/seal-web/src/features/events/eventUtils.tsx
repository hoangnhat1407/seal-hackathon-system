import { useState, type ReactNode } from "react";
import { C, PixelBadge, PixelCard, PixelInput } from "@/shared/components/PixelComponents";
import type { ConfirmVariant } from "@/shared/components/ConfirmDialog";

// Shared event model + presentation helpers used by both CoordEventsPage and
// AdminEventsPage. Status enum mirrors the backend HackathonEvent.status:
// DRAFT → OPEN → SETUP → IN_PROGRESS → COMPLETED (+ CANCELLED from any
// non-terminal state). SETUP = registration closed, draw/lock tracks.

export type EventStatus = 'DRAFT' | 'OPEN' | 'SETUP' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TrackMode = 'SELF_SELECT' | 'RANDOM';

export interface ApiEvent {
  id?: number; eventId?: number; event_id?: number;
  name?: string;
  season?: string;
  year?: number;
  description?: string | null;
  topic?: string | null;
  registrationStart?: string; registration_start?: string;
  registrationEnd?: string; registration_end?: string;
  startDate?: string; start_date?: string;
  endDate?: string; end_date?: string;
  status?: string;
  trackSelectionMode?: string; track_selection_mode?: string;
}

export interface EventRow {
  eventId: number;
  name: string;
  season: string;
  year: number | null;
  topic: string;
  registrationStart: string;
  registrationEnd: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  trackSelectionMode: TrackMode;
}

const STATUSES: EventStatus[] = ['DRAFT', 'OPEN', 'SETUP', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

// Parse a "DD/MM" string against a given year into an ISO date (yyyy-mm-dd),
// or null if the text isn't a valid day/month. Shared by the Admin event form
// and the Coordinator round form, both of which let the user type only the
// day/month while the year is fixed elsewhere (the season year, or the
// parent event's year).
export function parseDDMM(ddmm: string, year: string | number): string | null {
  const m = ddmm.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Inverse of parseDDMM, for display. Reads the day/month straight out of the
// "yyyy-mm-dd..." prefix (rather than via `new Date(...)`) so a date-only
// string isn't misread as UTC midnight and shifted a day by the local
// timezone offset.
export function toDDMM(dateStr: string | null | undefined): string {
  const m = (dateStr ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : "";
}

// The calendar year a date-ish string starts with, or the current year if
// unparseable. Used to resolve the year for a "DD/MM"-only field.
export function yearOf(dateStr: string | null | undefined): number {
  const m = (dateStr ?? "").match(/^(\d{4})-/);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

export function normalizeEvent(item: ApiEvent): EventRow {
  const status = (item.status ?? 'DRAFT').toUpperCase();
  return {
    eventId:           item.id ?? item.eventId ?? item.event_id ?? 0,
    name:              item.name ?? '',
    season:            item.season ?? '',
    year:              item.year ?? null,
    topic:             item.topic ?? '',
    registrationStart: item.registrationStart ?? item.registration_start ?? '',
    registrationEnd:   item.registrationEnd ?? item.registration_end ?? '',
    startDate:         item.startDate ?? item.start_date ?? '',
    endDate:           item.endDate ?? item.end_date ?? '',
    status:            (STATUSES.includes(status as EventStatus) ? status : 'DRAFT') as EventStatus,
    trackSelectionMode: ((item.trackSelectionMode ?? item.track_selection_mode ?? 'SELF_SELECT').toUpperCase() === 'RANDOM' ? 'RANDOM' : 'SELF_SELECT') as TrackMode,
  };
}

export function eventStatusBadge(status: EventStatus) {
  if (status === 'OPEN')        return <PixelBadge color="green">OPEN</PixelBadge>;
  if (status === 'SETUP')       return <PixelBadge color="yellow">SETUP</PixelBadge>;
  if (status === 'IN_PROGRESS') return <PixelBadge color="cyan">IN_PROGRESS</PixelBadge>;
  if (status === 'COMPLETED')   return <PixelBadge color="blue">COMPLETED</PixelBadge>;
  if (status === 'CANCELLED')   return <PixelBadge color="red">CANCELLED</PixelBadge>;
  return <PixelBadge color="gray">DRAFT</PixelBadge>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Break a stored datetime into date parts, or null if absent/unparseable.
function dateParts(s?: string): { d: number; m: string; y: number } | null {
  if (!s) return null;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return { d: dt.getDate(), m: MONTHS[dt.getMonth()], y: dt.getFullYear() };
}

// Concise event period, e.g. "28 May → 27 Jun 2026" (year printed once when the
// range stays in one year). Season/year are omitted here — they already live in
// the event name — and the time-of-day is dropped to keep the line uncluttered.
export function eventMeta(ev: EventRow): string {
  const a = dateParts(ev.startDate);
  const b = dateParts(ev.endDate);
  if (a && b) {
    return a.y === b.y
      ? `${a.d} ${a.m} → ${b.d} ${b.m} ${b.y}`
      : `${a.d} ${a.m} ${a.y} → ${b.d} ${b.m} ${b.y}`;
  }
  const only = a ?? b;
  return only ? `${only.d} ${only.m} ${only.y}` : "";
}

// Event name — solid accent color + a single soft glow, the same treatment
// CyberStatCard already uses for its headline numbers elsewhere in the app.
// Deliberately restrained: no gradient fill, no text-stroke outline — earlier
// attempts stacking gradient + heavy stroke + triple drop-shadow read as
// cluttered "neon sign" noise instead of a clean heading. No pill/border,
// unlike EventDateBadge, so the name still reads as the row's title rather
// than another tag. Static — no animation (a pulsing glow was imperceptible
// at a glance in a static screenshot, per earlier feedback).
export function EventName({ children, size = 22 }: { children: React.ReactNode; size?: number }) {
  return (
    <span
      style={{
        color: C.greenBright,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: size,
        fontWeight: 800,
        letterSpacing: "0.01em",
        textShadow: `0 0 14px ${C.greenGlow}`,
      }}
    >
      {children}
    </span>
  );
}

// Glowing badge rendering of eventMeta() — used everywhere an event's date
// range is shown (events list, Admin/Coordinator detail panels) so the period
// reads as a distinct, glanceable pill instead of flat muted text.
export function EventDateBadge({ ev }: { ev: EventRow }) {
  const label = eventMeta(ev);
  if (!label) return null;
  return <PixelBadge color="cyan" glow>{label}</PixelBadge>;
}

// endDate as a sortable timestamp; missing/invalid dates sort last (-Infinity).
function endTime(ev: EventRow): number {
  const t = ev.endDate ? new Date(ev.endDate).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

function latestByEndDate(rows: EventRow[]): EventRow {
  return rows.reduce((best, ev) => (endTime(ev) > endTime(best) ? ev : best));
}

// Which event the Events console highlights by default on first load. Lands the
// actor on the event that is currently being managed, ignoring DRAFTs:
//   1. An actively-managed event (OPEN / SETUP / IN_PROGRESS) — if several, the
//      one with the latest endDate (the newest live event)
//   2. else COMPLETED — the one with the latest endDate (most recently finished)
//   3. else the newest non-DRAFT event (API returns newest-first), else the first row
// Returns undefined only for an empty list.
export function pickDefaultEvent(rows: EventRow[]): EventRow | undefined {
  if (rows.length === 0) return undefined;

  const active = rows.filter(e => e.status === 'OPEN' || e.status === 'SETUP' || e.status === 'IN_PROGRESS');
  if (active.length > 0) return latestByEndDate(active);

  const completed = rows.filter(e => e.status === 'COMPLETED');
  if (completed.length > 0) return latestByEndDate(completed);

  return rows.find(e => e.status !== 'DRAFT') ?? rows[0];
}

const SEASON_CHRONO_ORDER: Record<string, number> = {
  SPRING: 1,
  SUMMER: 2,
  FALL: 3,
};

export function sortEventsChronological(events: EventRow[]): EventRow[] {
  return [...events].sort((a, b) => {
    const yA = a.year ?? (a.startDate ? new Date(a.startDate).getFullYear() : 0);
    const yB = b.year ?? (b.startDate ? new Date(b.startDate).getFullYear() : 0);
    if (yA !== yB) return yB - yA;

    const sA = SEASON_CHRONO_ORDER[(a.season ?? "").toUpperCase()] ?? 0;
    const sB = SEASON_CHRONO_ORDER[(b.season ?? "").toUpperCase()] ?? 0;
    if (sA !== sB) return sB - sA;

    const tA = a.startDate ? new Date(a.startDate).getTime() : 0;
    const tB = b.startDate ? new Date(b.startDate).getTime() : 0;
    if (tA !== tB) return tB - tA;

    return b.eventId - a.eventId;
  });
}

// Shared "all events" summary card used by both the Admin and Coordinator
// consoles (below the detail panel). Includes a live "find event" filter that
// matches name / season / year (case-insensitive substring). The filter only
// narrows this list — it never changes the current selection or the detail panel.
export function EventsListCard({
  events, loading, error, selectedEventId, onSelect, renderRowAction,
}: {
  events: EventRow[];
  loading: boolean;
  error: string | null;
  selectedEventId: number | null;
  onSelect: (eventId: number) => void;
  renderRowAction?: (event: EventRow) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? events.filter(ev =>
        ev.name.toLowerCase().includes(q) ||
        ev.season.toLowerCase().includes(q) ||
        String(ev.year ?? "").includes(q))
    : events;

  const sorted = sortEventsChronological(filtered);

  const muted: React.CSSProperties = { padding: 20, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, textAlign: "center" };
  const selectEventFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>, eventId: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(eventId);
  };

  return (
    <PixelCard style={{ padding: 18 }}>
      {loading ? (
        <div style={muted}>Loading...</div>
      ) : error ? (
        <div style={{ ...muted, color: C.red }}>{error}</div>
      ) : events.length === 0 ? (
        <div style={muted}>No events yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <PixelInput
            placeholder="Find event by name, season, or year..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {sorted.length === 0 ? (
            <div style={{ ...muted, padding: 12 }}>No events match your search.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sorted.map(ev => {
                const active = selectedEventId === ev.eventId;
                const rowAction = renderRowAction?.(ev);
                return (
                  <div
                    key={ev.eventId}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(ev.eventId)}
                    onKeyDown={(event) => selectEventFromKeyboard(event, ev.eventId)}
                    style={{
                      padding: "12px 14px",
                      background: active ? "rgba(34,197,94,0.1)" : C.surface2,
                      border: active ? `1px solid ${C.green}` : `1px solid ${C.border}`,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      fontFamily: "'JetBrains Mono', monospace", color: C.text,
                      cursor: "pointer", borderRadius: 0, textAlign: "left",
                    }}>
                    <div>
                      <EventName size={18}>{ev.name}</EventName>
                      <div style={{ marginTop: 6 }}><EventDateBadge ev={ev} /></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                      {rowAction}
                      {eventStatusBadge(ev.status)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </PixelCard>
  );
}

export interface StatusAction {
  label: string;
  next: EventStatus;
  variant: ConfirmVariant;
}

// Forward / rollback / cancel transitions per the backend lifecycle. The operable
// states DRAFT/OPEN/SETUP/IN_PROGRESS can be walked both ways one step at a time, so
// each step also exposes its reverse (OPEN→DRAFT, SETUP→OPEN, IN_PROGRESS→SETUP).
// Deliberately does NOT include COMPLETED → * : reopening is an Admin-only dedicated
// action (and the backend transition map blocks COMPLETED → anything for the PUT).
export function nextStatusActions(status: EventStatus): StatusAction[] {
  switch (status) {
    case 'DRAFT':       return [{ label: 'OPEN EVENT', next: 'OPEN', variant: 'cyber' }, { label: 'CANCEL', next: 'CANCELLED', variant: 'danger' }];
    case 'OPEN':        return [{ label: 'CLOSE REGISTRATION', next: 'SETUP', variant: 'cyber' }, { label: 'BACK TO DRAFT', next: 'DRAFT', variant: 'secondary' }, { label: 'CANCEL', next: 'CANCELLED', variant: 'danger' }];
    case 'SETUP':       return [{ label: 'START EVENT', next: 'IN_PROGRESS', variant: 'cyber' }, { label: 'REOPEN REGISTRATION', next: 'OPEN', variant: 'secondary' }, { label: 'CANCEL', next: 'CANCELLED', variant: 'danger' }];
    case 'IN_PROGRESS': return [{ label: 'COMPLETE EVENT', next: 'COMPLETED', variant: 'cyber' }, { label: 'BACK TO SETUP', next: 'SETUP', variant: 'secondary' }, { label: 'CANCEL', next: 'CANCELLED', variant: 'danger' }];
    case 'COMPLETED':   return [];
    case 'CANCELLED':   return [{ label: 'REOPEN', next: 'DRAFT', variant: 'secondary' }];
  }
}

const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Draft', OPEN: 'Open (registration)', SETUP: 'Setup', IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};

export interface ConfirmCopy {
  title: string;
  message: string;
  warning?: string;
  confirmLabel: string;
  variant: ConfirmVariant;
}

// Confirm-dialog copy for a status change, stating current → target and a
// warning when the step can't be undone by the actor.
export function statusChangeCopy(from: EventStatus, action: StatusAction): ConfirmCopy {
  const base = `Current status: "${STATUS_LABEL[from]}" (${from}) → "${STATUS_LABEL[action.next]}" (${action.next}).`;
  if (action.next === 'COMPLETED') {
    return {
      title: 'Complete this event?',
      message: base,
      warning: 'Once completed, you cannot reopen the event yourself; only System Admin can reopen it. Are you sure?',
      confirmLabel: 'CONFIRM COMPLETE',
      variant: 'cyber',
    };
  }
  if (action.next === 'CANCELLED') {
    return {
      title: 'Cancel this event?',
      message: base,
      warning: 'Cancelling will stop all activity for this event.',
      confirmLabel: 'CONFIRM CANCEL',
      variant: 'danger',
    };
  }
  return {
    title: `Change status: ${action.label}?`,
    message: base,
    confirmLabel: `CONFIRM`,
    variant: action.variant,
  };
}

// ── Track/Round/Criteria detail shapes ─────────────────────────────
// Shared by CoordEventsPage (which lifts tracks/rounds so the SETUP-gate
// check and the Rounds/Criteria/Timers tabs can all read them) and its
// extracted per-tab components (TracksTab/RoundsTab/CriteriaTab/AuditTab).

export interface ApiTrack {
  id?: number; trackId?: number; track_id?: number;
  eventId?: number; event_id?: number;
  name?: string;
  description?: string | null;
  capacity?: number | null;
}

export interface ApiRound {
  id?: number; roundId?: number; round_id?: number;
  eventId?: number; event_id?: number;
  name?: string;
  orderNumber?: number; order_number?: number;
  startTime?: string; start_time?: string;
  endTime?: string; end_time?: string;
  submissionDeadline?: string; submission_deadline?: string;
  topNAdvance?: number | null; top_n_advance?: number | null;
  isFinal?: boolean; is_final?: boolean;
  status?: string;
}

export interface ApiCriteria {
  id?: number; criteriaId?: number; criteria_id?: number;
  roundId?: number; round_id?: number;
  name?: string;
  description?: string | null;
  weight?: number;
  maxScore?: number; max_score?: number;
  orderNumber?: number; order_number?: number;
}

export interface TrackRow {
  trackId: number;
  name: string;
  description: string;
  capacity: number | null;
}

export interface RoundRow {
  roundId: number;
  name: string;
  orderNumber: number;
  startTime: string;
  endTime: string;
  submissionDeadline: string;
  topNAdvance: number | null;
  isFinal: boolean;
  status: string;
}

export interface CriteriaRow {
  criteriaId: number;
  roundId: number;
  name: string;
  description: string;
  weight: number;
  maxScore: number;
  orderNumber: number;
}

// A reusable scoring-criteria template (GET /api/criteria-templates).
export interface CriteriaTemplate {
  templateId: number;
  name: string;
  description?: string;
  isDefault?: boolean;
  items: { name: string }[];
}

export function normalizeTrack(item: ApiTrack): TrackRow {
  return {
    trackId:     item.id ?? item.trackId ?? item.track_id ?? 0,
    name:        item.name ?? '',
    description: item.description ?? '',
    capacity:    item.capacity ?? null,
  };
}

export function normalizeRound(item: ApiRound): RoundRow {
  return {
    roundId:            item.id ?? item.roundId ?? item.round_id ?? 0,
    name:               item.name ?? '',
    orderNumber:        item.orderNumber ?? item.order_number ?? 0,
    startTime:          item.startTime ?? item.start_time ?? '',
    endTime:            item.endTime ?? item.end_time ?? '',
    submissionDeadline: item.submissionDeadline ?? item.submission_deadline ?? '',
    topNAdvance:        item.topNAdvance ?? item.top_n_advance ?? null,
    isFinal:            item.isFinal ?? item.is_final ?? false,
    status:             (item.status ?? 'PENDING').toUpperCase(),
  };
}

export function normalizeCriteria(item: ApiCriteria): CriteriaRow {
  return {
    criteriaId:  item.id ?? item.criteriaId ?? item.criteria_id ?? 0,
    roundId:     item.roundId ?? item.round_id ?? 0,
    name:        item.name ?? '',
    description: item.description ?? '',
    weight:      item.weight ?? 0,
    maxScore:    item.maxScore ?? item.max_score ?? 0,
    orderNumber: item.orderNumber ?? item.order_number ?? 0,
  };
}

export function splitDT(iso: string) {
  if (!iso) return { date: "", time: "" };
  const [datePart, timePart] = iso.split("T");
  return { date: datePart ?? "", time: (timePart ?? "").slice(0, 5) };
}

export function joinDT(date: string, time: string): string | undefined {
  if (!date) return undefined;
  return `${date}T${time || "00:00"}`;
}

export function fmtDT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${min}`;
}

// ── Shared confirmation-dialog plumbing ────────────────────────────
// A queued action awaiting confirmation in CoordEventsPage's single shared
// <ConfirmDialog>. Every tab (Tracks/Rounds/Criteria) opens its destructive
// or status-changing actions through this same dialog via an `openConfirm`
// prop, rather than each growing its own dialog instance.
export interface PendingAction {
  title: string;
  message: ReactNode;
  warning?: ReactNode;
  confirmLabel: string;
  variant: ConfirmVariant;
  withReason?: boolean;          // show optional reason textarea (reopen request / redraw)
  reasonPlaceholder?: string;    // placeholder for the reason textarea when withReason
  requireTypedText?: string;     // type-to-confirm gate for the highest-impact irreversible actions
  run: (reason?: string) => Promise<void>;
}
