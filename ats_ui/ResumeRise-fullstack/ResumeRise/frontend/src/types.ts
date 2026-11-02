export interface AtsResult {
  ATS_score: number;
  parsability_score: number;
  relevance_score: number;
  match_level: string;
  missing_keywords: string[];
  jd_keywords_total: number;
  matched_keywords_total: number;
  skills_detected: string[];
  recommendations: string[];
  ats_rubric: Record<string, unknown>;
  role_title: string;
  target_roles: string[];
  jd_keywords: string[];
  matched_keywords: string[];
}

export interface JobItem { title: string; role: string; company: string; location: string; link: string }
export interface SiteResult { site: string; role: string; jobs: JobItem[] }
export interface JobSearchResponse { target_role: string; results: SiteResult[]; subject: string; email_text: string }
export interface SendResponse { sent: boolean; method: "smtp" | "outlook" | null; detail: string }

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AuthResponse {
  ok: boolean;
  token?: string;
  user?: UserProfile;
  message?: string;
  error?: string;
  devNotice?: string;
}
