import { describe, expect, it } from "vitest";
import { nextWeekStart, weekStart } from "./week";

const BERLIN = "Europe/Berlin";
/** How the instant reads on a Berlin wall clock – that is what the reset promises. */
const berlin = (d: Date) => d.toLocaleString("sv-SE", { timeZone: BERLIN });

describe("weekStart", () => {
  it("returns Monday 00:00 local time for a day in the middle of the week", () => {
    // Wednesday, 2026-09-09 14:32 Berlin (summer time, UTC+2)
    expect(berlin(weekStart(new Date("2026-09-09T12:32:00Z"), BERLIN))).toBe("2026-09-07 00:00:00");
  });

  it("treats Sunday as the last day of the week, not the first", () => {
    expect(berlin(weekStart(new Date("2026-09-13T20:00:00Z"), BERLIN))).toBe("2026-09-07 00:00:00");
  });

  it("keeps a Monday just after midnight in its own week", () => {
    expect(berlin(weekStart(new Date("2026-09-07T00:30:00+02:00"), BERLIN))).toBe("2026-09-07 00:00:00");
  });

  it("puts Sunday 23:59 and the following Monday 00:01 into different weeks", () => {
    const sunday = weekStart(new Date("2026-09-13T23:59:00+02:00"), BERLIN);
    const monday = weekStart(new Date("2026-09-14T00:01:00+02:00"), BERLIN);
    expect(berlin(sunday)).toBe("2026-09-07 00:00:00");
    expect(berlin(monday)).toBe("2026-09-14 00:00:00");
  });

  it("still lands on local midnight in the week of a DST switch", () => {
    // Clocks go back on Sunday 2026-10-25; the week starts on the 19th at UTC+2.
    expect(berlin(weekStart(new Date("2026-10-26T09:00:00Z"), BERLIN))).toBe("2026-10-26 00:00:00");
    expect(berlin(weekStart(new Date("2026-10-24T09:00:00Z"), BERLIN))).toBe("2026-10-19 00:00:00");
  });

  it("works for a zone behind UTC", () => {
    expect(new Date(weekStart(new Date("2026-09-09T03:00:00Z"), "America/New_York")).toISOString()).toBe("2026-09-07T04:00:00.000Z");
  });
});

describe("nextWeekStart", () => {
  it("is the following Monday at local midnight", () => {
    expect(berlin(nextWeekStart(new Date("2026-09-09T12:00:00Z"), BERLIN))).toBe("2026-09-14 00:00:00");
  });

  it("stays at midnight across the autumn DST switch", () => {
    // The week of 19 Oct starts at UTC+2 and ends at UTC+1 – a plain +7 days would land at 23:00.
    expect(berlin(nextWeekStart(new Date("2026-10-21T12:00:00Z"), BERLIN))).toBe("2026-10-26 00:00:00");
  });
});
