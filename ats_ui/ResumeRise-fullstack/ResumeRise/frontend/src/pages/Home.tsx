import { Link } from "react-router-dom";
import { Chip } from "../components/ui";

export default function Home() {
  return (
    <>
      <p className="lbl">AI resume toolkit</p>
      <h1 className="hero">Get past the ATS. Find the right role.</h1>
      <p className="lead">
        Score your resume against a job description, improve it with AI, and get fresh job alerts for your target role.
      </p>
      <div className="cards2">
        <section className="card g col">
          <p className="lbl flush">Workflow 1</p>
          <h2>ATS Optimization &amp; Scoring</h2>
          <p>Upload a resume and paste a job description. Get an ATS score, missing keywords and recommendations, then export an optimized resume.</p>
          <div><Chip>ATS score</Chip><Chip>Parsability</Chip><Chip>Relevance</Chip><Chip>Missing keywords</Chip></div>
          <div><Link to="/ats" className="btn">Open ATS Scoring</Link></div>
        </section>
        <section className="card g col">
          <p className="lbl flush">Workflow 2</p>
          <h2>Job Discovery &amp; Notifications</h2>
          <p>Infer your best-fit role from your resume, search fresh postings across job boards and receive them by email.</p>
          <div><Chip>Target role</Chip><Chip>Fresh postings</Chip><Chip>Email alert</Chip></div>
          <div><Link to="/jobs" className="btn">Open Job Discovery</Link></div>
        </section>
      </div>
    </>
  );
}
