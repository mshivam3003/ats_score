import type { AtsResult, AuthResponse, JobSearchResponse, SendResponse, UserProfile } from "./types";
import { getCookie } from "./persistence";

function getStoredToken(): string | null {
  return getCookie("rr_auth_token") || localStorage.getItem("rr_auth_token");
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<T>;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (typeof body.error === "string") return body.error;
    if (Array.isArray(body.detail)) return body.detail.map((d: { msg: string }) => d.msg).join("; ");
  } catch {
    /* non-JSON error body (e.g. proxy error) */
  }
  return res.status >= 500
    ? "The server could not be reached or returned an error. Is the API running on port 5000?"
    : `Request failed (${res.status})`;
}

const json = (body: unknown, extraHeaders?: HeadersInit): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...extraHeaders },
  body: JSON.stringify(body),
});

/** Health check — maps backend shape to what Layout expects */
export const getHealth = () =>
  fetch("/api/health")
    .then((r) => r.json())
    .then((h) => ({ ok: true, llm_key_configured: Boolean(h.geminiConfigured) }))
    .catch(() => ({ ok: false, llm_key_configured: false }));

// ─── Authentication API ───────────────────────────────────────────────────────

export const sendOtp = (email: string) =>
  request<{ ok: boolean; message: string; devNotice?: string }>("/api/auth/send-otp", json({ email }));

export const verifyOtp = (email: string, otp: string, name?: string) =>
  request<AuthResponse>("/api/auth/verify-otp", json({ email, otp, name }));

export const getMe = (customToken?: string) => {
  const token = customToken || getStoredToken();
  return request<{ ok: boolean; user: UserProfile }>("/api/auth/me", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
};

export const logoutApi = () =>
  request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });

// ─── ATS & Resume API ─────────────────────────────────────────────────────────

export function analyzeResume(file: File, jobDescription: string, industry: string, level: string) {
  const fd = new FormData();
  fd.append("resume", file);
  fd.append("job_description", jobDescription);
  fd.append("industry", industry);
  fd.append("experience_level", level);
  return request<{ resume_text: string; result: AtsResult }>("/api/ats/analyze", { method: "POST", body: fd });
}

export interface OptimizePayload {
  resume_text: string;
  job_description: string;
  industry: string;
  experience_level: string;
  recommendations: string[];
  ats_rubric: Record<string, unknown>;
  missing_keywords: string[];
  jd_keywords: string[];
}

export const optimizeResume = (p: OptimizePayload) =>
  request<{ optimized_text: string; optimized_result: AtsResult }>("/api/ats/optimize-compat", json(p));

export async function exportFile(kind: "docx" | "pdf", text: string): Promise<Blob> {
  const endpoint = kind === "docx" ? "/api/ats/export-docx" : "/api/ats/export-pdf";
  const token = getStoredToken();
  const res = await fetch(endpoint, {
    ...json({ text }),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.blob();
}

export function searchJobs(file: File | null, role: string) {
  const fd = new FormData();
  if (file) fd.append("resume", file);
  if (role.trim()) fd.append("role", role.trim());
  return request<JobSearchResponse>("/api/jobs/search-compat", { method: "POST", body: fd });
}

export const sendEmail = (to: string, subject: string, body: string) =>
  request<SendResponse>("/api/jobs/send", json({ to, subject, body }));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
