import { describe, it, expect } from "vitest";
import {
  canCreateEvent,
  canReopenEvent,
  canCompleteEvent,
  canChangeEventStatus,
  type AppRole,
} from "@/shared/permissions";

const ALL_ROLES: AppRole[] = ['PARTICIPANT', 'MENTOR', 'JUDGE', 'COORDINATOR', 'ADMIN'];

// Helper: assert a predicate is true for exactly `expected` roles and false for
// every other role (plus null / undefined).
function expectAllowedFor(
  fn: (r: AppRole | null | undefined) => boolean,
  expected: AppRole[],
) {
  for (const role of ALL_ROLES) {
    expect(fn(role), `${role}`).toBe(expected.includes(role));
  }
  expect(fn(null)).toBe(false);
  expect(fn(undefined)).toBe(false);
}

describe("event permissions", () => {
  it("only COORDINATOR can create an event", () => {
    expectAllowedFor(canCreateEvent, ['COORDINATOR']);
  });

  it("only COORDINATOR can reopen a completed event", () => {
    expectAllowedFor(canReopenEvent, ['COORDINATOR']);
  });

  it("only COORDINATOR can complete a running event", () => {
    expectAllowedFor(canCompleteEvent, ['COORDINATOR']);
  });

  it("only COORDINATOR can change other event statuses", () => {
    expectAllowedFor(canChangeEventStatus, ['COORDINATOR']);
  });

  it("a coordinator can create, complete, and reopen events directly, while admin cannot", () => {
    expect(canCreateEvent('COORDINATOR')).toBe(true);
    expect(canReopenEvent('COORDINATOR')).toBe(true);
    expect(canCompleteEvent('COORDINATOR')).toBe(true);
    expect(canCreateEvent('ADMIN')).toBe(false);
    expect(canReopenEvent('ADMIN')).toBe(false);
    expect(canCompleteEvent('ADMIN')).toBe(false);
  });
});

