import { z } from "zod";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  link?: string;
};

const eventSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  status: z.string().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }),
  htmlLink: z.string().optional(),
});

export async function listCalendarEvents(accessToken: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const responseSchema = z.object({ items: z.array(eventSchema).optional(), nextPageToken: z.string().optional() });
  const events: z.infer<typeof eventSchema>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) throw new Error("Calendar access expired.");
    if (!response.ok) throw new Error("Google Calendar could not be reached.");
    const data = responseSchema.parse(await response.json());
    events.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    if (page === 9) throw new Error("Calendar range returned more events than the supported limit.");
    pageToken = data.nextPageToken;
  }
  return events.filter((event) => event.status !== "cancelled").flatMap((event) => {
    const start = event.start.dateTime ?? event.start.date;
    const end = event.end.dateTime ?? event.end.date;
    if (!start || !end) return [];
    return [{ id: event.id, title: event.summary?.trim() || "Untitled calendar event", start, end, allDay: !event.start.dateTime, link: event.htmlLink }];
  });
}
