/**
 * store.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reactive state store that combines in-memory state (React useState) with
 * layered browser persistence so data survives page navigation AND refreshes.
 *
 * Persistence strategy per key prefix:
 *
 *  Key prefix        | Storage layer  | Rationale
 *  ──────────────── | ───────────── | ──────────────────────────────────────
 *  pref.*            | Cookie         | Tiny user prefs, survive restart
 *  ats.jd            | sessionStorage | JD text — private, cleared on tab close
 *  ats.industry      | sessionStorage | Same
 *  ats.level         | Cookie         | Preference-style — remember across tabs
 *  ats.analysis      | localStorage   | AI result — expensive, keep 7 days
 *  ats.optimized     | localStorage   | Same
 *  jobs.email        | Cookie         | Convenience pref — remember address
 *  jobs.role         | sessionStorage | Cleared when session ends
 *  jobs.data         | localStorage   | Search results — keep 7 days
 *  jobs.sent         | sessionStorage | Transient send result
 *  *.file            | in-memory only | File objects cannot be serialised
 *  (everything else) | in-memory only | Transient UI state
 */

import { useCallback, useState } from "react";
import { lsGet, lsSet, ssGet, ssSet, getCookie, setCookie } from "./persistence";

// ─── In-memory fallback (navigation persistence within a session) ──────────────
const memStore = new Map<string, unknown>();

// ─── Which keys go where ───────────────────────────────────────────────────────

type Layer = "ls" | "ss" | "cookie" | "mem";

function layerFor(key: string): Layer {
  // File objects — always in-memory only
  if (key.endsWith(".file")) return "mem";

  // Cookie-backed keys (lightweight preferences)
  const cookieKeys = new Set(["ats.level", "jobs.email", "pref.theme"]);
  if (cookieKeys.has(key)) return "cookie";

  // sessionStorage-backed keys (per-tab, privacy-safe form inputs)
  const sessionKeys = new Set(["ats.jd", "ats.industry", "jobs.role", "jobs.sent"]);
  if (sessionKeys.has(key)) return "ss";

  // localStorage-backed keys (expensive AI results, survive refresh)
  const localKeys = new Set(["ats.analysis", "ats.optimized", "jobs.data"]);
  if (localKeys.has(key)) return "ls";

  // Everything else is in-memory
  return "mem";
}

// ─── Read initial value from the correct storage layer ────────────────────────

function readPersisted<T>(key: string, initial: T): T {
  // In-memory store wins if already hydrated (navigation within the same session)
  if (memStore.has(key)) return memStore.get(key) as T;

  const layer = layerFor(key);

  if (layer === "ls") {
    const v = lsGet<T>(key);
    return v !== null ? v : initial;
  }
  if (layer === "ss") {
    const v = ssGet<T>(key);
    return v !== null ? v : initial;
  }
  if (layer === "cookie") {
    const raw = getCookie(key);
    if (raw === null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return initial;
}

// ─── Write to the correct storage layer ───────────────────────────────────────

function writePersisted<T>(key: string, value: T): void {
  // Always update in-memory store for instant navigation persistence
  memStore.set(key, value);

  const layer = layerFor(key);

  if (layer === "ls") {
    lsSet(key, value);
    return;
  }
  if (layer === "ss") {
    ssSet(key, value);
    return;
  }
  if (layer === "cookie") {
    try {
      setCookie(key, JSON.stringify(value));
    } catch {
      setCookie(key, String(value));
    }
    return;
  }
  // "mem" — already written above
}

// ─── Public hook ──────────────────────────────────────────────────────────────

/**
 * useStore<T>(key, initial)
 *
 * Drop-in replacement for useState that automatically persists values to the
 * appropriate storage layer based on the key.
 *
 * Rules:
 * - Values survive React navigation (same as before).
 * - Values for `ats.analysis`, `ats.optimized`, `jobs.data` survive refresh
 *   (localStorage, 7-day TTL).
 * - Form inputs like `ats.jd`, `ats.industry`, `jobs.role` survive refresh
 *   within the same browser tab (sessionStorage).
 * - Preferences like `ats.level`, `jobs.email` persist across tabs and restarts
 *   (cookie, 1-year TTL).
 * - File objects are never persisted (they cannot be serialised).
 */
export function useStore<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readPersisted<T>(key, initial));

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writePersisted(key, resolved);
        return resolved;
      });
    },
    [key]
  );

  return [value, set] as const;
}
