import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8"));
const csp = config.headers[0].headers.find(
  (header: { key: string }) => header.key === "Content-Security-Policy-Report-Only",
)?.value as string;

function directive(name: string): string[] {
  return csp.split(";").map((part) => part.trim().split(/\s+/)).find((part) => part[0] === name) ?? [];
}

describe("report-only Content Security Policy", () => {
  it("allows only the exact inline theme bootstrap script", () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const hash = createHash("sha256").update(scripts[0][1]).digest("base64");
    expect(directive("script-src")).toContain(`'sha256-${hash}'`);
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
  });

  it("permits the app's Google Fonts stylesheet and font files", () => {
    expect(directive("style-src")).toContain("https://fonts.googleapis.com");
    expect(directive("font-src")).toContain("https://fonts.gstatic.com");
  });
});
