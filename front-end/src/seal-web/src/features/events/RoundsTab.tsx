import { useEffect, useRef, useState } from "react";
import { C, PixelButton, PixelInput } from "@/shared/components/PixelComponents";
import { PixelMenu } from "@/shared/components/PixelMenu";
import { apiFetch, ApiError, apiErrorMessage } from "@/shared/apiClient";
import { useNotifications } from "@/app/providers/NotificationProvider";
import {
  EventRow, RoundRow, ApiRound, normalizeRound, splitDT, joinDT, toDDMM, parseDDMM, yearOf, fmtDT, PendingAction,
} from "@/features/events/eventUtils";

// The Rounds tab of CoordEventsPage: round CRUD with a DD/MM + HH:MM date form
// (the year is fixed to the parent event's own start year) and the OPEN/CLOSE
// submission toggle. Extracted verbatim out of CoordEventsPage.tsx — behavior,
// API calls, and copy are unchanged.

// Native <input type="time"> renders AM/PM on some browsers/OS locales no matter
// what `lang` is set to (Firefox in particular ignores it entirely), so the time
// field is a plain masked text input instead — this guarantees a 24h HH:MM
// display everywhere. Digits only; clamps hours to 0-23 and minutes to 0-59.
function formatTime24Input(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  let hh = digits.slice(0, 2);
  let mm = digits.slice(2);
  if (Number(hh) > 23) hh = "23";
  if (mm.length === 2 && Number(mm) > 59) mm = "59";
  return `${hh}:${mm}`;
}
export function RoundsTab({
  event, rounds, setRounds, selectedRoundId, setSelectedRoundId, detailLoading, openConfirm, setActionError,
}: {
  event: EventRow;
  rounds: RoundRow[];
  setRounds: React.Dispatch<React.SetStateAction<RoundRow[]>>;
  selectedRoundId: number | null;
  setSelectedRoundId: React.Dispatch<React.SetStateAction<number | null>>;
  detailLoading: boolean;
  openConfirm: (action: PendingAction) => void;
  setActionError: (msg: string | null) => void;
}) {
  const { addToast } = useNotifications();

  // Round form (collapsed behind "+ ADD ROUND"; also opens for inline edits)
  const [showAddRound, setShowAddRound] = useState(false);
  const [rdName, setRdName] = useState("");
  const [rdStartDate, setRdStartDate] = useState("");
  const [rdStartTime, setRdStartTime] = useState("");
  const [rdEndDate, setRdEndDate] = useState("");
  const [rdEndTime, setRdEndTime] = useState("");
  const [rdTopN, setRdTopN] = useState<number | null>(3);
  const [rdIsFinal, setRdIsFinal] = useState(false);
  const [editingRoundId, setEditingRoundId] = useState<number | null>(null);

  // The shared add/edit form sits below the round list, so an Edit click on the
  // first row is easy to miss — scroll the form into view whenever it opens.
  const roundFormRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingRoundId != null || showAddRound) {
      roundFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [editingRoundId, showAddRound]);

  // Builds the round's start and end datetimes from the DD/MM + HH:MM form fields and validates constraints.
  function buildRoundDates(): { startTime?: string; endTime?: string } | null {
    const year = yearOf(event.startDate);
    const errors: string[] = [];
    const resolve = (ddmm: string, label: string): string => {
      if (!ddmm.trim()) return "";
      const iso = parseDDMM(ddmm, year);
      if (!iso) { errors.push(`${label} must be in DD/MM format (e.g. 05/03).`); return ""; }
      return iso;
    };
    const start = resolve(rdStartDate, "Start date");
    const end = resolve(rdEndDate, "End date");
    if (errors.length > 0) {
      addToast({ type: 'warning', title: 'INVALID DATE', message: errors.join(' ') });
      return null;
    }
    if (!start) {
      addToast({ type: 'warning', title: 'MISSING DATE', message: 'Please enter a start date (DD/MM).' });
      return null;
    }
    if (!end) {
      addToast({ type: 'warning', title: 'MISSING DATE', message: 'Please enter an end date (DD/MM).' });
      return null;
    }

    const startDT = joinDT(start, rdStartTime || "00:00");
    const endDT = joinDT(end, rdEndTime || "23:59");

    if (!startDT || !endDT) {
      addToast({ type: 'warning', title: 'INVALID DATE', message: 'Invalid start or end date/time.' });
      return null;
    }

    const sTime = new Date(startDT).getTime();
    const eTime = new Date(endDT).getTime();

    // 1. Check start < end
    if (sTime >= eTime) {
      addToast({ type: 'warning', title: 'INVALID TIME', message: 'Round start time must be before end time.' });
      return null;
    }

    // 2. Check within event dates
    if (event.startDate) {
      const evStart = new Date(event.startDate).getTime();
      if (sTime < evStart) {
        addToast({
          type: 'warning',
          title: 'OUT OF EVENT BOUNDS',
          message: `Round start time cannot be earlier than event start (${fmtDT(event.startDate)}).`,
        });
        return null;
      }
    }
    if (event.endDate) {
      const evEnd = new Date(event.endDate).getTime();
      if (eTime > evEnd) {
        addToast({
          type: 'warning',
          title: 'OUT OF EVENT BOUNDS',
          message: `Round end time cannot be later than event end (${fmtDT(event.endDate)}).`,
        });
        return null;
      }
    }

    // 3. Check conflict/overlap with other rounds in the event
    for (const r of rounds) {
      if (r.roundId === editingRoundId) continue;
      const rStart = new Date(r.startTime).getTime();
      const rEnd = new Date(r.endTime).getTime();
      if (sTime < rEnd && rStart < eTime) {
        addToast({
          type: 'warning',
          title: 'ROUND CONFLICT',
          message: `Round schedule conflicts with "${r.name}" (${fmtDT(r.startTime)} → ${fmtDT(r.endTime)}).`,
        });
        return null;
      }
    }

    return {
      startTime: startDT,
      endTime: endDT,
    };
  }

  async function reloadRounds() {
    try {
      const res = await apiFetch<{ data: ApiRound[] }>(`/api/events/${event.eventId}/rounds`);
      setRounds(res.data.map(normalizeRound));
    } catch {
      // ignore
    }
  }

  async function addRound() {
    const name = rdName.trim();
    if (!name) {
      addToast({ type: 'warning', title: 'MISSING NAME', message: 'Please enter a round name.' });
      return;
    }
    const dates = buildRoundDates();
    if (!dates) return;
    setActionError(null);
    try {
      await apiFetch<{ data: ApiRound }>(`/api/events/${event.eventId}/rounds`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          ...dates,
          topNAdvance: rdTopN ?? undefined,
          isFinal: rdIsFinal,
        }),
      });
      await reloadRounds();
      setRdName(""); setRdStartDate(""); setRdStartTime(""); setRdEndDate(""); setRdEndTime(""); setRdIsFinal(false);
      setShowAddRound(false);
      addToast({ type: 'success', title: 'ROUND ADDED', message: `"${name}" created.` });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to add round.");
      addToast({ type: 'warning', title: 'CREATE FAILED', message: apiErrorMessage(err, 'Failed to add round.') });
    }
  }

  function startEditRound(r: RoundRow) {
    setEditingRoundId(r.roundId);
    setRdName(r.name);
    const st = splitDT(r.startTime); setRdStartDate(toDDMM(st.date)); setRdStartTime(st.time);
    const en = splitDT(r.endTime); setRdEndDate(toDDMM(en.date)); setRdEndTime(en.time);
    setRdTopN(r.topNAdvance ?? null);
    setRdIsFinal(r.isFinal);
  }

  function cancelRoundEdit() {
    setEditingRoundId(null);
    setRdName("");
    setRdStartDate(""); setRdStartTime("");
    setRdEndDate(""); setRdEndTime("");
    setRdTopN(3); setRdIsFinal(false);
  }

  async function saveRoundEdit() {
    if (editingRoundId == null) return;
    const name = rdName.trim();
    if (!name) {
      addToast({ type: 'warning', title: 'MISSING NAME', message: 'Please enter a round name.' });
      return;
    }
    const dates = buildRoundDates();
    if (!dates) return;
    setActionError(null);
    try {
      await apiFetch<{ data: ApiRound }>(`/api/events/${event.eventId}/rounds/${editingRoundId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          ...dates,
          isFinal: rdIsFinal,
          ...(rdTopN == null ? { clearTopNAdvance: true } : { topNAdvance: rdTopN }),
        }),
      });
      await reloadRounds();
      cancelRoundEdit();
      addToast({ type: 'success', title: 'ROUND UPDATED', message: `"${name}" saved.` });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to update round.");
      addToast({ type: 'warning', title: 'UPDATE FAILED', message: apiErrorMessage(err, 'Failed to update round.') });
    }
  }

  function requestDeleteRound(r: RoundRow) {
    const eventId = event.eventId;
    openConfirm({
      title: 'Delete this round?',
      message: (
        <div>
          Round <span style={{ color: C.text, fontWeight: 700 }}>"{r.name}"</span> will be deleted, along with its scoring criteria.
        </div>
      ),
      warning: 'Blocked if the round is finalized or any team has already submitted to it.',
      confirmLabel: 'DELETE ROUND',
      variant: 'danger',
      run: async () => {
        await apiFetch(`/api/events/${eventId}/rounds/${r.roundId}`, { method: 'DELETE' });
        await reloadRounds();
        if (editingRoundId === r.roundId) cancelRoundEdit();
        if (selectedRoundId === r.roundId) setSelectedRoundId(null);
        addToast({ type: 'success', title: 'ROUND DELETED', message: `"${r.name}" removed.` });
      },
    });
  }

  // Both sides of the OPEN/CLOSE toggle are confirmed first — opening starts
  // accepting submissions immediately, closing cuts teams off immediately.
  function requestOpenRound(r: RoundRow) {
    openConfirm({
      title: 'Open this round?',
      message: (
        <div>
          Round <span style={{ color: C.text, fontWeight: 700 }}>"{r.name}"</span> will be opened — teams can submit to it.
        </div>
      ),
      warning: r.status === 'CLOSED'
        ? 'This round was closed — opening it lets teams submit again.'
        : undefined,
      confirmLabel: 'OPEN ROUND',
      variant: 'cyber',
      run: async () => { await changeRoundStatus(r.roundId, 'ACTIVE'); },
    });
  }

  function requestCloseRound(r: RoundRow) {
    openConfirm({
      title: 'Close this round?',
      message: (
        <div>
          Round <span style={{ color: C.text, fontWeight: 700 }}>"{r.name}"</span> will be closed — teams can no longer submit to it.
        </div>
      ),
      warning: 'Teams are cut off immediately. You can OPEN the round again later if needed.',
      confirmLabel: 'CLOSE ROUND',
      variant: 'danger',
      run: async () => { await changeRoundStatus(r.roundId, 'CLOSED'); },
    });
  }

  async function changeRoundStatus(roundId: number, status: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/events/${event.eventId}/rounds/${roundId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setRounds(prev => prev.map(r => r.roundId === roundId ? { ...r, status } : r));
      addToast({ type: 'success', title: 'ROUND UPDATED', message: `Round set to ${status}.` });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to update round.");
      addToast({ type: 'warning', title: 'UPDATE FAILED', message: apiErrorMessage(err, 'Failed to update round.') });
    }
  }

  // Normal rounds on top, final round at the bottom
  const sortedRounds = [...rounds].sort((a, b) => {
    const aFinal = a.isFinal ? 1 : 0;
    const bFinal = b.isFinal ? 1 : 0;
    if (aFinal !== bFinal) return aFinal - bFinal;
    return a.orderNumber - b.orderNumber;
  });

  const hasExistingFinal = rounds.some(r => r.isFinal && r.roundId !== editingRoundId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {detailLoading && <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>Loading...</div>}
      {!detailLoading && sortedRounds.length === 0 && <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>No rounds yet</div>}
      {sortedRounds.map(r => {
        const isEditing = editingRoundId === r.roundId;
        const topNLabel = r.topNAdvance != null
          ? (r.isFinal ? ` · Top ${r.topNAdvance} overall (winners)` : ` · Top ${r.topNAdvance} per track advance`)
          : "";
        // Status reads from the left accent bar + the transition button
        // (OPEN ⇒ not running, CLOSE ⇒ running) instead of a separate badge.
        const roundAccent =
          r.status === 'ACTIVE' ? C.green :
          r.status === 'PENDING' ? C.yellow :
          r.status === 'FINALIZED' ? C.blue : C.red;
        return (
        <div key={r.roundId} className="row-actionable" style={{ padding: 12, background: C.surface2, border: `1px solid ${isEditing ? C.green : C.border}`, borderLeft: `3px solid ${isEditing ? C.green : roundAccent}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600 }}>
              {r.orderNumber}. {r.name}{r.isFinal ? " · FINAL" : ""}
              {/* Only the terminal state (no transition button) is spelled out. */}
              {r.status === 'FINALIZED' && <span style={{ color: C.blue, fontWeight: 700 }}> · FINALIZED</span>}
              {r.status === 'CLOSED' && <span style={{ color: C.red, fontWeight: 700 }}> · CLOSED</span>}
            </div>
            <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, marginTop: 2 }}>
              {fmtDT(r.startTime)} → {fmtDT(r.endTime)}{topNLabel}
            </div>
          </div>
          {/* Action group: [ OPEN/CLOSE toggle ][ ⋯ (Edit/Delete) ]. A round is
              either open for submissions or not: OPEN shows when it isn't
              running yet / was closed, CLOSE while it runs. Both transitions
              are confirmed first. FINALIZED is terminal — no toggle. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <div style={{ width: 84, display: "flex", justifyContent: "center" }}>
              {(r.status === 'PENDING' || r.status === 'CLOSED') && <PixelButton size="sm" variant="secondary" onClick={() => requestOpenRound(r)}>OPEN</PixelButton>}
              {r.status === 'ACTIVE' && <PixelButton size="sm" variant="danger" onClick={() => requestCloseRound(r)}>CLOSE</PixelButton>}
            </div>
            {isEditing ? (
              <PixelButton size="sm" variant="ghost" onClick={cancelRoundEdit}>CANCEL</PixelButton>
            ) : (
              <span className="row-action">
                <PixelMenu
                  ariaLabel={`Actions for round ${r.name}`}
                  items={[
                    { label: "Edit", onClick: () => startEditRound(r) },
                    ...(r.status !== 'FINALIZED'
                      ? ["divider" as const, { label: "Delete", danger: true, onClick: () => requestDeleteRound(r) }]
                      : []),
                  ]}
                />
              </span>
            )}
          </div>
        </div>
        );
      })}
      {/* Add/edit form — collapsed behind "+ ADD ROUND"; editing a row
          (via its ⋯ menu) opens the same form pre-filled. */}
      {(editingRoundId != null || showAddRound) ? (
        <div ref={roundFormRef} style={{ padding: 14, background: C.surface, border: `1px solid ${editingRoundId != null ? C.green : C.border}` }}>
          <div style={{ color: editingRoundId != null ? C.green : C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
            {editingRoundId != null ? "EDIT ROUND" : "ADD ROUND"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end" }}>
            <PixelInput label="Name" value={rdName} onChange={(e) => setRdName(e.target.value)} />
            <PixelInput label="Top N" type="number" placeholder="No cut-off" value={rdTopN == null ? "" : String(rdTopN)} onChange={(e) => setRdTopN(e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 10 }}>
            {[
              { label: "Start", date: rdStartDate, time: rdStartTime, onDate: setRdStartDate, onTime: setRdStartTime },
              { label: "End", date: rdEndDate, time: rdEndTime, onDate: setRdEndDate, onTime: setRdEndTime },
            ].map(({ label, date, time, onDate, onTime }) => (
              <div key={label} style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <PixelInput label={`${label} (DD/MM)`} type="text" placeholder="DD/MM" value={date} onChange={(e) => onDate(e.target.value)} />
                </div>
                <div style={{ width: 100 }}>
                  <PixelInput
                    label="Time (24h)"
                    type="text"
                    placeholder="HH:MM"
                    value={time}
                    onChange={(e) => onTime(formatTime24Input(e.target.value))}
                  />
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <input
              type="checkbox"
              id="rdIsFinal"
              checked={rdIsFinal}
              disabled={hasExistingFinal && !rdIsFinal}
              onChange={(e) => setRdIsFinal(e.target.checked)}
              style={{
                accentColor: C.green,
                width: 14,
                height: 14,
                cursor: hasExistingFinal && !rdIsFinal ? "not-allowed" : "pointer",
              }}
            />
            <label
              htmlFor="rdIsFinal"
              style={{
                color: hasExistingFinal && !rdIsFinal ? C.textMuted : C.text,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                cursor: hasExistingFinal && !rdIsFinal ? "not-allowed" : "pointer",
              }}
            >
              Final Round {hasExistingFinal && !rdIsFinal ? "(Sự kiện đã có vòng chung kết)" : ""}
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {editingRoundId != null ? (
              <>
                <PixelButton variant="cyber" onClick={saveRoundEdit}>SAVE</PixelButton>
                <PixelButton variant="ghost" onClick={cancelRoundEdit}>CANCEL</PixelButton>
              </>
            ) : (
              <>
                <PixelButton variant="secondary" onClick={addRound}>ADD</PixelButton>
                <PixelButton variant="ghost" onClick={() => { cancelRoundEdit(); setShowAddRound(false); }}>CANCEL</PixelButton>
              </>
            )}
          </div>
        </div>
      ) : (
        <div>
          <PixelButton variant="secondary" onClick={() => setShowAddRound(true)}>+ ADD ROUND</PixelButton>
        </div>
      )}
    </div>
  );
}
