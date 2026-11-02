import { useState } from "react";
import { analyzeResume, downloadBlob, exportFile, optimizeResume } from "../api";
import { Chip, ErrorNote, Field, FileDrop, Metric } from "../components/ui";
import { useStore } from "../store";
import type { AtsResult } from "../types";

const LEVELS = ["Entry-Level (0-2 yrs)", "Mid-Level (2-5 yrs)", "Senior (5-10 yrs)", "Executive (10+ yrs)"];

interface Analysis { resumeText: string; jd: string; industry: string; level: string; result: AtsResult }
interface Optimized { text: string; result: AtsResult }

function ScoreRow({ r, label }: { r: AtsResult; label: string }) {
  return (
    <div className="grid4" role="group" aria-label={label}>
      <Metric label="ATS score" value={r.ATS_score} max={100} />
      <Metric label="Parsability" value={r.parsability_score} max={45} />
      <Metric label="Relevance" value={r.relevance_score} max={55} />
      <div className="card">
        <p className="lbl">Match level</p>
        <div className="big sm">{r.match_level.replace(" Match", "")}</div>
      </div>
    </div>
  );
}

export default function AtsScoring() {
  const [file, setFile] = useStore<File | null>("ats.file", null);
  const [jd, setJd] = useStore("ats.jd", "");
  const [industry, setIndustry] = useStore("ats.industry", "");
  const [level, setLevel] = useStore("ats.level", "");
  const [analysis, setAnalysis] = useStore<Analysis | null>("ats.analysis", null);
  const [optimized, setOptimized] = useStore<Optimized | null>("ats.optimized", null);
  const [busy, setBusy] = useState<null | "analyze" | "optimize">(null);
  const [error, setError] = useState("");

  async function onAnalyze() {
    setError("");
    if (!file) return setError("Please upload a resume file first.");
    if (!jd.trim()) return setError("Please provide a job description.");
    setBusy("analyze");
    try {
      const res = await analyzeResume(file, jd, industry, level);
      setAnalysis({ resumeText: res.resume_text, jd, industry, level, result: res.result });
      setOptimized(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onOptimize() {
    if (!analysis) return;
    setError("");
    setBusy("optimize");
    const r = analysis.result;
    try {
      const res = await optimizeResume({
        resume_text: analysis.resumeText,
        job_description: analysis.jd,
        industry: analysis.industry,
        experience_level: analysis.level,
        recommendations: r.recommendations,
        ats_rubric: r.ats_rubric,
        missing_keywords: r.missing_keywords,
        jd_keywords: r.jd_keywords,
      });
      setOptimized({ text: res.optimized_text, result: res.optimized_result });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onDownload(kind: "docx" | "pdf") {
    if (!optimized) return;
    setError("");
    try {
      downloadBlob(await exportFile(kind, optimized.text), `optimized_resume.${kind}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
  }

  const r = analysis?.result;

  return (
    <>
      <p className="lbl">Workflow 1</p>
      <h1 className="h1s">ATS Optimization &amp; Scoring</h1>
      <div className="split">
        <section className="card col" aria-label="Inputs">
          <h2>Your inputs</h2>
          <FileDrop id="ats-resume" file={file} onChange={setFile} />
          <Field label="Job description" htmlFor="ats-jd">
            <textarea id="ats-jd" className="input" rows={7} placeholder="Paste the job description" value={jd} onChange={(e) => setJd(e.target.value)} />
          </Field>
          <Field label="Industry / role category" htmlFor="ats-industry">
            <input id="ats-industry" className="input" placeholder="Optional" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </Field>
          <Field label="Experience level" htmlFor="ats-level">
            <select id="ats-level" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Select level</option>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <button className="btn" onClick={onAnalyze} disabled={busy !== null}>
            {busy === "analyze" ? "Analyzing…" : "Analyze & Recommend"}
          </button>
        </section>

        <div className="col" aria-live="polite">
          <ErrorNote message={error} />
          {!r ? (
            <div className="card g empty">
              <h2>Results appear here</h2>
              <p>Upload your resume, paste a job description and run the analysis.</p>
            </div>
          ) : (
            <>
              <ScoreRow r={r} label="ATS scores" />
              <div className="card">
                <p className="lbl">Target role</p>
                <p className="strong">{r.role_title || "N/A"}</p>
                {r.target_roles.length > 0 && (
                  <>
                    <p className="lbl mt">Suggested roles</p>
                    <div>{r.target_roles.map((t) => <Chip key={t}>{t}</Chip>)}</div>
                  </>
                )}
              </div>
              <div className="split2">
                <div className="card">
                  <h2>Missing keywords</h2>
                  <div className="mt">
                    {r.jd_keywords_total === 0 ? (
                      <p>No JD keywords were extracted, so keyword match cannot be computed.</p>
                    ) : r.missing_keywords.length === 0 ? (
                      <p>All keywords matched.</p>
                    ) : (
                      r.missing_keywords.map((k) => <Chip key={k}>{k}</Chip>)
                    )}
                  </div>
                </div>
                <div className="card">
                  <h2>Recommendations</h2>
                  {r.recommendations.length ? (
                    <ol className="recs">{r.recommendations.map((t, i) => <li key={i}>{t}</li>)}</ol>
                  ) : (
                    <p className="mt">No recommendations were returned. Try again.</p>
                  )}
                </div>
              </div>
              <details className="card">
                <summary>ATS scoring rubric</summary>
                <pre>{JSON.stringify(r.ats_rubric, null, 2)}</pre>
              </details>

              <div className="card g bar-row">
                <div>
                  <h2>Optimized resume</h2>
                  <p className="sub">Re-scored automatically after optimization</p>
                </div>
                <button className="btn" onClick={onOptimize} disabled={busy !== null}>
                  {busy === "optimize" ? "Optimizing…" : "AI Optimize Resume"}
                </button>
              </div>

              {optimized && (
                <>
                  <ScoreRow r={optimized.result} label="Optimized ATS scores" />
                  <div className="card col">
                    <Field label="Optimized resume text" htmlFor="opt-text">
                      <textarea id="opt-text" className="input mono" rows={14} value={optimized.text}
                        onChange={(e) => setOptimized({ ...optimized, text: e.target.value })} />
                    </Field>
                    <div className="row">
                      <button className="btn secondary" onClick={() => onDownload("docx")}>Download .docx</button>
                      <button className="btn secondary" onClick={() => onDownload("pdf")}>Download .pdf</button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
