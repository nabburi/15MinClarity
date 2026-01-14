import { formatInTimeZone } from "date-fns-tz";

const TZ = "America/Los_Angeles";

export function laLocalDayString(d = new Date()) {
  // returns "YYYY-MM-DD"
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}
