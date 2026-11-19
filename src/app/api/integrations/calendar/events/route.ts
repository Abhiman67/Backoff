import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi, HttpError, invalid } from "@/lib/api";
import { getCalendarAccessToken } from "@/lib/integrations/calendar-token";
import { listCalendarEvents } from "@/lib/integrations/calendar";

const dateSchema = z.string().datetime({ offset: true });

export const GET = handleApi(async (request, { userId }) => {
  const url = new URL(request.url);
  const parsed = z.object({ timeMin: dateSchema, timeMax: dateSchema }).safeParse({
    timeMin: url.searchParams.get("timeMin"),
    timeMax: url.searchParams.get("timeMax"),
  });
  if (!parsed.success) throw invalid("Provide valid start and end dates.");
  const start = new Date(parsed.data.timeMin).getTime();
  const end = new Date(parsed.data.timeMax).getTime();
  if (end <= start || end - start > 7 * 86400000) throw invalid("Calendar range must be within seven days.");
  let token: string | null;
  try {
    token = await getCalendarAccessToken(userId);
  } catch {
    throw new HttpError("TOKEN_EXPIRED", 401, "Calendar access expired. Reconnect to continue.");
  }
  if (!token) throw new HttpError("CALENDAR_NOT_CONNECTED", 404, "Google Calendar is not connected.");
  try {
    const events = await listCalendarEvents(token, parsed.data.timeMin, parsed.data.timeMax);
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    throw new HttpError("CALENDAR_SYNC_FAILED", 502, "Google Calendar could not be reached. Try again.");
  }
});
