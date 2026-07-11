import { describe, expect, it } from "vitest";
import { widgetHtml } from "./widget.js";

describe("embedded inbox", () => {
  it("renders approval controls and calls the host bridge", () => {
    expect(widgetHtml).toContain("Pigeon inbox");
    expect(widgetHtml).toContain("prepare_approval");
    expect(widgetHtml).toContain("tools/call");
    expect(widgetHtml).toContain("Reject");
  });
});
