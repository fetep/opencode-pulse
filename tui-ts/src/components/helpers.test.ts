import { describe, test, expect } from "bun:test";
import {
  relativeTime,
  todoBar,
  truncate,
  dirName,
  stripControl,
  allocateWidths,
  fitContentWidth,
  statusColor,
  renderCell,
  STATUS_ICONS,
  STATUS_LABELS,
  COLUMN_META,
  DEFAULT_COLUMNS,
  ALL_COLUMNS,
  type ColumnId,
} from "./SessionList.js";
import type { Session } from "../db.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    pid: 12345,
    session_id: "ses_test",
    project_id: "proj_test",
    directory: "/home/user/my-project",
    title: "Fix authentication",
    status: "idle",
    retry_message: "",
    retry_next: 0,
    error_message: "",
    tmux_pane: "%1",
    tmux_target: "dev",
    opencode_version: "1.2.0",
    todo_total: 5,
    todo_done: 3,
    heartbeat_at: Date.now(),
    created_at: Date.now() - 3600_000,
    updated_at: Date.now() - 60_000,
    ...overrides,
  };
}

describe("relativeTime", () => {
  test("seconds ago", () => {
    const result = relativeTime(Date.now() - 30_000);
    expect(result).toBe("30s ago");
  });

  test("zero seconds", () => {
    const result = relativeTime(Date.now());
    expect(result).toBe("0s ago");
  });

  test("minutes ago", () => {
    const result = relativeTime(Date.now() - 5 * 60_000);
    expect(result).toBe("5m ago");
  });

  test("hours ago", () => {
    const result = relativeTime(Date.now() - 3 * 3600_000);
    expect(result).toBe("3h ago");
  });

  test("days ago", () => {
    const result = relativeTime(Date.now() - 2 * 86400_000);
    expect(result).toBe("2d ago");
  });

  test("boundary: 59 seconds → seconds", () => {
    const result = relativeTime(Date.now() - 59_000);
    expect(result).toBe("59s ago");
  });

  test("boundary: 60 seconds → 1 minute", () => {
    const result = relativeTime(Date.now() - 60_000);
    expect(result).toBe("1m ago");
  });

  test("boundary: 59 minutes → minutes", () => {
    const result = relativeTime(Date.now() - 59 * 60_000);
    expect(result).toBe("59m ago");
  });

  test("boundary: 60 minutes → 1 hour", () => {
    const result = relativeTime(Date.now() - 60 * 60_000);
    expect(result).toBe("1h ago");
  });

  test("boundary: 23 hours → hours", () => {
    const result = relativeTime(Date.now() - 23 * 3600_000);
    expect(result).toBe("23h ago");
  });

  test("boundary: 24 hours → 1 day", () => {
    const result = relativeTime(Date.now() - 24 * 3600_000);
    expect(result).toBe("1d ago");
  });
});

describe("todoBar", () => {
  test("zero total shows em dash", () => {
    expect(todoBar(0, 0)).toBe("\u2014");
  });

  test("zero done shows empty bar", () => {
    const result = todoBar(0, 8);
    expect(result).toContain("[");
    expect(result).toContain("]");
    expect(result).toContain("0/8");
    expect(result).not.toContain("█");
  });

  test("partial completion", () => {
    const result = todoBar(3, 5);
    expect(result).toContain("3/5");
    expect(result).toContain("█");
    expect(result).toContain("░");
  });

  test("full completion", () => {
    const result = todoBar(5, 5);
    expect(result).toContain("5/5");
    expect(result).toContain("████████");
    expect(result).not.toContain("░");
  });

  test("half completion has ~4 filled blocks", () => {
    const result = todoBar(4, 8);
    const filledCount = (result.match(/█/g) || []).length;
    expect(filledCount).toBe(4);
  });

  test("bar always has 8 total characters inside brackets", () => {
    const result = todoBar(2, 10);
    const barContent = result.match(/\[(.*?)\]/)?.[1] || "";
    expect(barContent.length).toBe(8);
  });
});

describe("truncate", () => {
  test("string shorter than maxLen passes through", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("string exactly maxLen passes through", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  test("string longer than maxLen gets ellipsis", () => {
    const result = truncate("hello world", 8);
    expect(result.length).toBe(8);
    expect(result).toBe("hello w\u2026");
  });

  test("maxLen of 1 takes single char", () => {
    expect(truncate("hello", 1)).toBe("h");
  });

  test("maxLen of 2 truncates with ellipsis", () => {
    expect(truncate("hello", 2)).toBe("h\u2026");
  });

  test("empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});

describe("dirName", () => {
  test("extracts last path component", () => {
    expect(dirName("/home/user/my-project")).toBe("my-project");
  });

  test("handles single directory name", () => {
    expect(dirName("my-project")).toBe("my-project");
  });

  test("handles empty string", () => {
    expect(dirName("")).toBe("unknown");
  });

  test("handles trailing slash", () => {
    const result = dirName("/home/user/project/");
    expect(result).toBe("/home/user/project/");
  });

  test("root path", () => {
    expect(dirName("/")).toBe("/");
  });
});

describe("stripControl", () => {
  test("passes through normal text", () => {
    expect(stripControl("hello world")).toBe("hello world");
  });

  test("strips ANSI color codes", () => {
    expect(stripControl("\x1b[31mred text\x1b[0m")).toBe("red text");
  });

  test("strips ANSI cursor movement", () => {
    expect(stripControl("\x1b[2Jclear screen")).toBe("clear screen");
  });

  test("strips OSC sequences", () => {
    expect(stripControl("\x1b]0;window title\x07rest")).toBe("rest");
  });

  test("strips C0 control characters", () => {
    expect(stripControl("hello\x00\x01\x02world")).toBe("helloworld");
  });

  test("preserves tabs and newlines", () => {
    expect(stripControl("hello\tworld\n")).toBe("hello\tworld\n");
  });

  test("strips C1 control characters", () => {
    expect(stripControl("hello\x9bworld")).toBe("helloworld");
  });

  test("handles empty string", () => {
    expect(stripControl("")).toBe("");
  });

  test("handles string with only escape sequences", () => {
    expect(stripControl("\x1b[31m\x1b[0m")).toBe("");
  });
});

describe("STATUS_ICONS", () => {
  test("all statuses have icons", () => {
    const statuses = ["permission_pending", "question_pending", "error", "retry", "idle", "busy"];
    for (const status of statuses) {
      expect(STATUS_ICONS[status]).toBeTruthy();
    }
  });

  test("permission_pending is triangle", () => {
    expect(STATUS_ICONS.permission_pending).toBe("\u25B2");
  });

  test("question_pending is question mark", () => {
    expect(STATUS_ICONS.question_pending).toBe("?");
  });
});

describe("STATUS_LABELS", () => {
  test("all statuses have labels", () => {
    const statuses = ["permission_pending", "question_pending", "error", "retry", "idle", "busy"];
    for (const status of statuses) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });
});

describe("statusColor", () => {
  test("returns a color string for known statuses", () => {
    const statuses = ["permission_pending", "question_pending", "error", "retry", "idle", "busy"];
    for (const status of statuses) {
      const color = statusColor(status);
      expect(color).toBeTruthy();
      expect(color).toMatch(/^#/);
    }
  });

  test("returns muted color for unknown status", () => {
    const color = statusColor("unknown_status");
    expect(color).toBeTruthy();
    expect(color).toMatch(/^#/);
  });
});

describe("COLUMN_META", () => {
  test("all columns in ALL_COLUMNS have metadata", () => {
    for (const col of ALL_COLUMNS) {
      const meta = COLUMN_META[col];
      expect(meta).toBeTruthy();
      expect(meta.header).toBeTruthy();
      expect(meta.minWidth).toBeGreaterThan(0);
      expect(typeof meta.flex).toBe("boolean");
      expect(meta.description).toBeTruthy();
    }
  });

  test("DEFAULT_COLUMNS is a subset of ALL_COLUMNS", () => {
    for (const col of DEFAULT_COLUMNS) {
      expect(ALL_COLUMNS).toContain(col);
    }
  });
});

describe("allocateWidths", () => {
  test("non-flex columns get minWidth", () => {
    const cols: ColumnId[] = ["status", "pid"];
    const widths = allocateWidths(cols, 100, []);
    expect(widths[0]).toBeGreaterThanOrEqual(12);
    expect(widths[1]).toBeGreaterThanOrEqual(7);
  });

  test("flex columns expand to fill remaining space", () => {
    const cols: ColumnId[] = ["status", "title"];
    const widths = allocateWidths(cols, 100, []);
    expect(widths[1]).toBeGreaterThan(COLUMN_META.title.minWidth);
  });

  test("multiple flex columns share extra space", () => {
    const cols: ColumnId[] = ["project", "title"];
    const widths = allocateWidths(cols, 100, []);
    const diff = Math.abs(widths[0] - widths[1]);
    expect(diff).toBeLessThanOrEqual(
      Math.abs(COLUMN_META.project.minWidth - COLUMN_META.title.minWidth) + 1,
    );
  });

  test("minimum width of 1 guaranteed", () => {
    const cols: ColumnId[] = ["status", "project", "title", "todo", "updated", "age"];
    const widths = allocateWidths(cols, 20, []);
    for (const w of widths) {
      expect(w).toBeGreaterThanOrEqual(1);
    }
  });

  test("fitContent columns use actual content width", () => {
    const sessions = [makeSession({ tmux_target: "my-long-session-name" })];
    const cols: ColumnId[] = ["tmux"];
    const widths = allocateWidths(cols, 100, sessions);
    expect(widths[0]).toBeGreaterThanOrEqual("my-long-session-name".length);
  });
});

describe("fitContentWidth", () => {
  test("returns minWidth when no sessions", () => {
    const width = fitContentWidth("tmux", []);
    expect(width).toBe(COLUMN_META.tmux.minWidth);
  });

  test("returns max content width across sessions", () => {
    const sessions = [
      makeSession({ tmux_target: "short" }),
      makeSession({ pid: 22222, tmux_target: "much-longer-name" }),
    ];
    const width = fitContentWidth("tmux", sessions);
    expect(width).toBeGreaterThanOrEqual("much-longer-name".length);
  });
});

describe("renderCell", () => {
  test("status cell shows icon and label", () => {
    const session = makeSession({ status: "idle" });
    const cell = renderCell("status", session, 20);
    expect(cell.text).toContain(STATUS_ICONS.idle);
    expect(cell.text).toContain(STATUS_LABELS.idle);
  });

  test("project cell shows directory basename", () => {
    const session = makeSession({ directory: "/home/user/my-project" });
    const cell = renderCell("project", session, 20);
    expect(cell.text).toContain("my-project");
  });

  test("title cell shows session title", () => {
    const session = makeSession({ title: "Fix auth" });
    const cell = renderCell("title", session, 20);
    expect(cell.text).toContain("Fix auth");
  });

  test("title cell shows em dash for empty title", () => {
    const session = makeSession({ title: "" });
    const cell = renderCell("title", session, 20);
    expect(cell.text).toContain("\u2014");
  });

  test("todo cell shows bar when total > 0", () => {
    const session = makeSession({ todo_done: 3, todo_total: 5 });
    const cell = renderCell("todo", session, 20);
    expect(cell.text).toContain("3/5");
  });

  test("todo cell shows em dash when total = 0", () => {
    const session = makeSession({ todo_done: 0, todo_total: 0 });
    const cell = renderCell("todo", session, 20);
    expect(cell.text).toContain("\u2014");
  });

  test("pid cell shows process id", () => {
    const session = makeSession({ pid: 42 });
    const cell = renderCell("pid", session, 10);
    expect(cell.text).toContain("42");
  });

  test("version cell shows version with v prefix", () => {
    const session = makeSession({ opencode_version: "1.2.0" });
    const cell = renderCell("version", session, 15);
    expect(cell.text).toContain("v1.2.0");
  });

  test("version cell shows em dash when no version", () => {
    const session = makeSession({ opencode_version: "" });
    const cell = renderCell("version", session, 15);
    expect(cell.text).toContain("\u2014");
  });

  test("tmux cell shows target or pane", () => {
    const session = makeSession({ tmux_target: "dev", tmux_pane: "%1" });
    const cell = renderCell("tmux", session, 15);
    expect(cell.text).toContain("dev");
  });

  test("tmux cell prefers target over pane", () => {
    const session = makeSession({ tmux_target: "dev", tmux_pane: "%1" });
    const cell = renderCell("tmux", session, 15);
    expect(cell.text.trim()).toContain("dev");
  });

  test("message cell shows error for error status", () => {
    const session = makeSession({
      status: "error",
      error_message: "API failed",
    });
    const cell = renderCell("message", session, 30);
    expect(cell.text).toContain("API failed");
  });

  test("message cell shows retry message for retry status", () => {
    const session = makeSession({
      status: "retry",
      retry_message: "rate limited",
    });
    const cell = renderCell("message", session, 30);
    expect(cell.text).toContain("rate limited");
  });

  test("message cell shows em dash for idle status", () => {
    const session = makeSession({ status: "idle" });
    const cell = renderCell("message", session, 30);
    expect(cell.text).toContain("\u2014");
  });

  test("cell text is padded to width", () => {
    const session = makeSession();
    const width = 25;
    const cell = renderCell("title", session, width);
    expect(cell.text.length).toBe(width);
  });

  test("cell text is truncated when content exceeds width", () => {
    const session = makeSession({ title: "A very long title that exceeds the column width" });
    const width = 15;
    const cell = renderCell("title", session, width);
    expect(cell.text.length).toBe(width);
  });

  test("cell color is a hex string", () => {
    const session = makeSession();
    for (const col of ALL_COLUMNS) {
      const cell = renderCell(col, session, 20);
      expect(cell.color).toMatch(/^#/);
    }
  });
});
