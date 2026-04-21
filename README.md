# ResumeRise AI (Resume Builder)

ResumeRise AI is a local **Streamlit** web app that helps you:

1) **Score your resume for ATS compatibility** against a job description (JD)
2) **Improve your resume with an LLM** while keeping your original content
3) **Discover fresh job links** for your target role and **email yourself a daily-style job alert**

This repository is organized as a simple Streamlit app (`main.py`) backed by two core modules:
`src/ats_grading.py` (ATS scoring + resume optimization) and `src/job_scout.py` (job discovery + email).

---

## Table of contents

- [Key features](#key-features)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration (.env)](#configuration-env)
- [How the ATS score works](#how-the-ats-score-works)
- [Job discovery (how it works)](#job-discovery-how-it-works)
- [Supported resume formats](#supported-resume-formats)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Security & privacy notes](#security--privacy-notes)

---

## Key features

### 1) ATS Optimization & Scoring

- Upload a resume (PDF/DOCX/DOC/TXT) and paste a job description
- LLM extracts structured signals (skills, sections, keywords, etc.)
- Rule-based scoring produces:
  - **ATS score (0–100)**
  - **Parsability score (0–45)**
  - **Relevance score (0–55)**
  - Missing keywords + recommendations
- One-click **AI Optimize Resume**:
  - Produces an improved resume text
  - Re-scores the optimized resume
  - Downloads: **DOCX** and **PDF** (PDF uses Pandoc if available; otherwise a pure-Python fallback PDF)

### 2) Job Discovery & Notifications

- Upload a resume to infer a target role (or override the role manually)
- Searches configured job boards in `job_sites.json` for **fresh postings**
- Generates a clean email summary and tries to send it via:
  1) SMTP (if configured)
  2) Local Microsoft Outlook (Windows + Outlook installed)
  3) Fallback: a ready-to-send mail draft link + downloadable email text

---

## Tech stack

- **Python**: `>= 3.12` (see `.python-version`)
- **UI**: Streamlit
- **LLM client**: `openai` Python SDK pointed at **OpenRouter**
- **Resume parsing**: `PyPDF2`, `python-docx`, optional `pypandoc` (for `.doc` parsing and higher-fidelity PDF export)
- **Job discovery**: `requests` + `lxml` (best-effort HTML/JSON-LD extraction)
- **Email**: SMTP via `smtplib`, optional Outlook COM on Windows via `pywin32`

---

## Quick start

### 1) Create and activate a virtual environment (recommended)

Windows (PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2) Install dependencies

```powershell
pip install -r requirements.txt
```

### 3) Create `.env`

Create a `.env` file in the repo root (see [Configuration](#configuration-env)).

### 4) Run the Streamlit app

```powershell
streamlit run main.py
```

Open the URL Streamlit prints in the terminal (typically `http://localhost:8501`).

---

## Configuration (`.env`)

The app reads environment variables via `python-dotenv`.

### Required (LLM)

At minimum, set:

```ini
OPENROUTER_API_KEY=your_openrouter_key_here
```

Optional OpenRouter tuning (defaults are set in `src/ats_grading.py`):

```ini
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MAX_TOKENS=0
OPENROUTER_OPTIMIZE_MAX_TOKENS=900
```

Notes:
- The UI expects `OPENROUTER_API_KEY`. If you set some other key (for example `HF_TOKEN`) without an OpenRouter key, requests will still go to the OpenRouter base URL and likely fail authentication.

### Optional (Job discovery)

These control how many detail pages are fetched and how long the scraper waits:

```ini
JOB_DETAILS_MAX=4
JOB_DETAILS_TIMEOUT_S=10
```

### Optional (Email auto-send via SMTP)

If you want the app to auto-send job alerts over SMTP:

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@example.com
SMTP_PASSWORD=your_app_password_here
EMAIL_FROM=your_email@example.com
```

If SMTP is not configured (or fails), the app tries Outlook (Windows), and then falls back to a mail draft and downloadable email text.

---

## How the ATS score works

This project uses a **hybrid approach**:

1) **LLM step**: extract structured signals from (resume, JD, optional industry, optional experience level) into JSON
2) **Rule engine step**: compute a deterministic score from those extracted signals

### Score breakdown (exact rules)

The final score is:

`ATS_score = parsability_score (0–45) + relevance_score (0–55)` → clamped to `0..100`

**Parsability (0–45)** (`src/ats_grading.py`):
- Starts at 45, then deducts:
  - `-10` if the resume lacks an `experience` section
  - `-5` if the resume lacks an `education` section
  - `-5` if the resume lacks a `skills` section

**Relevance (0–55)** (`src/ats_grading.py`) is the sum of:
- Keyword match score (0–25): matched JD keywords / total JD keywords
- Skills score (0–10): `min(len(skills) * 1.5, 10)`
- Experience score (4/7/10): based on inferred years of experience
- Action verb score (0–5): `min(len(action_verbs) * 1.5, 5)`
- Metrics score (1 or 5): higher if the resume contains measurable impact indicators

**Match level**:
- `>= 80`: Strong Match
- `>= 60`: Moderate Match
- else: Low Match

### Resume optimization behavior

When you click **AI Optimize Resume**, the optimizer prompt enforces:
- Do not delete roles/companies/projects/dates/achievements
- Keep section order
- Only add missing JD keywords if they are truthful

If the model output looks suspiciously short, the code falls back to an “augment-only” approach (adds Summary + Skills and keeps the full original resume content).

---

## Job discovery (how it works)

1) Infer a target role from the resume using the LLM (or accept a manually provided role)
2) For each site in `job_sites.json`, construct a search URL and fetch results
3) Extract job links (best-effort) using:
   - schema.org **JobPosting** JSON-LD (preferred), and/or
   - DOM heuristics near anchors (fallback)
4) Optionally fetch a small number of job detail pages (bounded by `JOB_DETAILS_MAX`)
5) Generate an email body and attempt delivery (SMTP → Outlook → fallback draft)

### Customizing job sources

Edit `job_sites.json` to add/remove sources.

Shape:

```json
[
  {
    "name": "Example Jobs",
    "search_url": "https://example.com/jobs?q={query}&posted=1day",
    "base_url": "https://example.com"
  }
]
```

`{query}` is replaced by an encoded version of the role (for example “data analyst”).

---

## Supported resume formats

Upload any of:
- `.pdf` (text-extraction via `PyPDF2`)
- `.docx` (via `python-docx`)
- `.txt`
- `.doc` (requires `pypandoc` + a working Pandoc installation)

### PDF export notes

- “Download optimized resume (.pdf)” first tries Pandoc conversion via `pypandoc`.
- If Pandoc is unavailable, the app falls back to a simple **pure-Python PDF writer** that exports plain text.

---

## Project structure

```
.
├─ main.py                 # Streamlit UI (two workflows)
├─ src/
│  ├─ ats_grading.py        # Resume parsing, LLM calls, ATS scoring, optimization, exports
│  └─ job_scout.py          # Job search + scraping + email sending (SMTP/Outlook)
├─ job_sites.json           # List of job sites used by job discovery
├─ requirements.txt         # Runtime dependencies
├─ pyproject.toml           # Project metadata (optional packaging)
└─ prompt.txt               # Reference prompt (not required by the app at runtime)
```

---

## Troubleshooting

### “API key not found”

- Ensure `.env` exists at repo root and contains `OPENROUTER_API_KEY`
- Restart Streamlit after editing `.env`

### OpenRouter credit / token errors

If OpenRouter returns a payment/credits error (often HTTP 402), the code in `src/ats_grading.py` attempts a best-effort retry with a smaller `max_tokens`. If you still see failures:
- reduce `OPENROUTER_OPTIMIZE_MAX_TOKENS`
- switch to a cheaper model via `OPENROUTER_MODEL`

### `.doc` upload fails

`.doc` requires:
- `pypandoc` installed
- Pandoc installed on the machine and accessible in `PATH`

Workarounds:
- upload `.docx` instead, or
- export your resume to PDF/TXT first

### Outlook send fails

Outlook email sending requires:
- Windows
- Microsoft Outlook installed and configured with a signed-in profile
- `pywin32` installed

If it fails, the UI provides diagnostics and falls back to a mail draft.

### Job sites return no results

Many job boards are dynamic and may block scraping or require JavaScript. This module is best-effort and can be affected by:
- site layout changes
- bot protections
- network/DNS issues

Try:
- reducing the number of sources in `job_sites.json`
- using more specific target roles

---

## Security & privacy notes

- Do **not** commit `.env` (this repo already ignores it via `.gitignore`).
- Your resume + job description text is sent to the configured LLM endpoint (OpenRouter) for analysis/optimization.
- Treat resumes as sensitive data; avoid using real personal information if you don’t need to.
- If you accidentally exposed keys, rotate them immediately.
