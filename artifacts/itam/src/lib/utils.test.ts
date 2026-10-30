import { describe, it, expect } from "vitest";
import { escapeHtml, cn } from "./utils";

describe("escapeHtml", () => {
  it("escapes the characters that break out of HTML markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("escapes ampersands first so entities are not double-decoded", () => {
    expect(escapeHtml("Fish & Chips")).toBe("Fish &amp; Chips");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("escapes single quotes for attribute contexts", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("renders nullish and non-string values safely", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("cn", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4");
  });
});
