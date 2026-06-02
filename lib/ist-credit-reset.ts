const IST_TIMEZONE = "Asia/Kolkata";

export type IstParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Wall-clock components in India Standard Time. */
export function getIstParts(date: Date = new Date()): IstParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}

/**
 * UTC instant for 12:30 AM IST on a given IST calendar day (y-m-d).
 * IST = UTC+5:30, so 00:30 IST = previous calendar day 19:00 UTC.
 */
export function get1230AMISTUtc(year: number, month: number, day: number): Date {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  return new Date(
    Date.UTC(year, month - 1, day, 0, 30, 0, 0) - IST_OFFSET_MS,
  );
}

/**
 * Most recent 12:30 AM IST boundary at or before `now`.
 */
export function getMostRecent1230AMIST(now: Date = new Date()): Date {
  const ist = getIstParts(now);
  let boundary = get1230AMISTUtc(ist.year, ist.month, ist.day);

  if (now.getTime() < boundary.getTime()) {
    const previousProbe = new Date(boundary.getTime() - 25 * 60 * 60 * 1000);
    const prev = getIstParts(previousProbe);
    boundary = get1230AMISTUtc(prev.year, prev.month, prev.day);
  }

  return boundary;
}

export function shouldResetDailyCreditsIST(
  lastResetDate: Date,
  now: Date = new Date(),
): boolean {
  const boundary = getMostRecent1230AMIST(now);
  return lastResetDate.getTime() < boundary.getTime();
}
