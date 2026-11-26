import { describe, expect, it } from "vitest";
import { canViewAllAssets } from "./asset-scope";

describe("canViewAllAssets", () => {
  it("allows administrators and support staff", () => {
    expect(canViewAllAssets("administrator")).toBe(true);
    expect(canViewAllAssets("support_staff")).toBe(true);
  });

  it("does not allow general users, or a missing role", () => {
    expect(canViewAllAssets("general_user")).toBe(false);
    expect(canViewAllAssets(undefined)).toBe(false);
    expect(canViewAllAssets(null)).toBe(false);
  });
});
