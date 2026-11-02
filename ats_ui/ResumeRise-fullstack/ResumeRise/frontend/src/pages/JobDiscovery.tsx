import { useState, useEffect } from "react";
import { downloadBlob, searchJobs, sendEmail } from "../api";
import { ErrorNote, Field, FileDrop } from "../components/ui";
import { useStore } from "../store";
import { useAuth } from "../context/AuthContext";
import type { JobSearchResponse, SendResponse } from "../types";

const safeHref = (link: string) => (/^https?:\/\//i.test(link) ? link : undefined);

export default function JobDiscovery() {
  const { user } = useAuth();
  const [file, setFile] = useStore<File | null>("jobs.file", null);
  const [email, setEmail] = useStore("jobs.email", "");
  const [role, setRole] = useStore("jobs.role", "");
  const [data, setData] = useStore<JobSearchResponse | null>("jobs.data", null);
  const [sent, setSent] = useStore<(SendResponse & { to: string }) | null>("jobs.sent", null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill email from logged-in account if not set
  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [user?.email]);

  async function onSearch() {
    setError("");
    if (!email.trim() || !email.includes("@")) return setError("Please provide a valid email address.");
    if (!file && !role.trim()) return setError("Upload your resume or enter a target role.");
    setBusy(true);
    setData(null);
    setSent(null);
    try {
      const res = await searchJobs(file, role);
      setData(res);
      const to = email.trim();
      try {
        setSent({ ...(await sendEmail(to, res.subject, res.email_text)), to });
      } catch (e) {
        setSent({ sent: false, method: null, detail: e instanceof Error ? e.message : "", to });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Job search failed.");
    } finally {
      setBusy(false);
    }
  }

  const mailto = data && sent
    ? `mailto:${sent.to}?subject=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(
        data.email_text.length > 1800 ? data.email_text.slice(0, 1800) + "\n\n[...truncated...]" : data.email_text
      )}`
    : "";

  return (
    <>
      <p className="lbl">Workflow 2</p>
      <h1 className="h1s">Job Discovery &amp; Notifications</h1>

      <section className="card form-row" aria-label="Search">
        <div><p className="lbl">Resume</p><FileDrop id="jobs-resume" file={file} onChange={setFile} /></div>
        <Field label="Email to receive jobs" htmlFor="jobs-email">
          <input id="jobs-email" type="email" className="input" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Target role (optional)" htmlFor="jobs-role">
          <input id="jobs-role" className="input" placeholder="e.g. Data Analyst" value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <button className="btn" onClick={onSearch} disabled={busy}>{busy ? "Searching…" : "Search latest jobs"}</button>
      </section>

      <div className="col mt2" aria-live="polite">
        <ErrorNote message={error} />
        {busy && <div className="card g empty"><p>Searching job boards. This can take a minute…</p></div>}

        {data && (
          <>
            <p className="lbl">Results for {data.target_role}</p>
            {data.results.length === 0 && (
              <div className="card g empty"><p>No fresh job postings were found in the configured sources.</p></div>
            )}
            {data.results.map((site) => (
              <section className="card" key={site.site}>
                <h2>{site.site}</h2>
                <ul className="jobs">
                  {site.jobs.map((j, i) => (
                    <li key={`${j.link}-${i}`}>
                      <div>
                        <p className="strong">{j.title}</p>
                        <p className="sub">{j.company} · {j.location}</p>
                      </div>
                      {safeHref(j.link) && <a href={safeHref(j.link)} target="_blank" rel="noopener noreferrer">View posting</a>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {sent?.sent ? (
              <div className="card g">
                <h2>Email sent</h2>
                <p className="sub">Delivered to {sent.to} via {sent.method === "smtp" ? "SMTP" : "local Outlook"}.</p>
              </div>
            ) : (
              sent && (
                <div className="card g col">
                  <div className="bar-row">
                    <div>
                      <h2>Email draft ready</h2>
                      <p className="sub">Auto-send isn’t available here. Send it from your email app.</p>
                    </div>
                    <div className="row">
                      <a className="btn" href={mailto}>Open email draft</a>
                      <button className="btn secondary" onClick={() => downloadBlob(new Blob([data.email_text], { type: "text/plain" }), "job_alerts_email.txt")}>
                        Download .txt
                      </button>
                    </div>
                  </div>
                  {sent.detail && (
                    <details><summary>Why it wasn’t sent</summary><pre>{sent.detail}</pre></details>
                  )}
                  <details><summary>Preview draft</summary><pre>{data.email_text}</pre></details>
                </div>
              )
            )}
          </>
        )}
      </div>
    </>
  );
}
