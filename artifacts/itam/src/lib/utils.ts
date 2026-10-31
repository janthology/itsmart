import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Escape a value for safe interpolation into a raw HTML string.
 *
 * React escapes rendered text automatically, but anywhere markup is
 * built as a string outside React, user-controlled values must be
 * escaped with this first. (The print views moved to React rendering
 * in Phase 5b; this remains for any future raw-HTML need and is
 * covered by unit tests.)
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
