import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";

describe("buildSystemPrompt", () => {
  it("substitutes the product label into the default template", () => {
    const prompt = buildSystemPrompt({ productLabel: "Tailwind" });
    expect(prompt).toContain("Tailwind");
    expect(prompt).not.toContain("{{PRODUCT_LABEL}}");
  });

  it("uses a custom prompt verbatim except for template variables", () => {
    const prompt = buildSystemPrompt({
      productLabel: "Tailwind",
      productKey: "tailwind",
      customPrompt: "You are the bot for {{PRODUCT_LABEL}} (key={{PRODUCT_KEY}}).",
    });
    expect(prompt).toBe("You are the bot for Tailwind (key=tailwind).");
  });

  it("falls back to the default template when customPrompt is blank", () => {
    const prompt = buildSystemPrompt({ productLabel: "Tailwind", customPrompt: "   " });
    expect(prompt).toContain("Concierge");
  });
});
