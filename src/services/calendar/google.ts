import { google, calendar_v3 } from "googleapis";
import { readFileSync, existsSync } from "fs";
import { env } from "../../config/env";
import {
  TIMEZONE,
  DEFAULT_EVENT_DURATION_MINUTES,
  DEFAULT_TASK_DEADLINE_DURATION_MINUTES,
} from "../../config/constants";

export interface CalendarEventPayload {
  title: string;
  description?: string;
  startTime: string; // ISO string with offset or YYYY-MM-DDTHH:mm:ss
  endTime?: string;   // ISO string with offset
  isDeadline?: boolean;
}

export class GoogleCalendarService {
  private static calendarClient: calendar_v3.Calendar | null = null;

  private static getClient(): calendar_v3.Calendar {
    let clientEmail = env.GOOGLE_CLIENT_EMAIL;
    let privateKey = env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    // 1. Try dedicated GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY env vars
    if (clientEmail && privateKey) {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/calendar"],
      });
      this.calendarClient = google.calendar({ version: "v3", auth });
      return this.calendarClient;
    }

    let credentials: any = null;

    // 2. Try JSON env string / base64
    if (env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        const raw = env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
        if (raw.startsWith("{")) {
          credentials = JSON.parse(raw);
        } else {
          // Try base64 decoding
          const decoded = Buffer.from(raw, "base64").toString("utf-8");
          credentials = JSON.parse(decoded);
        }
      } catch (err) {
        console.warn("[GCal] Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY env:", err);
      }
    }

    // 3. Try local file path fallback for development
    const localPaths = [
      "C:\\Users\\Arya Rizky\\Downloads\\mesin-cuan-en-horror-9bb8f7df9134.json",
      "credentials.json",
    ];

    if (!credentials) {
      for (const p of localPaths) {
        if (existsSync(p)) {
          try {
            credentials = JSON.parse(readFileSync(p, "utf-8"));
            console.log(`[GCal] Loaded credentials from ${p}`);
            break;
          } catch {}
        }
      }
    }

    if (!credentials) {
      throw new Error(
        "Google Service Account key tidak ditemukan. Set GOOGLE_CLIENT_EMAIL & GOOGLE_PRIVATE_KEY di environment."
      );
    }

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    this.calendarClient = google.calendar({ version: "v3", auth });
    return this.calendarClient;
  }

  /**
   * Creates an event in Arya's Google Calendar
   */
  static async createEvent(payload: CalendarEventPayload): Promise<{
    eventId: string;
    htmlLink?: string;
    startTime: string;
    endTime: string;
  }> {
    const calendar = this.getClient();
    const calendarId = env.GOOGLE_CALENDAR_ID || "aryarizkyardhipratama@gmail.com";

    const startDate = new Date(payload.startTime);
    let endDate: Date;

    if (payload.endTime) {
      endDate = new Date(payload.endTime);
    } else {
      const durationMin = payload.isDeadline
        ? DEFAULT_TASK_DEADLINE_DURATION_MINUTES
        : DEFAULT_EVENT_DURATION_MINUTES;
      endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);
    }

    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: payload.title,
        description: payload.description || "Dibuat otomatis oleh Omni-Bot",
        start: {
          dateTime: startDate.toISOString(),
          timeZone: TIMEZONE,
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: TIMEZONE,
        },
      },
    });

    const eventId = response.data.id;
    if (!eventId) throw new Error("Gagal mendapatkan ID event dari Google Calendar.");

    return {
      eventId,
      htmlLink: response.data.htmlLink || undefined,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
    };
  }

  /**
   * Deletes an event from Google Calendar
   */
  static async deleteEvent(eventId: string): Promise<boolean> {
    const calendar = this.getClient();
    const calendarId = env.GOOGLE_CALENDAR_ID || "aryarizkyardhipratama@gmail.com";

    try {
      await calendar.events.delete({
        calendarId,
        eventId,
      });
      return true;
    } catch (err: any) {
      // 404/410 means already deleted
      if (err?.status === 404 || err?.status === 410) return true;
      throw err;
    }
  }
}
