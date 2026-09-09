import { useEffect, useState } from "react";
import {
  C, GradientText, PixelCard, PixelButton, PixelInput,
} from "@/shared/components/PixelComponents";
import { apiFetch, ApiError, apiErrorMessage, adminApi } from "@/shared/apiClient";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { EventScoreDistribution } from "@/features/events/EventScoreDistribution";
import { PixelMenu, type PixelMenuEntry } from "@/shared/components/PixelMenu";
import { useNotifications } from "@/app/providers/NotificationProvider";
import {
  TrackMode, EventRow, ApiEvent, PendingAction,
  normalizeEvent, eventStatusBadge, EventDateBadge, EventName, pickDefaultEvent, EventsListCard,
  parseDDMM, toDDMM, fmtDT,
} from "@/features/events/eventUtils";
import {
  type EventSeason, createEventDateErrors, dateToLocalDateTime,
} from "@/features/events/CreateEventCard";

// System Admin's event console. Event creation, completion, and reopening are
// exclusively Coordinator actions. Admins can view events, audit scores, edit, and export CSVs.

export function AdminEventsPage() {
  const { addToast } = useNotifications();

  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [exportingEventId, setExportingEventId] = useState<number | null>(null);

  // Edit-event form state
  const [showEdit, setShowEdit] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [editSeason, setEditSeason] = useState<EventSeason>("SPRING");
  const [editYear, setEditYear] = useState(String(new Date().getFullYear()));
  const [editRegStart, setEditRegStart] = useState("");
  const [editRegEnd, setEditRegEnd] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editMode, setEditMode] = useState<TrackMode>("SELF_SELECT");

  // Confirmation dialog (complete / reopen / approve / reject / cancel)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionWorking, setActionWorking] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const selectedEvent = selectedEventId ? events.find(e => e.eventId === selectedEventId) ?? null : null;

  // Close edit form when user switches to a different event.
  useEffect(() => { setShowEdit(false); }, [selectedEventId]);

  // ── Load events ───────────────────────────────────────────────────
  function loadEvents() {
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
  }

  useEffect(() => { loadEvents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── Confirmation plumbing ─────────────────────────────────────────
  function openConfirm(action: PendingAction) {
    setDialogError(null);
    setPendingAction(action);
  }
  function closeConfirm() {
    setPendingAction(null);
    setDialogError(null);
  }
  async function handleConfirmAction() {
    if (!pendingAction) return;
    setActionWorking(true);
    setDialogError(null);
    try {
      await pendingAction.run();
      closeConfirm();
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : "Action failed.");
      addToast({ type: 'warning', title: 'ACTION FAILED', message: apiErrorMessage(err, 'Action failed.') });
    } finally {
      setActionWorking(false);
    }
  }

  async function exportEventCsv(event: EventRow) {
    if (exportingEventId !== null) return;
    if (event.status !== 'COMPLETED') {
      addToast({ type: 'warning', title: 'EXPORT LOCKED', message: 'CSV export is only available after the event is completed.' });
      return;
    }
    setExportingEventId(event.eventId);
    try {
      await adminApi.exportEventCsv(event.eventId);
      addToast({ type: 'success', title: 'CSV EXPORTED', message: `"${event.name}" export started.` });
    } catch (err) {
      addToast({ type: 'warning', title: 'EXPORT FAILED', message: apiErrorMessage(err, 'Failed to export event CSV.') });
    } finally {
      setExportingEventId(null);
    }
  }

  // ── Cancel event ─────────────────────────────────────────────────
  function confirmCancelEvent() {
    if (!selectedEvent) return;
    openConfirm({
      title: 'Cancel this event?',
      message: `"${selectedEvent.name}" will be permanently cancelled.`,
      warning: 'This cannot be undone. All participants and coordinators will lose access to the event.',
      confirmLabel: 'CANCEL EVENT',
      variant: 'danger',
      requireTypedText: selectedEvent.name,
      run: async () => {
        await apiFetch(`/api/events/${selectedEvent.eventId}`, { method: 'PUT', body: JSON.stringify({ status: 'CANCELLED' }) });
        setEvents(prev => prev.map(e => e.eventId === selectedEvent.eventId ? { ...e, status: 'CANCELLED' } : e));
        addToast({ type: 'warning', title: 'EVENT CANCELLED', message: `"${selectedEvent.name}" has been cancelled.` });
      },
    });
  }

  // ── Edit event ────────────────────────────────────────────────────
  function openEditForm() {
    if (!selectedEvent) return;
    setEditName(selectedEvent.name);
    setEditTopic(selectedEvent.topic ?? "");
    setEditSeason((selectedEvent.season as EventSeason) || "SPRING");
    setEditYear(String(selectedEvent.year ?? new Date().getFullYear()));
    setEditRegStart(toDDMM(selectedEvent.registrationStart));
    setEditRegEnd(toDDMM(selectedEvent.registrationEnd));
    setEditStart(toDDMM(selectedEvent.startDate));
    setEditEnd(toDDMM(selectedEvent.endDate));
    setEditMode(selectedEvent.trackSelectionMode);
    setEditError(null);
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!selectedEvent || editSaving) return;
    if (!editName.trim()) {
      addToast({ type: 'warning', title: 'MISSING NAME', message: 'Please enter an event name.' });
      return;
    }
    const dateErrors = createEventDateErrors(editSeason, editYear, editRegStart, editRegEnd, editStart, editEnd);
    if (dateErrors.length > 0) {
      const message = dateErrors.join(" ");
      setEditError(message);
      addToast({ type: 'warning', title: 'CHECK DATES', message });
      return;
    }
    setEditError(null);
    setEditSaving(true);
    try {
      const res = await apiFetch<{ data: ApiEvent }>(`/api/events/${selectedEvent.eventId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName,
          topic: editTopic,
          season: editSeason,
          year: Number(editYear),
          registrationStart: dateToLocalDateTime(parseDDMM(editRegStart, editYear)!, "00:00:00"),
          registrationEnd: dateToLocalDateTime(parseDDMM(editRegEnd, editYear)!, "23:59:59"),
          startDate: dateToLocalDateTime(parseDDMM(editStart, editYear)!),
          endDate: dateToLocalDateTime(parseDDMM(editEnd, editYear)!, "23:59:59"),
          trackSelectionMode: editMode,
        }),
      });
      const updated = normalizeEvent(res.data);
      setEvents(prev => prev.map(e => e.eventId === updated.eventId ? updated : e));
      setShowEdit(false);
      addToast({ type: 'success', title: 'EVENT UPDATED', message: `"${updated.name}" saved.` });
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to update event.");
      addToast({ type: 'warning', title: 'UPDATE FAILED', message: apiErrorMessage(err, 'Failed to update event.') });
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 800 }}>
          <GradientText>Events</GradientText>
        </h1>
      </div>

      {/* Detail panel — Admin lifecycle actions; on top, above the all-events list */}
      {selectedEvent && (
        <PixelCard glow gradient style={{ padding: 20 }}>
          {showEdit ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ color: C.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700 }}>EDIT EVENT</div>
              {editError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: C.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "10px 14px" }}>
                  ERROR: {editError}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                <PixelInput label="Event Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <div style={{ gridColumn: "span 2" }}>
                  <PixelInput
                    label="Topic" value={editTopic} onChange={(e) => setEditTopic(e.target.value)}
                    placeholder="The overall competition theme"
                  />
                </div>
                <div>
                  <label style={{ color: C.greenMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Season</label>
                  <select value={editSeason} onChange={(e) => setEditSeason(e.target.value as EventSeason)} style={{ width: "100%", marginTop: 6, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.border}`, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, borderRadius: 0, outline: "none" }}>
                    <option value="SPRING">Spring</option>
                    <option value="SUMMER">Summer</option>
                    <option value="FALL">Fall</option>
                  </select>
                </div>
                <PixelInput label="Year" type="number" value={editYear} onChange={(e) => setEditYear(e.target.value)} />
                <PixelInput label="Reg. Start (DD/MM)" type="text" placeholder="e.g. 05/01" value={editRegStart} onChange={(e) => setEditRegStart(e.target.value)} />
                <PixelInput label="Reg. End (DD/MM)" type="text" placeholder="e.g. 28/02" value={editRegEnd} onChange={(e) => setEditRegEnd(e.target.value)} />
                <div>
                  <label style={{ color: C.greenMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Track Assignment</label>
                  <select value={editMode} onChange={(e) => setEditMode(e.target.value as TrackMode)} style={{ width: "100%", marginTop: 6, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.border}`, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, borderRadius: 0, outline: "none" }}>
                    <option value="SELF_SELECT">Teams self-select</option>
                    <option value="RANDOM">Random draw</option>
                  </select>
                </div>
                <PixelInput label="Start Date (DD/MM)" type="text" placeholder="e.g. 01/03" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                <PixelInput label="End Date (DD/MM)" type="text" placeholder="e.g. 30/04" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 10, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <PixelButton variant="cyber" onClick={saveEdit} disabled={editSaving}>{editSaving ? "SAVING..." : "SAVE CHANGES"}</PixelButton>
                <PixelButton variant="ghost" onClick={() => setShowEdit(false)} disabled={editSaving}>CANCEL</PixelButton>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div><EventName>{selectedEvent.name}</EventName></div>
                {selectedEvent.topic && (
                  <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginTop: 4 }}>{selectedEvent.topic}</div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  {eventStatusBadge(selectedEvent.status)}
                  <EventDateBadge ev={selectedEvent} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {(() => {
                  // Edit/Cancel only make sense before the event is done
                  const items: PixelMenuEntry[] = [];
                  if (selectedEvent.status !== 'CANCELLED' && selectedEvent.status !== 'COMPLETED') {
                    items.push({ label: "Edit", onClick: openEditForm });
                    items.push("divider");
                    items.push({ label: "Cancel Event", danger: true, onClick: confirmCancelEvent });
                  }
                  return items.length > 0 && (
                    <PixelMenu ariaLabel={`More actions for ${selectedEvent.name}`} items={items} />
                  );
                })()}
              </div>
            </div>
          )}
        </PixelCard>
      )}

      {selectedEvent?.status === 'COMPLETED' && (
        <EventScoreDistribution key={selectedEvent.eventId} eventId={selectedEvent.eventId} />
      )}

      {/* All-events summary list with find filter — below the detail panel */}
      <EventsListCard
        events={events}
        loading={loading}
        error={fetchError}
        selectedEventId={selectedEventId}
        onSelect={setSelectedEventId}
        renderRowAction={(event) => {
          if (event.status !== 'COMPLETED') return null;
          const exportingThisEvent = exportingEventId === event.eventId;
          return (
            <span
              title="Export completed event CSV"
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
              style={{ display: "inline-flex" }}
            >
              <PixelButton
                size="sm"
                variant="secondary"
                disabled={exportingEventId !== null}
                onClick={() => exportEventCsv(event)}
              >
                {exportingThisEvent ? "EXPORTING..." : "EXPORT CSV"}
              </PixelButton>
            </span>
          );
        }}
      />

      {/* Shared confirmation dialog */}
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
        />
      )}
    </div>
  );
}
