import { describe, expect, it } from "vitest";
import { conciergeTools, parseToolEffect } from "./tools.js";

describe("conciergeTools", () => {
  it("registers exactly the three intake tool names", () => {
    expect(conciergeTools.map((t) => t.name).sort()).toEqual(
      ["not_a_bug_close", "request_human", "submit_intake_packet"],
    );
  });
});

describe("parseToolEffect", () => {
  it("parses a submit_intake_packet call", () => {
    const effect = parseToolEffect("submit_intake_packet", {
      whatUserWasDoing: "booking a trailer",
      whatHappened: "checkout failed with a 500",
      reproSteps: ["go to /rentals", "pick a trailer", "click checkout"],
      affectedFeature: "rentals",
      severityHint: "blocker",
    });
    expect(effect).toEqual({
      kind: "submit_intake",
      whatUserWasDoing: "booking a trailer",
      whatHappened: "checkout failed with a 500",
      reproSteps: ["go to /rentals", "pick a trailer", "click checkout"],
      affectedFeature: "rentals",
      severityHint: "blocker",
    });
  });

  it("parses a request_human call", () => {
    const effect = parseToolEffect("request_human", {
      reason: "billing dispute",
      urgency: "elevated",
    });
    expect(effect).toEqual({
      kind: "request_human",
      reason: "billing dispute",
      urgency: "elevated",
    });
  });

  it("parses a not_a_bug_close call", () => {
    const effect = parseToolEffect("not_a_bug_close", {
      category: "question",
      summary: "asked how to extend a rental — pointed to docs",
    });
    expect(effect).toEqual({
      kind: "not_a_bug",
      category: "question",
      summary: "asked how to extend a rental — pointed to docs",
    });
  });

  it("returns null for unknown tools", () => {
    expect(parseToolEffect("not_a_real_tool", {})).toBeNull();
  });

  it("coerces missing repro steps to an empty array", () => {
    const effect = parseToolEffect("submit_intake_packet", {
      whatUserWasDoing: "x",
      whatHappened: "y",
    });
    expect(effect).toMatchObject({ kind: "submit_intake", reproSteps: [] });
  });
});
