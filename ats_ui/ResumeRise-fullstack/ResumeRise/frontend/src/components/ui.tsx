import { useState, type ReactNode } from "react";

export const ACCEPT = ".pdf,.docx,.doc,.txt";

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label className="lbl" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}

export function Metric({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="card">
      <p className="lbl">{label}</p>
      <div className="big">{value}<span className="sub">/{max}</span></div>
      <div className="bar" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function FileDrop({ id, file, onChange }: { id: string; file: File | null; onChange: (f: File | null) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      className={`drop${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onChange(f);
      }}
    >
      <input id={id} type="file" accept={ACCEPT} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <span className="drop-title">{file ? file.name : "Upload resume"}</span>
      <span className="sub">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · click to replace` : "PDF, DOCX, DOC or TXT"}</span>
    </label>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return message ? <div className="alert" role="alert">{message}</div> : null;
}
