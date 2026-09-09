import { useState, useEffect, useCallback, useMemo } from "react";
import { Trophy } from "lucide-react";
import {
  C, GradientText, PixelCard, PixelButton, PixelBadge,
} from "@/shared/components/PixelComponents";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import {
  eventsApi, roundsApi, submissionsApi, scoringApi, resultsApi, prizesApi, ApiError, apiErrorMessage,
  HackathonEvent, Round, Submission, RoundResult, Prize, SubmissionScoringProgress,
} from "@/shared/apiClient";
import { useNotifications } from "@/app/providers/NotificationProvider";

function fmtDT(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Events already over don't belong here — they move to the read-only
// "Assignment History" tab. This page only ever works the one event still
// being configured/run (the "one active event" model), same as the
// Assignments page.
const ENDED_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

function pickCurrentEvent(events: HackathonEvent[]): HackathonEvent | null {
  const live = events.filter(e => !ENDED_STATUSES.has((e.status ?? "").toUpperCase()));
  if (live.length === 0) return null;
  const priority = ["IN_PROGRESS", "SETUP", "OPEN", "DRAFT"];
  for (const status of priority) {
    const match = live.find(e => (e.status ?? "").toUpperCase() === status);
    if (match) return match;
  }
  return live[live.length - 1];
}

// Cycled per track in the Rankings section so each track's card reads as a
// visually distinct cluster rather than a repeat of the same green card.
const TRACK_ACCENTS: { glowColor: "green" | "blue" | "cyan" | "purple"; text: string; textGlow: string }[] = [
  { glowColor: "green",  text: C.greenBright, textGlow: C.greenGlow },
  { glowColor: "blue",   text: C.blueBright,  textGlow: C.blueGlow },
  { glowColor: "cyan",   text: C.cyanBright,  textGlow: C.cyanGlow },
  { glowColor: "purple", text: C.purple,      textGlow: C.purpleGlow },
];

// Fixed column widths (not left to each <table>'s own auto-layout) so every
// track's card lines up at the same x-positions instead of drifting per
// table based on that track's own content.
const RESULT_COLS_NON_FINAL = ["12%", "38%", "25%", "25%"];
const RESULT_COLS_FINAL = ["10%", "27%", "26%", "18%", "19%"];

export function CoordScoringPage() {
  const { addToast } = useNotifications();
  const [events, setEvents] = useState<HackathonEvent[]>([]);
  const currentEvent = useMemo(() => pickCurrentEvent(events), [events]);
  const selectedEventId = currentEvent?.eventId ?? null;
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [progressBySub, setProgressBySub] = useState<Record<number, SubmissionScoringProgress>>({});
  const [results, setResults] = useState<RoundResult[]>([]);
  // Awarded prizes for the event — the Final round's "winner" highlight is
  // driven by who actually has a prize, not RoundResult.advanced (that flag
  // only gets set when the round has a Top N cut-off configured, which the
  // Final round doesn't always have — prizes are the real source of truth
  // for "this team won").
  const [prizes, setPrizes] = useState<Prize[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Which footer action is awaiting confirmation. Publishing is irreversible
  // (participants see the results immediately) so it is type-to-confirm gated.
  const [confirmAction, setConfirmAction] = useState<null | "finalize" | "publish">(null);

  // Events on mount.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    eventsApi.getAll()
      .then(res => setEvents(res.data ?? []))
      .catch(err => setLoadError(err instanceof ApiError ? err.message : "Failed to load events."))
      .finally(() => setLoading(false));
  }, []);

  // Rounds when event changes.
  useEffect(() => {
    if (selectedEventId == null) { setRounds([]); setSelectedRoundId(null); return; }
    roundsApi.getAll(selectedEventId)
      .then(res => {
        const rs = res.data ?? [];
        setRounds(rs);
        setSelectedRoundId(rs[0]?.roundId ?? null);
      })
      .catch(() => { setRounds([]); setSelectedRoundId(null); });
    prizesApi.getAll(selectedEventId)
      .then(res => setPrizes(res.data ?? []))
      .catch(() => setPrizes([]));
  }, [selectedEventId]);

  const loadResults = useCallback((eventId: number, roundId: number) => {
    return resultsApi.getAll(eventId, roundId)
      .then(res => setResults(res.data ?? []))
      .catch(() => setResults([]));
  }, []);

  // Submissions + score completion + results when round changes.
  useEffect(() => {
    if (selectedEventId == null || selectedRoundId == null) {
      setSubmissions([]); setProgressBySub({}); setResults([]);
      return;
    }
    const eventId = selectedEventId, roundId = selectedRoundId;
    setActionError(null); setNotice(null);

    loadResults(eventId, roundId);

    Promise.all([
      submissionsApi.getAllForRound(roundId).then(res => res.data ?? []),
      scoringApi.getProgress(eventId, roundId).then(res => res.data ?? []),
    ])
      .then(([subs, progress]) => {
        setSubmissions(subs);
        setProgressBySub(Object.fromEntries(progress.map(item => [item.submissionId, item])));
      })
      .catch(() => { setSubmissions([]); setProgressBySub({}); });
  }, [selectedEventId, selectedRoundId, loadResults]);

  const selectedRound = rounds.find(r => r.roundId === selectedRoundId);
  const allPublished = results.length > 0 && results.every(r => r.isPublished);
  const allScoringComplete = submissions.length > 0
    && submissions.every(submission => progressBySub[submission.submissionId]?.complete === true);

  const sortedResults = results.slice().sort((a, b) => a.rankPosition - b.rankPosition);
  const topN = selectedRound?.topNAdvance ?? null;
  const prizeTeamIds = new Set(prizes.map(p => p.teamId).filter((id): id is number => id != null));
  const isFinalRound = selectedRound?.isFinal ?? false;

  // Final round → one global ranking table. Per-track round → one table per track,
  // matching the backend which now ranks (and advances Top N) within each track.
  const rankGroups: { key: string; trackName: string | null; rows: RoundResult[] }[] = isFinalRound
    ? [{ key: "all", trackName: null, rows: sortedResults }]
    : (() => {
        const m = new Map<string, RoundResult[]>();
        for (const r of sortedResults) {
          const k = r.trackName ?? "—";
          if (!m.has(k)) m.set(k, []);
          m.get(k)!.push(r);
        }
        return [...m.entries()].map(([k, rows]) => ({ key: k, trackName: k === "—" ? null : k, rows }));
      })();

  async function finalize() {
    if (selectedEventId == null || selectedRoundId == null) return;
    setBusy(true); setActionError(null); setNotice(null);
    try {
      await resultsApi.finalize(selectedEventId, selectedRoundId);
      await loadResults(selectedEventId, selectedRoundId);
      setNotice("Rankings calculated.");
      addToast({ type: 'success', title: 'RANKINGS CALCULATED', message: 'Round rankings have been calculated.' });
      setConfirmAction(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to calculate rankings.");
      addToast({ type: 'warning', title: 'CALCULATE FAILED', message: apiErrorMessage(err, 'Failed to calculate rankings.') });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (selectedEventId == null || selectedRoundId == null) return;
    setBusy(true); setActionError(null); setNotice(null);
    try {
      await resultsApi.publish(selectedEventId, selectedRoundId);
      await loadResults(selectedEventId, selectedRoundId);
      if (selectedRound?.isFinal) {
        const evRes = await eventsApi.getAll();
        setEvents(evRes.data ?? []);
        setNotice("Final results published. Event is now COMPLETED.");
        addToast({ type: 'success', title: 'EVENT COMPLETED', message: `Final results published. "${currentEvent?.name}" is now COMPLETED.` });
      } else {
        setNotice("Results published.");
        addToast({ type: 'success', title: 'RESULTS PUBLISHED', message: 'Round results are now visible to participants.' });
      }
      setConfirmAction(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to publish results.");
      addToast({ type: 'warning', title: 'PUBLISH FAILED', message: apiErrorMessage(err, 'Failed to publish results.') });
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const header = "rank_position,team_name,total_score,advanced";
    const rows = results.slice().sort((a, b) => a.rankPosition - b.rankPosition)
      .map(r => `${r.rankPosition},"${r.teamName}",${r.totalScore},${r.advanced}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `rankings-round-${selectedRoundId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 800 }}>
          <GradientText>Scoring & Results</GradientText>
        </h1>
        {currentEvent && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700 }}>{currentEvent.name}</span>
            <PixelBadge color={currentEvent.status === "IN_PROGRESS" ? "green" : "gray"}>{currentEvent.status}</PixelBadge>
          </div>
        )}
      </div>

      {loadError && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: C.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "10px 14px" }}>
          ERROR: {loadError}
        </div>
      )}

      {!loading && currentEvent == null && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: 18, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
          No event is currently open for configuration. Past events have moved to History.
        </div>
      )}

      {/* Round selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {rounds.length === 0 && !loading && (
          <span style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>No rounds in this event.</span>
        )}
        {rounds.map(r => {
          const active = selectedRoundId === r.roundId;
          return (
            <button key={r.roundId} onClick={() => setSelectedRoundId(r.roundId)}
              style={{
                padding: "10px 16px",
                background: active ? "rgba(34,197,94,0.12)" : C.surface2,
                border: active ? `1px solid ${C.green}` : `1px solid ${C.border}`,
                color: active ? C.green : C.text,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: "0.06em",
                textTransform: "uppercase", cursor: "pointer", borderRadius: 0,
                display: "flex", alignItems: "center", gap: 8,
              }}>
              {r.name}{r.isFinal ? " · Final" : ""}
              {r.status && <PixelBadge color={r.status === 'ACTIVE' ? 'green' : r.status === 'UPCOMING' ? 'yellow' : 'gray'}>{r.status}</PixelBadge>}
            </button>
          );
        })}
      </div>

      {actionError && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: C.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "10px 14px" }}>
          ERROR: {actionError}
        </div>
      )}
      {notice && (
        <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.35)", color: C.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: "10px 14px" }}>
          {notice}
        </div>
      )}

      {/* Submission status table */}
      <PixelCard style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace" }}>
            <thead>
              <tr style={{ background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
                {["Team", "Submitted", "Judges Scored", "Status"].map(h => (
                  <th key={h} style={{ color: C.green, fontSize: 10, letterSpacing: "0.12em", textAlign: "left", padding: "12px 14px", fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} style={{ padding: 20, color: C.textMuted, fontSize: 12, textAlign: "center" }}>Loading...</td></tr>
              )}
              {!loading && submissions.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 20, color: C.textMuted, fontSize: 12, textAlign: "center" }}>No submissions</td></tr>
              )}
              {!loading && submissions.map((s, i) => {
                const progress = progressBySub[s.submissionId];
                const scored = progress?.completedJudgeCount ?? 0;
                const expected = progress?.assignedJudgeCount ?? 0;
                const complete = progress?.complete === true;
                const missingJudges = (progress?.judges ?? []).filter(judge => judge.status !== 'FINAL');
                return (
                  <tr key={s.submissionId} style={{ borderBottom: `1px solid rgba(34,197,94,0.06)`, background: i % 2 === 0 ? C.surface : C.surface2 }}>
                    <td style={{ color: C.text, fontSize: 13, padding: "12px 14px" }}>{s.teamName}</td>
                    <td style={{ color: C.textMuted, fontSize: 11, padding: "12px 14px" }}>{fmtDT(s.submittedAt)}</td>
                    <td style={{ color: C.textMuted, fontSize: 12, padding: "12px 14px" }}>
                      <div>{scored}/{expected}</div>
                      {missingJudges.length > 0 && (
                        <div style={{ color: C.yellow, fontSize: 10, marginTop: 4 }}>
                          Missing: {missingJudges.map(judge => judge.judgeName).join(", ")}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <PixelBadge color={complete ? "green" : "yellow"}>{complete ? "COMPLETE" : "PENDING"}</PixelBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PixelCard>

      {/* Actions — both lifecycle actions are confirmed first; publish is
          additionally type-to-confirm gated since participants see the results
          the moment it lands. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <PixelButton variant="cyber" disabled={busy || selectedRoundId == null || !allScoringComplete} onClick={() => setConfirmAction("finalize")}>
          {busy ? "WORKING…" : "CALCULATE RANKINGS"}
        </PixelButton>
        <PixelButton variant="secondary" disabled={busy || results.length === 0 || allPublished} onClick={() => setConfirmAction("publish")}>
          {allPublished ? "PUBLISHED" : "PUBLISH RESULTS"}
        </PixelButton>
        <PixelButton variant="ghost" disabled={results.length === 0} onClick={exportCsv}>EXPORT CSV</PixelButton>
      </div>

      {confirmAction === "finalize" && (
        <ConfirmDialog
          title="Calculate rankings?"
          message={`Compute the ranking for "${selectedRound?.name ?? 'this round'}" from the submitted scores.`}
          warning={results.length > 0 ? "Recalculating overwrites the current ranking. You can run it again later." : undefined}
          confirmLabel="CALCULATE"
          variant="cyber"
          working={busy}
          onConfirm={finalize}
          onClose={() => { if (!busy) setConfirmAction(null); }}
        />
      )}
      {confirmAction === "publish" && (
        <ConfirmDialog
          title="Publish these results?"
          message={`Publish the ranking of "${selectedRound?.name ?? 'this round'}" (${results.length} team${results.length === 1 ? "" : "s"}).`}
          warning={isFinalRound
            ? "Publishing final round results will mark the event as COMPLETED and lock final standings."
            : "Results become visible to all participants immediately."}
          confirmLabel="PUBLISH RESULTS"
          variant="danger"
          requireTypedText={selectedRound?.name}
          working={busy}
          onConfirm={publish}
          onClose={() => { if (!busy) setConfirmAction(null); }}
        />
      )}

      {/* Results — each track gets its own glowing card (cycling accent color)
          instead of being merged into one shared table, so tracks read as
          distinct clusters at a glance. */}
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <GradientText style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 800 }}>
              {selectedRound?.name} — Rankings
            </GradientText>
            <PixelBadge color={allPublished ? "green" : "yellow"}>{allPublished ? "PUBLISHED" : "DRAFT"}</PixelBadge>
          </div>
          {rankGroups.map((g, i) => {
            const accent = TRACK_ACCENTS[i % TRACK_ACCENTS.length];
            const headers = isFinalRound ? ["Position", "Team", "Track", "Total Score", "Advanced"] : ["Position", "Team", "Total Score", "Advanced"];
            const colWidths = isFinalRound ? RESULT_COLS_FINAL : RESULT_COLS_NON_FINAL;
            return (
            <PixelCard key={g.key} glow gradient glowColor={isFinalRound ? "amber" : accent.glowColor} style={{ padding: 0, overflow: "hidden" }}>
              {/* Header — the brightest element in the card, via bold weight +
                  glow text, so it outshines the row data below it. Per-track
                  rounds get the track's cycling accent; the Final round gets
                  a fixed gold header (matching the "gold = Final round"
                  convention already used on the Assignments page). */}
              {isFinalRound ? (
                <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}`, background: "rgba(234,179,8,0.10)", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 8 }}>
                  <Trophy size={16} strokeWidth={2.5} color={C.yellow} style={{ filter: `drop-shadow(0 0 6px ${C.yellow})` }} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: C.yellow, letterSpacing: "0.04em", textShadow: `0 0 12px rgba(234,179,8,0.6)` }}>
                    FINAL — ALL TRACKS
                  </span>
                </div>
              ) : g.trackName && (
                <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}`, background: "rgba(34,197,94,0.10)", fontFamily: "'JetBrains Mono', monospace" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: accent.text, letterSpacing: "0.04em", textShadow: `0 0 12px ${accent.textGlow}` }}>
                    ▸ {g.trackName}
                  </span>
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace" }}>
                  <thead>
                    <tr style={{ background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
                      {headers.map((h, ci) => (
                        <th key={h} style={{ width: colWidths[ci], color: C.green, fontSize: 10, letterSpacing: "0.12em", textAlign: "left", padding: "12px 14px", fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, ri) => {
                      // The Final round's "won" state comes from actual Prize
                      // records (teamId match), not RoundResult.advanced — that
                      // flag only gets set when the round has a Top N cut-off
                      // configured, which the Final round frequently doesn't
                      // (winners are decided by prize, not a raw rank cut-off).
                      // Non-final rounds keep using advanced/Top N as before.
                      const won = isFinalRound ? prizeTeamIds.has(r.teamId) : r.advanced;
                      // Rounds with a cut-off (or, for the Final, any prizes at
                      // all) dim every team that didn't make it — "eliminated"
                      // outside their track's Top N for a normal round, or
                      // simply not a winner for the Final. Dimmed rows are
                      // faded back, not painted bright red, in both cases.
                      const hasCutoff = isFinalRound ? prizes.length > 0 : topN != null;
                      const dimmed = hasCutoff && !won;
                      const eliminated = !isFinalRound && dimmed;
                      return (
                      <tr key={r.resultId} style={{ borderBottom: `1px solid rgba(34,197,94,0.06)`, background: dimmed ? "rgba(239,68,68,0.04)" : won ? "rgba(34,197,94,0.16)" : ri % 2 === 0 ? C.surface : C.surface2, opacity: dimmed ? 0.5 : 1 }}>
                        <td style={{ color: dimmed ? C.textMuted : C.cyan, fontSize: 14, fontWeight: 700, padding: "12px 14px" }}>#{r.rankPosition}</td>
                        <td style={{ color: C.text, fontSize: 13, padding: "12px 14px" }}>{r.teamName}</td>
                        {isFinalRound && (
                          <td style={{ color: C.textMuted, fontSize: 11, padding: "12px 14px" }}>{r.trackName ?? "—"}</td>
                        )}
                        <td style={{ color: C.green, fontSize: 14, fontWeight: 700, padding: "12px 14px" }}>{Number(r.totalScore).toFixed(1)}</td>
                        <td style={{ padding: "12px 14px" }}>
                          <PixelBadge color={won ? "green" : "gray"} glow={won}>{won ? (isFinalRound ? "WINNER" : "ADVANCED") : eliminated ? "ELIMINATED" : "—"}</PixelBadge>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </PixelCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
