import { describe, expect, test } from "bun:test";
import { parseConfigContent } from "./config.js";

describe("parseConfigContent", () => {
  test("parses plain JSON", () => {
    const result = parseConfigContent(JSON.stringify({
      columns: ["status", "title"],
      theme: "dracula",
      dbPath: "/tmp/test.db",
      debug: true,
    }));
    expect(result.columns).toEqual(["status", "title"]);
    expect(result.theme).toBe("dracula");
    expect(result.dbPath).toBe("/tmp/test.db");
    expect(result.debug).toBe(true);
  });

  test("parses JSONC (comments and trailing commas)", () => {
    const input = [
      "{",
      "  // line comment",
      "  /* block comment */",
      '  "columns": ["status", "title",],',
      '  "debug": true,',
      "}",
    ].join("\n");
    const result = parseConfigContent(input);
    expect(result.columns).toEqual(["status", "title"]);
    expect(result.debug).toBe(true);
  });

  test("throws on invalid input with file path", () => {
    expect(() => parseConfigContent("{ broken", "/etc/pulse.json")).toThrow(
      "/etc/pulse.json",
    );
  });
});
