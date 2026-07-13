import { describe, expect, it } from "vitest";
import { safeSpreadsheetText, toCsv, xlsxPayload } from "../src/index.js";
describe("safe exports", () => {
  it.each(["=1+1", "+cmd", "-10", "@sum", "\t=cmd"])(
    "neutralizes %s",
    (value) => expect(safeSpreadsheetText(value).startsWith("'")).toBe(true),
  );
  it("preserves leading-zero identifiers as text", () =>
    expect(
      new TextDecoder().decode(
        toCsv({
          sheetName: "Export",
          columns: ["UPC"],
          rows: [["012345678905"]],
        }),
      ),
    ).toContain('"012345678905"'));
  it("quotes quotes and newlines", () =>
    expect(
      new TextDecoder().decode(
        toCsv({ sheetName: "Export", columns: ["Name"], rows: [['a"b\nc']] }),
      ),
    ).toContain('"a""b\nc"'));
  it("uses a fixed safe worksheet payload", () =>
    expect(
      xlsxPayload([
        { sheetName: "=unsafe", columns: ["a"], rows: [["=bad"]] },
      ])[0],
    ).toEqual({ sheet_name: "=unsafe", columns: ["a"], rows: [["'=bad"]] }));
});
