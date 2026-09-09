import { useState } from "react";
import { C, PixelCard, PixelButton, PixelInput } from "@/shared/components/PixelComponents";
import { apiFetch, ApiError, apiErrorMessage } from "@/shared/apiClient";
import { useNotifications } from "@/app/providers/NotificationProvider";
import {
  TrackMode, EventRow, ApiEvent,
  normalizeEvent, parseDDMM, toDDMM,
} from "@/features/events/eventUtils";

export type EventSeason = 'SPRING' | 'SUMMER' | 'FALL';

export function dateToLocalDateTime(date: string, time = "08:00:00") {
  if (!date) return undefined;
  return `${date}T${time}`;
}

export const SEASON_DATE_DEFAULTS: Record<EventSeason, { regStart: string; regEnd: string; start: string; end: string }> = {
  SPRING: { regStart: "01/02", regEnd: "31/03", start: "10/04", end: "11/04" },
  SUMMER: { regStart: "01/06", regEnd: "31/07", start: "10/08", end: "11/08" },
  FALL:   { regStart: "01/10", regEnd: "30/11", start: "10/12", end: "11/12" },
};

export function seasonWindow(season: EventSeason, yearValue: string) {
  const year = Number(yearValue) || new Date().getFullYear();
  const bounds: Record<EventSeason, { start: string; end: string }> = {
    SPRING: { start: "01-01", end: "04-30" },
    SUMMER: { start: "05-01", end: "08-31" },
    FALL: { start: "09-01", end: "12-31" },
  };
  const bound = bounds[season];
  return {
    label: `${season} ${year}`,
    start: `${year}-${bound.start}`,
    end: `${year}-${bound.end}`,
  };
}

export function createEventDateErrors(
  season: EventSeason | "",
  year: string,
  registrationStart: string,
  registrationEnd: string,
  startDate: string,
  endDate: string,
) {
  const errors: string[] = [];
  if (season === "") {
    errors.push("Please select a season.");
    return errors;
  }
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 2026 || numericYear > 3000) {
    errors.push("Year must be between 2026 and 3000.");
    return errors;
  }

  const w = seasonWindow(season, year);
  const parsed = [
    ["Registration start date", parseDDMM(registrationStart, year)],
    ["Registration end date", parseDDMM(registrationEnd, year)],
    ["Start date", parseDDMM(startDate, year)],
    ["End date", parseDDMM(endDate, year)],
  ] as const;

  const missing = parsed.filter(([, v]) => !v).map(([label]) => label);
  if (missing.length > 0) {
    errors.push(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} invalid — use DD/MM format (e.g. 05/03).`);
    return errors;
  }

  const [rsDate, reDate, sDate, eDate] = parsed.map(([, v]) => v!);

  const outside = parsed.filter(([, v]) => v! < w.start || v! > w.end).map(([label]) => label);
  if (outside.length > 0) {
    errors.push(`${outside.join(", ")} must be within ${w.label} (${toDDMM(w.start)} → ${toDDMM(w.end)}).`);
  }
  if (reDate < rsDate) errors.push("Registration end must be on or after registration start.");
  if (sDate < reDate) errors.push("The competition must start after registration closes.");
  if (eDate < sDate) errors.push("End date must be on or after start date.");
  return errors;
}

interface CreateEventCardProps {
  onCreated: (event: EventRow) => void;
  onCancel: () => void;
}

export function CreateEventCard({ onCreated, onCancel }: CreateEventCardProps) {
  const { addToast } = useNotifications();

  const [evName, setEvName] = useState("");
  const [evTopic, setEvTopic] = useState("");
  const [evSeason, setEvSeason] = useState<EventSeason | "">("");
  const [evYear, setEvYear] = useState(String(new Date().getFullYear()));
  const [evRegStart, setEvRegStart] = useState("");
  const [evRegEnd, setEvRegEnd] = useState("");
  const [evStart, setEvStart] = useState("");
  const [evEnd, setEvEnd] = useState("");
  const [evMode, setEvMode] = useState<TrackMode>("SELF_SELECT");

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function resetCreateForm() {
    setEvName("");
    setEvTopic("");
    setEvSeason("");
    setEvYear(String(new Date().getFullYear()));
    setEvRegStart("");
    setEvRegEnd("");
    setEvStart("");
    setEvEnd("");
    setEvMode("SELF_SELECT");
    setCreateError(null);
  }

  function handleCreateSeasonChange(season: EventSeason | "") {
    setEvSeason(season);
    if (season === "") return;
    const d = SEASON_DATE_DEFAULTS[season];
    setEvRegStart(prev => prev || d.regStart);
    setEvRegEnd(prev => prev || d.regEnd);
    setEvStart(prev => prev || d.start);
    setEvEnd(prev => prev || d.end);
  }

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    if (!evName.trim()) {
      addToast({ type: 'warning', title: 'MISSING NAME', message: 'Please enter an event name.' });
      return;
    }
    const dateErrors = createEventDateErrors(evSeason, evYear, evRegStart, evRegEnd, evStart, evEnd);
    if (dateErrors.length > 0) {
      const message = dateErrors.join(" ");
      setCreateError(message);
      addToast({ type: 'warning', title: 'CHECK DATES', message });
      return;
    }
    if (evSeason === "") return;
    setCreateError(null);
    setCreating(true);
    try {
      const res = await apiFetch<{ data: ApiEvent }>('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          name: evName,
          topic: evTopic,
          season: evSeason,
          year: Number(evYear) || new Date().getFullYear(),
          registrationStart: dateToLocalDateTime(parseDDMM(evRegStart, evYear)!, "00:00:00"),
          registrationEnd: dateToLocalDateTime(parseDDMM(evRegEnd, evYear)!, "23:59:59"),
          startDate: dateToLocalDateTime(parseDDMM(evStart, evYear)!),
          endDate: dateToLocalDateTime(parseDDMM(evEnd, evYear)!, "23:59:59"),
          status: 'DRAFT',
          trackSelectionMode: evMode,
        }),
      });
      const created = normalizeEvent(res.data);
      resetCreateForm();
      onCreated(created);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Failed to create event.");
      addToast({ type: 'warning', title: 'CREATE FAILED', message: apiErrorMessage(err, 'Failed to create event.') });
    } finally {
      setCreating(false);
    }
  }

  return (
    <PixelCard glow style={{ padding: 20 }}>
      <div style={{ color: C.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
        CREATE EVENT
      </div>
      {createError && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: C.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "10px 14px", marginBottom: 14 }}>
          ERROR: {createError}
        </div>
      )}
      <form onSubmit={addEvent} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <PixelInput label="Event Name" value={evName} onChange={(e) => setEvName(e.target.value)} placeholder="e.g. FPT Hackathon 2026" />
          <div style={{ gridColumn: "span 2" }}>
            <PixelInput
              label="Topic" value={evTopic} onChange={(e) => setEvTopic(e.target.value)}
              placeholder="The overall competition theme"
            />
          </div>
          <div>
            <label style={{ color: C.greenMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Season</label>
            <select value={evSeason} onChange={(e) => handleCreateSeasonChange(e.target.value as EventSeason | "")} style={{ width: "100%", marginTop: 6, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.border}`, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, borderRadius: 0, outline: "none" }}>
              <option value="">— select season —</option>
              <option value="SPRING">Spring</option>
              <option value="SUMMER">Summer</option>
              <option value="FALL">Fall</option>
            </select>
          </div>
          <PixelInput label="Year" type="number" value={evYear} onChange={(e) => setEvYear(e.target.value)} />
          <PixelInput label="Registration Start" type="text" placeholder="DD/MM" value={evRegStart} onChange={(e) => setEvRegStart(e.target.value)} />
          <PixelInput label="Registration End" type="text" placeholder="DD/MM" value={evRegEnd} onChange={(e) => setEvRegEnd(e.target.value)} />
          <div>
            <label style={{ color: C.greenMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Track Assignment</label>
            <select value={evMode} onChange={(e) => setEvMode(e.target.value as TrackMode)} style={{ width: "100%", marginTop: 6, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.border}`, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, borderRadius: 0, outline: "none" }}>
              <option value="SELF_SELECT">Teams self-select</option>
              <option value="RANDOM">Random draw</option>
            </select>
          </div>
          <PixelInput label="Start Date" type="text" placeholder="DD/MM" value={evStart} onChange={(e) => setEvStart(e.target.value)} />
          <PixelInput label="End Date" type="text" placeholder="DD/MM" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} />
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: "flex", gap: 10 }}>
          <PixelButton type="submit" variant="cyber">{creating ? "CREATING..." : "ADD EVENT"}</PixelButton>
          <PixelButton type="button" variant="secondary" onClick={() => { resetCreateForm(); onCancel(); }}>CANCEL</PixelButton>
        </div>
      </form>
    </PixelCard>
  );
}
