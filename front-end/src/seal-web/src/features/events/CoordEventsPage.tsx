import { useEffect, useState } from "react";
import {
  C, GradientText, PixelCard, PixelButton, PixelBadge, PixelTabs,
} from "@/shared/components/PixelComponents";
import { PixelMenu, type PixelMenuEntry } from "@/shared/components/PixelMenu";
import { apiFetch, ApiError, apiErrorMessage, eventsApi, teamsApi, type Team } from "@/shared/apiClient";
import { ConfirmDialog, type ConfirmVariant } from "@/shared/components/ConfirmDialog";
import { usePermissions } from "@/shared/permissions";
import { useNotifications } from "@/app/providers/NotificationProvider";
import {
  EventStatus, TrackMode, EventRow, ApiEvent,
  normalizeEvent, eventStatusBadge, EventDateBadge, EventName, nextStatusActions, statusChangeCopy, pickDefaultEvent, EventsListCard,
  TrackRow, RoundRow, ApiTrack, ApiRound, normalizeTrack, normalizeRound, PendingAction,
} from "@/features/events/eventUtils";
import { canCompleteSetup, countUnassigned, teamsForTrack, MIN_TEAMS_PER_TRACK } from "@/features/events/trackStats";
import { CreateEventCard } from "@/features/events/CreateEventCard";
import { TracksTab } from "@/features/events/TracksTab";
import { TrackProblemsTab } from "@/features/events/TrackProblemPanel";
import { RoundsTab } from "@/features/events/RoundsTab";
import { ContestTimerPanel } from "@/features/events/ContestTimerPanel";
import { CriteriaTab } from "@/features/events/CriteriaTab";
import { AuditTab } from "@/features/events/AuditTab";
import { LeftoverGroupingModal } from "@/features/events/LeftoverGroupingModal";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

// Coordinator's event console. Coordinators run an event's forward lifecycle
// (OPEN → SETUP → IN_PROGRESS → COMPLETED), create new events, and can directly
// reopen a COMPLETED event.
// Every status change is gated behind a confirmation dialog.
//
// This page is the orchestrator: the always-visible header (name/status/lifecycle
// actions), the shared confirm dialog every tab's actions funnel through, and the
// cross-tab-shared tracks/rounds/teams state. Tracks/Rounds/Criteria/Audit are
// each their own component (TracksTab/RoundsTab/CriteriaTab/AuditTab); Problems
// and Timers were already extracted (TrackProblemsTab/ContestTimerPanel).

export function CoordEventsPage() {
  const { canChangeEventStatus, canCompleteEvent, canCreateEvent, canReopenEvent } = usePermissions();
  const { addToast } = useNotifications();

  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showGrouping, setShowGrouping] = useState(false);

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<string>("tracks");

  // Detail data for the selected event — lifted here because it's shared across
  // several tabs (Rounds/Criteria/Timers all read rounds + selectedRoundId; the
  // SETUP→IN_PROGRESS gate check below reads tracks + teams).
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Teams of the selected event — drives the track-statistics overview and the
  // per-track team lists (NV1 & NV2) inside TracksTab, and the SETUP-gate check
  // below. The roster basis for the stats is the event's APPROVED teams,
  // matching the backend's SETUP capacity freeze.
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  // People not yet in a valid team (solo/under-sized/teamless). null = unknown/not SETUP.
  const [leftoverCount, setLeftoverCount] = useState<number | null>(null);

  // Shared by Rounds/Criteria/Timers — which round's criteria/timer is being viewed.
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

  // Confirmation dialog state (shared by every status change +
  // every tab's destructive/status actions, passed down to them as `openConfirm`).
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionWorking, setActionWorking] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const selectedEvent = selectedEventId ? events.find(e => e.eventId === selectedEventId) ?? null : null;

  // ── Load events on mount ──────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    apiFetch<{ data: ApiEvent[] }>('/api/events')
      .then(res => {
        const rows = (res.data ?? []).map(normalizeEvent);
        setEvents(rows);
        // Default-highlight the running event (or the most recently finished one);
        // only on first load — `prev ??` keeps the actor's manual selection.
        setSelectedEventId(prev => prev ?? pickDefaultEvent(rows)?.eventId ?? null);
      })
      .catch(err => setFetchError(err instanceof ApiError ? err.message : "Failed to load events."))
      .finally(() => setLoading(false));
  }, []);

  // ── Load tracks + rounds when the selected event changes ──────────
  useEffect(() => {
    if (selectedEventId == null) {
      setTracks([]); setRounds([]); setSelectedRoundId(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    Promise.all([
      apiFetch<{ data: ApiTrack[] }>(`/api/events/${selectedEventId}/tracks`),
      apiFetch<{ data: ApiRound[] }>(`/api/events/${selectedEventId}/rounds`),
    ])
      .then(([trackRes, roundRes]) => {
        setTracks((trackRes.data ?? []).map(normalizeTrack));
        const roundRows = (roundRes.data ?? []).map(normalizeRound).sort((a, b) => a.orderNumber - b.orderNumber);
        setRounds(roundRows);
        setSelectedRoundId(roundRows[0]?.roundId ?? null);
      })
      .catch(err => setDetailError(err instanceof ApiError ? err.message : "Failed to load event details."))
      .finally(() => setDetailLoading(false));
  }, [selectedEventId]);

  // ── Load teams when the selected event changes ────────────────────
  // Kept separate from the tracks/rounds fetch so a teams failure never blanks
  // the tracks list (and vice-versa).
  useEffect(() => {
    if (selectedEventId == null) {
      setTeams([]); setTeamsError(null);
      return;
    }
    let cancelled = false;
    setTeamsLoading(true);
    setTeamsError(null);
    teamsApi.getByEvent(selectedEventId)
      .then(res => { if (!cancelled) setTeams(res.data ?? []); })
      .catch(err => { if (!cancelled) setTeamsError(err instanceof ApiError ? err.message : "Failed to load teams."); })
      .finally(() => { if (!cancelled) setTeamsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedEventId]);

  // Leftover-participant count for the SETUP grouping prompt. Drives whether the
  // "not grouped yet" warning + button show. Refetched when the roster changes
  // (teams) so it clears once everyone is grouped. Non-fatal on error → stays hidden.
  useEffect(() => {
    if (selectedEventId == null || selectedEvent?.status !== 'SETUP') {
      setLeftoverCount(null);
      return;
    }
    let cancelled = false;
    teamsApi.leftoverGroupingPreview(selectedEventId)
      .then(res => { if (!cancelled) setLeftoverCount(res.data?.leftoverPeople ?? 0); })
      .catch(() => { if (!cancelled) setLeftoverCount(null); });
    return () => { cancelled = true; };
  }, [selectedEventId, selectedEvent?.status, teams]);

  // ── Confirmation plumbing ─────────────────────────────────────────
  function openConfirm(action: PendingAction) {
    setDialogError(null);
    setReason("");
    setPendingAction(action);
  }

  function closeConfirm() {
    setPendingAction(null);
    setDialogError(null);
    setReason("");
  }

  async function handleConfirmAction() {
    if (!pendingAction) return;
    setActionWorking(true);
    setDialogError(null);
    try {
      await pendingAction.run(reason.trim() || undefined);
      closeConfirm();
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : "Action failed.");
      addToast({ type: 'warning', title: 'ACTION FAILED', message: apiErrorMessage(err, 'Action failed.') });
    } finally {
      setActionWorking(false);
    }
  }

  // ── Mutations (each is invoked only after dialog confirmation) ────
  async function doUpdateStatus(next: EventStatus) {
    if (!selectedEvent) return;
    if (next === 'COMPLETED') {
      await eventsApi.complete(selectedEvent.eventId);
    } else {
      await apiFetch(`/api/events/${selectedEvent.eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: next }),
      });
    }
    setEvents(prev => prev.map(e => e.eventId === selectedEvent.eventId ? { ...e, status: next } : e));
    addToast({ type: 'success', title: 'STATUS UPDATED', message: `Event moved to ${next}.` });
  }

  // Open the confirm dialog for a lifecycle status change.
  function requestStatusChange(next: EventStatus, label: string, variant: ConfirmVariant) {
    if (!selectedEvent) return;

    // PHẦN 5 — gate leaving SETUP forward (START EVENT). Every track must have at
    // least MIN_TEAMS_PER_TRACK teams and no team may be unassigned. The backend
    // enforces this too; here we explain exactly what to fix before even asking.
    if (selectedEvent.status === 'SETUP' && next === 'IN_PROGRESS') {
      const approved = teams.filter(t => t.status === 'APPROVED');
      const gate = canCompleteSetup({
        tracks: tracks.map(t => ({ trackId: t.trackId, name: t.name, teamCount: teamsForTrack(approved, t.trackId).length })),
        unassignedCount: countUnassigned(approved),
      });
      if (!gate.ok) {
        openConfirm({
          title: 'Cannot start the event yet',
          message: (
            <div>
              Resolve the following before starting (each track needs at least {MIN_TEAMS_PER_TRACK} teams, with none left unassigned):
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
                {gate.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          ),
          confirmLabel: 'OK',
          variant: 'secondary',
          run: async () => { /* informational only — nothing to commit */ },
        });
        return;
      }
    }

    const copy = statusChangeCopy(selectedEvent.status, { next, label, variant });
    openConfirm({
      title: copy.title,
      message: copy.message,
      warning: copy.warning,
      confirmLabel: copy.confirmLabel,
      variant: copy.variant,
      // Cancelling stops the whole event — gate it behind typing the event name.
      requireTypedText: next === 'CANCELLED' ? selectedEvent.name : undefined,
      run: async () => { await doUpdateStatus(next); },
    });
  }

  // ── Reopen event (COMPLETED → IN_PROGRESS) ─────────────────────────
  function confirmReopen() {
    if (!selectedEvent) return;
    openConfirm({
      title: 'Reopen this event?',
      message: `Reopen "${selectedEvent.name}" (COMPLETED → IN_PROGRESS). The event will become active again.`,
      confirmLabel: 'REOPEN EVENT',
      variant: 'cyber',
      run: async () => {
        await eventsApi.reopen(selectedEvent.eventId);
        setEvents(prev => prev.map(e => e.eventId === selectedEvent.eventId ? { ...e, status: 'IN_PROGRESS' } : e));
        addToast({ type: 'success', title: 'EVENT REOPENED', message: `"${selectedEvent.name}" is now In Progress.` });
      },
    });
  }

  // Re-pull the roster after a draw/redraw/assign so the overview counts and
  // per-track lists reflect the new assignments (non-fatal if it fails — stats
  // keep their last values). Passed down to TracksTab; also used by the
  // LeftoverGroupingModal callbacks below.
  function refreshTeams() {
    if (selectedEventId == null) return;
    teamsApi.getByEvent(selectedEventId)
      .then(res => setTeams(res.data ?? []))
      .catch(() => { /* non-fatal */ });
  }

  async function updateEventMode(mode: TrackMode) {
    if (!selectedEvent) return;
    setActionError(null);
    try {
      await apiFetch(`/api/events/${selectedEvent.eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ trackSelectionMode: mode }),
      });
      setEvents(prev => prev.map(e => e.eventId === selectedEvent.eventId ? { ...e, trackSelectionMode: mode } : e));
      addToast({ type: 'success', title: 'MODE UPDATED', message: `Track assignment set to ${mode === 'RANDOM' ? 'Random draw' : 'Self-select'}.` });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to update track mode.");
      addToast({ type: 'warning', title: 'UPDATE FAILED', message: apiErrorMessage(err, 'Failed to update track mode.') });
    }
  }

  // "Problems" per track: visible from SETUP onward; upload/release/remove only while
  // the event is being set up or run (mirrors TrackProblemService on the backend).
  const showProblems = !!selectedEvent
    && (selectedEvent.status === 'SETUP' || selectedEvent.status === 'IN_PROGRESS' || selectedEvent.status === 'COMPLETED');
  const canManageProblems = !!selectedEvent
    && (selectedEvent.status === 'SETUP' || selectedEvent.status === 'IN_PROGRESS');

  return (
    <DndProvider backend={HTML5Backend}>
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 800 }}>
            <GradientText>Events</GradientText>
          </h1>
        </div>
        {canCreateEvent && (
          <PixelButton variant="cyber" onClick={() => setShowCreate(s => !s)}>CREATE EVENT</PixelButton>
        )}
      </div>

      {showCreate && (
        <CreateEventCard
          onCreated={(created) => {
            setEvents(prev => [...prev, created]);
            setSelectedEventId(created.eventId);
            setShowCreate(false);
            addToast({ type: 'success', title: 'EVENT CREATED', message: `"${created.name}" has been created (DRAFT).` });
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {actionError && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: C.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "10px 14px" }}>
          ERROR: {actionError}
        </div>
      )}

      {successMsg && (
        <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.35)", color: C.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "10px 14px" }}>
          {successMsg}
        </div>
      )}

      {/* Detail panel (selected event) — on top, above the all-events list */}
      {selectedEvent && (
        <PixelCard glow gradient style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                <EventName>{selectedEvent.name}</EventName>
                {eventStatusBadge(selectedEvent.status)}
                <EventDateBadge ev={selectedEvent} />
              </div>
              {selectedEvent.topic && (
                <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginTop: 4 }}>{selectedEvent.topic}</div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <span style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.05em" }}>TRACK ASSIGNMENT:</span>
                {(selectedEvent.status === 'DRAFT' || selectedEvent.status === 'OPEN') ? (
                  <select value={selectedEvent.trackSelectionMode} onChange={(e) => updateEventMode(e.target.value as TrackMode)}
                    style={{ padding: "4px 8px", background: C.surface2, border: `1px solid ${C.border}`, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, borderRadius: 0, outline: "none" }}>
                    <option value="SELF_SELECT">Teams self-select</option>
                    <option value="RANDOM">Random draw</option>
                  </select>
                ) : (
                  <PixelBadge color={selectedEvent.trackSelectionMode === 'RANDOM' ? 'cyan' : 'blue'}>
                    {selectedEvent.trackSelectionMode === 'RANDOM' ? 'RANDOM DRAW' : 'SELF-SELECT'}
                  </PixelBadge>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {/* Lifecycle transitions — each confirmed first. COMPLETE is filtered
                  out for non-admins: only System Admin may complete an event (backend
                  enforces it too). Only the forward "next step" renders as a button;
                  the reverse transition and CANCEL live in the ⋯ overflow menu so a
                  destructive option is never one stray click away. */}
              {canChangeEventStatus && (() => {
                const actions = nextStatusActions(selectedEvent.status)
                  .filter(action => action.next !== 'COMPLETED' || canCompleteEvent)
                  // Cancelling an event is a System Admin action — coordinators
                  // manage the lifecycle forward/back but never cancel it.
                  .filter(action => action.next !== 'CANCELLED');
                if (actions.length === 0) return null;
                const [primary, ...overflow] = actions;
                const overflowItems: PixelMenuEntry[] = [];
                overflow.forEach((action, i) => {
                  if (action.next === 'CANCELLED' && i > 0) overflowItems.push("divider");
                  overflowItems.push({
                    label: action.label,
                    danger: action.variant === 'danger',
                    onClick: () => requestStatusChange(action.next, action.label, action.variant),
                  });
                });
                return (
                  <>
                    <PixelButton variant={primary.variant}
                      onClick={() => requestStatusChange(primary.next, primary.label, primary.variant)}>
                      {primary.label}
                    </PixelButton>
                    {overflowItems.length > 0 && (
                      <PixelMenu size="md" ariaLabel="More event actions" items={overflowItems} />
                    )}
                  </>
                );
              })()}

              {/* COMPLETED: coordinator can directly reopen. */}
              {selectedEvent.status === 'COMPLETED' && canReopenEvent && (
                <PixelButton variant="cyber" onClick={confirmReopen}>REOPEN EVENT</PixelButton>
              )}
            </div>
          </div>

          <PixelTabs
            tabs={[
              { id: "tracks", label: "Tracks" },
              { id: "rounds", label: "Rounds" },
              { id: "problems", label: "Problems" },
              { id: "criteria", label: "Criteria" },
              { id: "timers", label: "Timers" },
              { id: "audit", label: "Audit" },
            ]}
            active={detailTab}
            onChange={setDetailTab}
          />

          {detailError && (
            <div style={{ marginTop: 12, color: C.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{detailError}</div>
          )}

          <div style={{ marginTop: 16 }}>
            {detailTab === "tracks" && (
              <TracksTab
                event={selectedEvent}
                tracks={tracks}
                setTracks={setTracks}
                teams={teams}
                teamsLoading={teamsLoading}
                teamsError={teamsError}
                leftoverCount={leftoverCount}
                refreshTeams={refreshTeams}
                openConfirm={openConfirm}
                onOpenGrouping={() => setShowGrouping(true)}
                detailLoading={detailLoading}
                setActionError={setActionError}
                setSuccessMsg={setSuccessMsg}
              />
            )}

            {/* Problems tab — dedicated "đề thi" import per track, kept out of the
                Tracks tab so that view stays focused on team assignment. */}
            {detailTab === "problems" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {!showProblems ? (
                  <div style={{ padding: 12, background: C.surface, border: `1px dashed ${C.border}`, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.6 }}>
                    {`Problem import unlocks once registration closes (event in SETUP). Current: ${selectedEvent.status}.`}
                  </div>
                ) : (
                  <TrackProblemsTab eventId={selectedEvent.eventId} canManage={canManageProblems} canRelease={selectedEvent.status === 'IN_PROGRESS'} />
                )}
              </div>
            )}

            {detailTab === "rounds" && (
              <RoundsTab
                event={selectedEvent}
                rounds={rounds}
                setRounds={setRounds}
                selectedRoundId={selectedRoundId}
                setSelectedRoundId={setSelectedRoundId}
                detailLoading={detailLoading}
                openConfirm={openConfirm}
                setActionError={setActionError}
              />
            )}

            {detailTab === "timers" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rounds.length === 0 ? (
                  <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>Add a round first — timers are configured per round.</div>
                ) : (
                  <>
                    {/* Round selector (same pattern as Criteria) */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {rounds.map(r => {
                        const active = selectedRoundId === r.roundId;
                        return (
                          <button key={r.roundId} onClick={() => setSelectedRoundId(r.roundId)}
                            style={{
                              padding: "6px 12px",
                              background: active ? "rgba(34,197,94,0.12)" : C.surface2,
                              border: active ? `1px solid ${C.green}` : `1px solid ${C.border}`,
                              color: active ? C.green : C.textMuted,
                              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, cursor: "pointer", borderRadius: 0,
                            }}>
                            {r.orderNumber}. {r.name}
                          </button>
                        );
                      })}
                    </div>
                    <ContestTimerPanel eventId={selectedEvent.eventId} roundId={selectedRoundId} eventStatus={selectedEvent.status} />
                  </>
                )}
              </div>
            )}

            {detailTab === "criteria" && (
              <CriteriaTab
                eventId={selectedEvent.eventId}
                rounds={rounds}
                selectedRoundId={selectedRoundId}
                setSelectedRoundId={setSelectedRoundId}
                openConfirm={openConfirm}
                setActionError={setActionError}
              />
            )}

            {detailTab === "audit" && <AuditTab eventId={selectedEvent.eventId} />}
          </div>
        </PixelCard>
      )}

      {/* All-events summary list with find filter — below the detail panel */}
      <EventsListCard
        events={events}
        loading={loading}
        error={fetchError}
        selectedEventId={selectedEventId}
        onSelect={setSelectedEventId}
      />

      {/* Shared confirmation dialog for every status change + reopen request +
          every tab's own confirmed actions (passed down as `openConfirm`) */}
      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.title}
          message={pendingAction.message}
          warning={pendingAction.warning}
          confirmLabel={pendingAction.confirmLabel}
          variant={pendingAction.variant}
          working={actionWorking}
          error={dialogError}
          requireTypedText={pendingAction.requireTypedText}
          onConfirm={handleConfirmAction}
          onClose={closeConfirm}
        >
          {pendingAction.withReason && (
            <div>
              <label style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Reason (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={pendingAction.reasonPlaceholder ?? "Why does this event need to be reopened?"}
                style={{
                  width: "100%", marginTop: 6, padding: "10px 12px", background: C.surface2,
                  border: `1px solid ${C.border}`, color: C.text, fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12, borderRadius: 0, outline: "none", resize: "vertical",
                }}
              />
            </div>
          )}
        </ConfirmDialog>
      )}

      {showGrouping && selectedEvent && (
        <LeftoverGroupingModal
          eventId={selectedEvent.eventId}
          eventName={selectedEvent.name}
          teams={teams}
          onClose={() => setShowGrouping(false)}
          onCommitted={(summary) => {
            setShowGrouping(false);
            setSuccessMsg(summary);
            addToast({ type: 'success', title: 'GROUPING APPLIED', message: summary });
            refreshTeams();
          }}
          onManualAssigned={(summary) => {
            // Keep the modal open — the coordinator may resolve several warnings in
            // one sitting — but refresh the roster so the leftover count and the
            // modal's target-team dropdown stay accurate.
            addToast({ type: 'success', title: 'PARTICIPANT PLACED', message: summary });
            refreshTeams();
          }}
        />
      )}
    </div>
    </DndProvider>
  );
}
