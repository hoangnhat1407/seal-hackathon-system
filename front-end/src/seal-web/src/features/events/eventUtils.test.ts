import { describe, it, expect } from "vitest";
import {
  parseDDMM, toDDMM, yearOf,
  normalizeEvent, normalizeTrack, normalizeRound, normalizeCriteria,
  splitDT, joinDT, fmtDT,
  pickDefaultEvent, eventMeta,
  nextStatusActions, statusChangeCopy,
  type EventRow, type EventStatus,
} from "@/features/events/eventUtils";

describe("parseDDMM", () => {
  it("parses a valid DD/MM against a year into an ISO date", () => {
    expect(parseDDMM("05/03", 2026)).toBe("2026-03-05");
    expect(parseDDMM("31/12", "2027")).toBe("2027-12-31");
  });

  it("pads single-digit day/month", () => {
    expect(parseDDMM("1/2", 2026)).toBe("2026-02-01");
  });

  it("returns null for out-of-range day/month", () => {
    expect(parseDDMM("32/01", 2026)).toBeNull();
    expect(parseDDMM("01/13", 2026)).toBeNull();
    expect(parseDDMM("00/01", 2026)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseDDMM("", 2026)).toBeNull();
    expect(parseDDMM("5-3", 2026)).toBeNull();
    expect(parseDDMM("not a date", 2026)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDDMM("  05/03  ", 2026)).toBe("2026-03-05");
  });
});

describe("toDDMM", () => {
  it("reads day/month straight from a yyyy-mm-dd prefix", () => {
    expect(toDDMM("2026-03-05")).toBe("05/03");
    expect(toDDMM("2026-03-05T10:30:00")).toBe("05/03");
  });

  it("returns empty string for unparseable input", () => {
    expect(toDDMM("")).toBe("");
    expect(toDDMM(undefined)).toBe("");
    expect(toDDMM(null)).toBe("");
    expect(toDDMM("not-a-date")).toBe("");
  });

  it("round-trips with parseDDMM", () => {
    const iso = parseDDMM("05/03", 2026)!;
    expect(toDDMM(iso)).toBe("05/03");
  });
});

describe("yearOf", () => {
  it("reads the leading year from a date-ish string", () => {
    expect(yearOf("2026-03-05")).toBe(2026);
    expect(yearOf("2030-01-01T00:00:00")).toBe(2030);
  });

  it("falls back to the current year when unparseable", () => {
    expect(yearOf("")).toBe(new Date().getFullYear());
    expect(yearOf(undefined)).toBe(new Date().getFullYear());
    expect(yearOf("garbage")).toBe(new Date().getFullYear());
  });
});

describe("normalizeEvent", () => {
  it("prefers camelCase fields, falling back to snake_case then id", () => {
    const row = normalizeEvent({
      id: 5, name: "SEAL Spring", season: "Spring", year: 2026,
      registrationStart: "2026-01-01", registration_end: "2026-02-01",
      start_date: "2026-03-01", endDate: "2026-04-01",
      status: "open", trackSelectionMode: "random",
    });
    expect(row.eventId).toBe(5);
    expect(row.registrationStart).toBe("2026-01-01");
    expect(row.registrationEnd).toBe("2026-02-01");
    expect(row.startDate).toBe("2026-03-01");
    expect(row.endDate).toBe("2026-04-01");
  });

  it("uppercases status and trackSelectionMode", () => {
    const row = normalizeEvent({ status: "open", trackSelectionMode: "random" });
    expect(row.status).toBe("OPEN");
    expect(row.trackSelectionMode).toBe("RANDOM");
  });

  it("falls back to DRAFT for an unrecognized status", () => {
    const row = normalizeEvent({ status: "NOT_A_REAL_STATUS" });
    expect(row.status).toBe("DRAFT");
  });

  it("defaults trackSelectionMode to SELF_SELECT when absent or unrecognized", () => {
    expect(normalizeEvent({}).trackSelectionMode).toBe("SELF_SELECT");
    expect(normalizeEvent({ trackSelectionMode: "garbage" }).trackSelectionMode).toBe("SELF_SELECT");
  });

  it("defaults missing fields to empty/zero values", () => {
    const row = normalizeEvent({});
    expect(row.eventId).toBe(0);
    expect(row.name).toBe("");
    expect(row.year).toBeNull();
  });
});

describe("normalizeTrack", () => {
  it("prefers id, then trackId, then track_id", () => {
    expect(normalizeTrack({ id: 1, trackId: 2, track_id: 3 }).trackId).toBe(1);
    expect(normalizeTrack({ trackId: 2, track_id: 3 }).trackId).toBe(2);
    expect(normalizeTrack({ track_id: 3 }).trackId).toBe(3);
  });

  it("defaults missing fields", () => {
    const row = normalizeTrack({});
    expect(row.trackId).toBe(0);
    expect(row.name).toBe("");
    expect(row.description).toBe("");
    expect(row.capacity).toBeNull();
  });
});

describe("normalizeRound", () => {
  it("prefers camelCase over snake_case for every field", () => {
    const row = normalizeRound({
      id: 1, roundId: 2, name: "Round 1",
      orderNumber: 1, order_number: 2,
      startTime: "2026-03-01T08:00", start_time: "2026-03-02T08:00",
      topNAdvance: 3, top_n_advance: 5,
      isFinal: true, is_final: false,
      status: "active",
    });
    expect(row.roundId).toBe(1);
    expect(row.orderNumber).toBe(1);
    expect(row.startTime).toBe("2026-03-01T08:00");
    expect(row.topNAdvance).toBe(3);
    expect(row.isFinal).toBe(true);
    expect(row.status).toBe("ACTIVE");
  });

  it("defaults status to PENDING when absent", () => {
    expect(normalizeRound({}).status).toBe("PENDING");
  });

  it("defaults topNAdvance to null and isFinal to false", () => {
    const row = normalizeRound({});
    expect(row.topNAdvance).toBeNull();
    expect(row.isFinal).toBe(false);
  });
});

describe("normalizeCriteria", () => {
  it("prefers camelCase over snake_case for every field", () => {
    const row = normalizeCriteria({
      id: 1, criteriaId: 2, name: "Innovation",
      weight: 1.5, maxScore: 10, max_score: 20,
      orderNumber: 1, order_number: 2,
    });
    expect(row.criteriaId).toBe(1);
    expect(row.weight).toBe(1.5);
    expect(row.maxScore).toBe(10);
    expect(row.orderNumber).toBe(1);
  });

  it("defaults numeric fields to 0", () => {
    const row = normalizeCriteria({});
    expect(row.weight).toBe(0);
    expect(row.maxScore).toBe(0);
    expect(row.orderNumber).toBe(0);
  });
});

describe("date helpers (splitDT/joinDT/fmtDT)", () => {
  it("splitDT splits an ISO datetime into date + HH:MM", () => {
    expect(splitDT("2026-03-05T14:30:00")).toEqual({ date: "2026-03-05", time: "14:30" });
  });

  it("splitDT returns empty parts for an empty string", () => {
    expect(splitDT("")).toEqual({ date: "", time: "" });
  });

  it("splitDT tolerates a date with no time part", () => {
    expect(splitDT("2026-03-05")).toEqual({ date: "2026-03-05", time: "" });
  });

  it("joinDT combines date + time, defaulting time to 00:00", () => {
    expect(joinDT("2026-03-05", "14:30")).toBe("2026-03-05T14:30");
    expect(joinDT("2026-03-05", "")).toBe("2026-03-05T00:00");
  });

  it("joinDT returns undefined when date is empty", () => {
    expect(joinDT("", "14:30")).toBeUndefined();
  });

  it("splitDT/joinDT round-trip", () => {
    const { date, time } = splitDT("2026-03-05T14:30:00");
    expect(joinDT(date, time)).toBe("2026-03-05T14:30");
  });

  it("fmtDT formats as DD/MM HH:MM", () => {
    const iso = new Date(2026, 2, 5, 9, 5).toISOString(); // local time, month is 0-indexed (March)
    expect(fmtDT(iso)).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it("fmtDT returns an em-dash for null/undefined/empty", () => {
    expect(fmtDT(null)).toBe("—");
    expect(fmtDT(undefined)).toBe("—");
    expect(fmtDT("")).toBe("—");
  });

  it("fmtDT returns the raw string for an unparseable date", () => {
    expect(fmtDT("not-a-date")).toBe("not-a-date");
  });
});

describe("pickDefaultEvent", () => {
  function ev(overrides: Partial<EventRow>): EventRow {
    return {
      eventId: 1, name: "Event", season: "Spring", year: 2026,
      registrationStart: "", registrationEnd: "",
      startDate: "2026-01-01", endDate: "2026-01-02",
      status: "DRAFT", trackSelectionMode: "SELF_SELECT",
      ...overrides,
    };
  }

  it("returns undefined for an empty list", () => {
    expect(pickDefaultEvent([])).toBeUndefined();
  });

  it("prefers an actively-managed event (OPEN/SETUP/IN_PROGRESS) over COMPLETED/DRAFT", () => {
    const rows = [
      ev({ eventId: 1, status: "COMPLETED", endDate: "2026-05-01" }),
      ev({ eventId: 2, status: "SETUP", endDate: "2026-01-01" }),
      ev({ eventId: 3, status: "DRAFT", endDate: "2026-06-01" }),
    ];
    expect(pickDefaultEvent(rows)?.eventId).toBe(2);
  });

  it("picks the latest-ending event among several active ones", () => {
    const rows = [
      ev({ eventId: 1, status: "OPEN", endDate: "2026-01-01" }),
      ev({ eventId: 2, status: "IN_PROGRESS", endDate: "2026-06-01" }),
    ];
    expect(pickDefaultEvent(rows)?.eventId).toBe(2);
  });

  it("falls back to the latest-ending COMPLETED event when nothing is active", () => {
    const rows = [
      ev({ eventId: 1, status: "COMPLETED", endDate: "2026-01-01" }),
      ev({ eventId: 2, status: "COMPLETED", endDate: "2026-06-01" }),
      ev({ eventId: 3, status: "DRAFT", endDate: "2026-12-01" }),
    ];
    expect(pickDefaultEvent(rows)?.eventId).toBe(2);
  });

  it("falls back to the first non-DRAFT event, else the first row, when nothing is active or completed", () => {
    const rows = [
      ev({ eventId: 1, status: "DRAFT" }),
      ev({ eventId: 2, status: "CANCELLED" }),
    ];
    expect(pickDefaultEvent(rows)?.eventId).toBe(2);

    const onlyDrafts = [ev({ eventId: 9, status: "DRAFT" })];
    expect(pickDefaultEvent(onlyDrafts)?.eventId).toBe(9);
  });
});

describe("eventMeta", () => {
  function ev(startDate: string, endDate: string): EventRow {
    return {
      eventId: 1, name: "Event", season: "Spring", year: 2026,
      registrationStart: "", registrationEnd: "", startDate, endDate,
      status: "DRAFT", trackSelectionMode: "SELF_SELECT",
    };
  }

  it("prints the year once when the range stays within one year", () => {
    expect(eventMeta(ev("2026-05-28T00:00:00", "2026-06-27T00:00:00"))).toBe("28 May → 27 Jun 2026");
  });

  it("prints both years when the range spans a year boundary", () => {
    expect(eventMeta(ev("2026-12-28T00:00:00", "2027-01-02T00:00:00"))).toBe("28 Dec 2026 → 2 Jan 2027");
  });

  it("prints a single date when only one side is present", () => {
    expect(eventMeta(ev("2026-05-28T00:00:00", ""))).toBe("28 May 2026");
  });

  it("returns an empty string when both dates are missing", () => {
    expect(eventMeta(ev("", ""))).toBe("");
  });
});

describe("nextStatusActions (status-transition rules)", () => {
  const cases: [EventStatus, string[]][] = [
    ["DRAFT", ["OPEN", "CANCELLED"]],
    ["OPEN", ["SETUP", "DRAFT", "CANCELLED"]],
    ["SETUP", ["IN_PROGRESS", "OPEN", "CANCELLED"]],
    ["IN_PROGRESS", ["COMPLETED", "SETUP", "CANCELLED"]],
    ["COMPLETED", []],
    ["CANCELLED", ["DRAFT"]],
  ];

  it.each(cases)("exposes the right transitions from %s", (status, expectedNextStates) => {
    const actions = nextStatusActions(status);
    expect(actions.map(a => a.next)).toEqual(expectedNextStates);
  });

  it("never offers COMPLETED -> anything (reopen is a dedicated admin action)", () => {
    expect(nextStatusActions("COMPLETED")).toEqual([]);
  });

  it("every forward/cancel action carries a label and a variant", () => {
    for (const [status] of cases) {
      for (const action of nextStatusActions(status)) {
        expect(action.label.length).toBeGreaterThan(0);
        expect(["cyber", "danger", "secondary"]).toContain(action.variant);
      }
    }
  });
});

describe("statusChangeCopy (status-transition rules)", () => {
  it("notes that Coordinator can reopen once COMPLETED", () => {
    const copy = statusChangeCopy("IN_PROGRESS", { label: "COMPLETE EVENT", next: "COMPLETED", variant: "cyber" });
    expect(copy.title).toBe("Complete this event?");
    expect(copy.warning).toMatch(/Coordinator/i);
    expect(copy.variant).toBe("cyber");
  });

  it("warns that cancelling stops all activity", () => {
    const copy = statusChangeCopy("OPEN", { label: "CANCEL", next: "CANCELLED", variant: "danger" });
    expect(copy.title).toBe("Cancel this event?");
    expect(copy.warning).toMatch(/stop all activity/i);
    expect(copy.variant).toBe("danger");
  });

  it("states the current -> target status transition in the message", () => {
    const copy = statusChangeCopy("DRAFT", { label: "OPEN EVENT", next: "OPEN", variant: "cyber" });
    expect(copy.message).toContain("Draft");
    expect(copy.message).toContain("DRAFT");
    expect(copy.message).toContain("Open (registration)");
    expect(copy.message).toContain("OPEN");
  });

  it("has no warning for a plain (non-complete, non-cancel) transition", () => {
    const copy = statusChangeCopy("OPEN", { label: "CLOSE REGISTRATION", next: "SETUP", variant: "cyber" });
    expect(copy.warning).toBeUndefined();
    expect(copy.confirmLabel).toBe("CONFIRM");
  });
});
