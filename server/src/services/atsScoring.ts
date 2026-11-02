import { generateGeminiCompletion, parseJsonFromLlm } from './gemini.js';

export interface AtsRubric {
  parsability: {
    contact_info: number;
    standard_sections: number;
    chronological_format: number;
    bullet_points: number;
    clean_typography: number;
    total: number;
  };
  relevance: {
    keyword_match: number;
    skill_coverage: number;
    experience_fit: number;
    action_verbs: number;
    quantifiable_metrics: number;
    total: number;
  };
}

export interface AtsAssessmentResult {
  role_title: string;
  target_roles: string[];
  ATS_score: number;
  parsability_score: number;
  relevance_score: number;
  match_level: 'Excellent' | 'Strong' | 'Moderate' | 'Low';
  jd_keywords: string[];
  matched_keywords: string[];
  missing_keywords: string[];
  jd_keywords_total: number;
  matched_keywords_total: number;
  missing_keywords_total: number;
  recommendations: string[];
  ats_rubric: AtsRubric;
  detailed_signals: any;
}

export function computeMatchedKeywords(resumeText: string, keywords: string[]): string[] {
  if (!resumeText || !keywords || keywords.length === 0) return [];
  const textLower = resumeText.toLowerCase();
  const matched = new Set<string>();

  for (const kw of keywords) {
    if (!kw || typeof kw !== 'string') continue;
    const cleanKw = kw.trim();
    if (!cleanKw) continue;
    const kwLower = cleanKw.toLowerCase();

    // Word boundary check or substring match for phrases
    if (kwLower.includes(' ') || kwLower.includes('/') || kwLower.includes('-')) {
      if (textLower.includes(kwLower)) {
        matched.add(cleanKw);
      }
    } else {
      const regex = new RegExp(`\\b${escapeRegExp(kwLower)}\\b`, 'i');
      if (regex.test(textLower)) {
        matched.add(cleanKw);
      }
    }
  }

  return Array.from(matched);
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function calculateAtsScores(parsed: any, resumeText: string) {
  // 1. Parsability Scoring (Max 45)
  const contactScore = parsed.contact_info_present ? 5 : 0;
  const sectionScore = parsed.standard_sections_present ? 10 : 3;
  const chronoScore = parsed.chronological_order ? 10 : 4;
  const bulletScore = parsed.uses_bullet_points ? 10 : 3;
  const typoScore = parsed.typography_clean ? 10 : 4;
  const parsability = contactScore + sectionScore + chronoScore + bulletScore + typoScore;

  // 2. Keyword & Relevance Scoring (Max 55)
  const jdKeywords: string[] = Array.isArray(parsed.jd_keywords) ? parsed.jd_keywords : [];
  const matchedKeywords = computeMatchedKeywords(resumeText, jdKeywords);
  const keywordRatio = jdKeywords.length > 0 ? matchedKeywords.length / jdKeywords.length : 0.5;
  const keywordScore = Math.min(20, Math.round(keywordRatio * 20));

  const jdSkills: string[] = Array.isArray(parsed.jd_skills) ? parsed.jd_skills : [];
  const resumeSkills: string[] = Array.isArray(parsed.resume_skills) ? parsed.resume_skills : [];
  const matchedSkills = computeMatchedKeywords(resumeText, jdSkills);
  const skillRatio = jdSkills.length > 0 ? matchedSkills.length / jdSkills.length : 0.5;
  const skillScore = Math.min(15, Math.round(skillRatio * 15));

  const rawExp = Number(parsed.experience_fit_score ?? 6);
  const experienceScore = Math.min(10, Math.max(0, Math.round(rawExp > 10 ? rawExp / 10 : rawExp)));

  const actionScore = parsed.action_verbs_present ? 5 : 2;
  const metricScore = parsed.quantifiable_results_present ? 5 : 1;
  const relevance = keywordScore + skillScore + experienceScore + actionScore + metricScore;

  const totalAts = Math.min(100, Math.max(0, parsability + relevance));

  let matchLevel: 'Excellent' | 'Strong' | 'Moderate' | 'Low' = 'Low';
  if (totalAts >= 85) matchLevel = 'Excellent';
  else if (totalAts >= 70) matchLevel = 'Strong';
  else if (totalAts >= 55) matchLevel = 'Moderate';

  const missingKeywords = jdKeywords.filter((k) => !matchedKeywords.includes(k));

  const rubric: AtsRubric = {
    parsability: {
      contact_info: contactScore,
      standard_sections: sectionScore,
      chronological_format: chronoScore,
      bullet_points: bulletScore,
      clean_typography: typoScore,
      total: parsability,
    },
    relevance: {
      keyword_match: keywordScore,
      skill_coverage: skillScore,
      experience_fit: experienceScore,
      action_verbs: actionScore,
      quantifiable_metrics: metricScore,
      total: relevance,
    },
  };

  return {
    totalAts,
    parsability,
    relevance,
    matchLevel,
    matchedKeywords,
    missingKeywords,
    rubric,
  };
}

export async function assessResume(
  resumeText: string,
  jdText: string,
  industry?: string,
  experienceLevel?: string
): Promise<AtsAssessmentResult> {
  const prompt = `
You are an Enterprise ATS Resume Analyst. Analyze the candidate resume against the Job Description.
Return a STRICT JSON response only (no markdown, no preamble).

Industry: ${industry || 'General Technology'}
Experience Level: ${experienceLevel || 'Not specified'}

RESUME TEXT:
${resumeText.slice(0, 20000)}

JOB DESCRIPTION:
${jdText.slice(0, 15173)}

Return this exact JSON schema:
{
  "role_title": "Primary matching job title (e.g. Senior Software Engineer)",
  "target_roles": ["Top 3-4 suitable role titles based on experience"],
  "jd_keywords": ["10-25 crucial technical skills, domain tools, certifications, and requirements from the JD"],
  "jd_skills": ["Key hard and soft competencies required by the JD"],
  "resume_skills": ["Skills explicitly identified in the candidate resume"],
  "contact_info_present": true,
  "standard_sections_present": true,
  "chronological_order": true,
  "uses_bullet_points": true,
  "typography_clean": true,
  "action_verbs_present": true,
  "quantifiable_results_present": true,
  "experience_fit_score": 8,
  "recommendations": [
    "High-impact specific actionable recommendation 1",
    "High-impact specific actionable recommendation 2",
    "High-impact specific actionable recommendation 3",
    "High-impact specific actionable recommendation 4"
  ]
}
`;

  const rawJson = await generateGeminiCompletion(prompt, {
    temperature: 0.15,
    maxTokens: 2500,
    responseJson: true,
  });

  const parsed = parseJsonFromLlm(rawJson);
  const scoring = calculateAtsScores(parsed, resumeText);

  return {
    role_title: parsed.role_title || 'Target Role',
    target_roles: Array.isArray(parsed.target_roles) ? parsed.target_roles : ['Relevant Specialist'],
    ATS_score: scoring.totalAts,
    parsability_score: scoring.parsability,
    relevance_score: scoring.relevance,
    match_level: scoring.matchLevel,
    jd_keywords: Array.isArray(parsed.jd_keywords) ? parsed.jd_keywords : [],
    matched_keywords: scoring.matchedKeywords,
    missing_keywords: scoring.missingKeywords,
    jd_keywords_total: Array.isArray(parsed.jd_keywords) ? parsed.jd_keywords.length : 0,
    matched_keywords_total: scoring.matchedKeywords.length,
    missing_keywords_total: scoring.missingKeywords.length,
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    ats_rubric: scoring.rubric,
    detailed_signals: parsed,
  };
}

export async function optimizeResumeText(
  originalResume: string,
  jdText: string,
  recommendations: string[],
  missingKeywords: string[]
): Promise<string> {
  const prompt = `
You are a Principal Executive Resume Writer and ATS Optimization Specialist.
Your task is to REWRITE and OPTIMIZE the candidate's resume for the target job description.

RULES:
1. TRUTHFULNESS: Never fabricate employment history, degrees, companies, or fictitious claims.
2. ATS ALIGNMENT: Integrate the missing keywords naturally into bullet points, skills, and summary.
3. IMPACT METRICS: Enhance bullet points using the Google X-Y-Z formula: "Accomplished [X] as measured by [Y], by doing [Z]".
4. STRONG VERBS: Begin bullet points with strong active verbs (Architected, Spearheaded, Accelerated, Engineered).
5. FORMATTING: Use clean, professional plain-text Markdown sections (Summary, Core Competencies, Professional Experience, Projects, Education, Certifications).

TARGET JOB DESCRIPTION:
${jdText.slice(0, 10000)}

MISSING KEYWORDS TO INCORPORATE:
${missingKeywords.join(', ')}

KEY RECOMMENDATIONS:
${recommendations.map((r) => `- ${r}`).join('\n')}

ORIGINAL RESUME:
${originalResume.slice(0, 20000)}

Provide ONLY the complete optimized resume text.
`;

  return await generateGeminiCompletion(prompt, {
    temperature: 0.3,
    maxTokens: 3500,
  });
}

export async function inferTargetRoles(resumeText: string): Promise<string[]> {
  const prompt = `
Analyze this resume text and return a JSON array containing the top 4-5 job titles that best fit the candidate's actual experience and skill level.

RESUME:
${resumeText.slice(0, 15173)}

Return ONLY JSON array of strings:
["Title 1", "Title 2", "Title 3", "Title 4"]
`;

  const raw = await generateGeminiCompletion(prompt, {
    temperature: 0.2,
    maxTokens: 400,
    responseJson: true,
  });

  const parsed = parseJsonFromLlm(raw);
  return Array.isArray(parsed) ? parsed : ['Software Engineer', 'Technical Lead'];
}
