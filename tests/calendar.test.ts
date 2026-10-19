import { describe, expect, test } from "bun:test";
import { GoogleCalendarService } from "../src/services/calendar/google";
import {
  DEFAULT_EVENT_DURATION_MINUTES,
  DEFAULT_TASK_DEADLINE_DURATION_MINUTES,
} from "../src/config/constants";

describe("GoogleCalendarService Logic & Defaults", () => {
  test("constants are defined as required by PRD (60m event, 30m deadline)", () => {
    expect(DEFAULT_EVENT_DURATION_MINUTES).toBe(60);
    expect(DEFAULT_TASK_DEADLINE_DURATION_MINUTES).toBe(30);
  });
});
