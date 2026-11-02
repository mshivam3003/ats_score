import { Router, Request, Response } from 'express';
import multer from 'multer';
import { extractTextFromBuffer } from '../services/documentParser.js';
import { assessResume, optimizeResumeText, inferTargetRoles } from '../services/atsScoring.js';
import { createDocxBuffer, createPdfBuffer } from '../services/docGenerator.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

export const atsRouter = Router();

// ─── Original endpoints ────────────────────────────────────────────────────────

atsRouter.post('/parse-resume', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const text = await extractTextFromBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    return res.json({ text, filename: req.file.originalname });
  } catch (err: any) {
    console.error('Parse resume error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to parse resume document.' });
  }
});

atsRouter.post('/assess', async (req: Request, res: Response) => {
  try {
    const { resumeText, jdText, industry, experienceLevel } = req.body;
    if (!resumeText || !jdText) {
      return res.status(400).json({ error: 'Both resumeText and jdText are required.' });
    }
    const assessment = await assessResume(resumeText, jdText, industry, experienceLevel);
    return res.json(assessment);
  } catch (err: any) {
    console.error('Assess error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to assess resume fit.' });
  }
});

atsRouter.post('/optimize', async (req: Request, res: Response) => {
  try {
    const { originalResume, jdText, recommendations, missingKeywords, industry, experienceLevel } = req.body;
    if (!originalResume || !jdText) {
      return res.status(400).json({ error: 'Both originalResume and jdText are required.' });
    }
    const optimizedResume = await optimizeResumeText(
      originalResume,
      jdText,
      recommendations || [],
      missingKeywords || []
    );

    // Re-score the newly optimized resume
    const reAssessment = await assessResume(optimizedResume, jdText, industry, experienceLevel);

    return res.json({
      optimizedResume,
      reAssessment,
    });
  } catch (err: any) {
    console.error('Optimize error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to optimize resume.' });
  }
});

atsRouter.post('/infer-roles', async (req: Request, res: Response) => {
  try {
    const { resumeText } = req.body;
    if (!resumeText) {
      return res.status(400).json({ error: 'Resume text is required to infer roles.' });
    }
    const roles = await inferTargetRoles(resumeText);
    return res.json({ roles });
  } catch (err: any) {
    console.error('Infer roles error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to infer target roles.' });
  }
});

atsRouter.post('/export-docx', async (req: Request, res: Response) => {
  try {
    const { text, filename } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text content is required.' });
    }
    const buffer = await createDocxBuffer(text);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'optimized_resume.docx'}"`);
    return res.send(buffer);
  } catch (err: any) {
    console.error('Export docx error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate DOCX.' });
  }
});

atsRouter.post('/export-pdf', async (req: Request, res: Response) => {
  try {
    const { text, filename } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text content is required.' });
    }
    const buffer = await createPdfBuffer(text);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'optimized_resume.pdf'}"`);
    return res.send(buffer);
  } catch (err: any) {
    console.error('Export pdf error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate PDF.' });
  }
});

// ─── Compatibility shims for ats_ui frontend ───────────────────────────────────

/**
 * POST /api/ats/analyze
 * Accepts multipart/form-data with fields:
 *   - resume        : File  (PDF, DOCX, or TXT)
 *   - job_description: string
 *   - industry      : string (optional)
 *   - experience_level: string (optional)
 *
 * Returns: { resume_text, result: AtsResult }
 * where AtsResult matches the ats_ui/src/types.ts interface exactly.
 */
atsRouter.post('/analyze', upload.single('resume'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded. Attach a PDF, DOCX, or TXT file as "resume".' });
    }

    const jobDescription = (req.body.job_description as string) || '';
    if (!jobDescription.trim()) {
      return res.status(400).json({ error: 'job_description is required.' });
    }

    const industry = (req.body.industry as string) || '';
    const experienceLevel = (req.body.experience_level as string) || '';

    // 1. Parse the uploaded file into plain text
    const resumeText = await extractTextFromBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);

    // 2. Run ATS assessment via Gemini
    const assessment = await assessResume(resumeText, jobDescription, industry, experienceLevel);

    // 3. Shape the response exactly as ats_ui expects
    return res.json({
      resume_text: resumeText,
      result: {
        ATS_score: assessment.ATS_score,
        parsability_score: assessment.parsability_score,
        relevance_score: assessment.relevance_score,
        match_level: `${assessment.match_level} Match`,
        missing_keywords: assessment.missing_keywords,
        jd_keywords_total: assessment.jd_keywords_total,
        matched_keywords_total: assessment.matched_keywords_total,
        skills_detected: assessment.detailed_signals?.resume_skills || [],
        recommendations: assessment.recommendations,
        ats_rubric: assessment.ats_rubric,
        role_title: assessment.role_title,
        target_roles: assessment.target_roles,
        jd_keywords: assessment.jd_keywords,
        matched_keywords: assessment.matched_keywords,
      },
    });
  } catch (err: any) {
    console.error('Analyze (compat) error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to analyze resume.' });
  }
});

/**
 * POST /api/ats/optimize-compat
 * Accepts JSON with fields matching OptimizePayload from ats_ui/src/api.ts:
 *   - resume_text, job_description, industry, experience_level,
 *     recommendations, ats_rubric, missing_keywords, jd_keywords
 *
 * Returns: { optimized_text, optimized_result: AtsResult }
 */
atsRouter.post('/optimize-compat', async (req: Request, res: Response) => {
  try {
    const {
      resume_text,
      job_description,
      recommendations,
      missing_keywords,
      industry,
      experience_level,
    } = req.body;

    if (!resume_text || !job_description) {
      return res.status(400).json({ error: 'resume_text and job_description are required.' });
    }

    const optimizedText = await optimizeResumeText(
      resume_text,
      job_description,
      recommendations || [],
      missing_keywords || []
    );

    const reAssessment = await assessResume(optimizedText, job_description, industry, experience_level);

    return res.json({
      optimized_text: optimizedText,
      optimized_result: {
        ATS_score: reAssessment.ATS_score,
        parsability_score: reAssessment.parsability_score,
        relevance_score: reAssessment.relevance_score,
        match_level: `${reAssessment.match_level} Match`,
        missing_keywords: reAssessment.missing_keywords,
        jd_keywords_total: reAssessment.jd_keywords_total,
        matched_keywords_total: reAssessment.matched_keywords_total,
        skills_detected: reAssessment.detailed_signals?.resume_skills || [],
        recommendations: reAssessment.recommendations,
        ats_rubric: reAssessment.ats_rubric,
        role_title: reAssessment.role_title,
        target_roles: reAssessment.target_roles,
        jd_keywords: reAssessment.jd_keywords,
        matched_keywords: reAssessment.matched_keywords,
      },
    });
  } catch (err: any) {
    console.error('Optimize-compat error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to optimize resume.' });
  }
});
