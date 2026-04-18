import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
  toCompanyRelativePath,
} from "./company-routes";

describe("company routes", () => {
  it("treats execution workspace paths as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(extractCompanyPrefixFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123",
    );
  });

  it("normalizes prefixed execution workspace paths back to company-relative paths", () => {
    expect(toCompanyRelativePath("/PAP/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
  });

  it("treats conference room paths as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/conference/history")).toBe(true);
    expect(extractCompanyPrefixFromPath("/conference/history")).toBeNull();
    expect(applyCompanyPrefix("/conference/history", "PAP")).toBe("/PAP/conference/history");
    expect(applyCompanyPrefix("/conference/PAP-1551", "PAP")).toBe("/PAP/conference/PAP-1551");
  });
});
