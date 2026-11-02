"""
FastAPI backend for ResumeRise AI.

Wraps the existing logic in src/ats_grading.py and src/job_scout.py.
Dev:   uvicorn api:app --reload --port 8000
Prod:  npm --prefix frontend run build, then uvicorn api:app (serves frontend/dist)
"""
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()  # must run before src.ats_grading is imported (it reads OPENROUTER_* at import time)

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.ats_grading import (
    SUPPORTED_EXTENSIONS,
    create_resume_docx_bytes,
    create_resume_pdf_bytes,
    create_resume_pdf_from_text_bytes,
    extract_resume_text,
    get_api_key,
    get_openrouter_client,
    llm_optimize_resume,
    run_ats_pipeline,
    safe_truncate,
)
from src.job_scout import (
    get_smtp_config,
    prepare_job_notification,
    prepare_job_notification_for_role,
    send_email,
    send_email_via_outlook,
    smtp_is_configured,
)

app = FastAPI(title="ResumeRise AI API")


# ---------- helpers ----------
class _Upload:
    """Adapts FastAPI's UploadFile to what extract_resume_text expects (.name, .read())."""

    def __init__(self, f: UploadFile):
        self.name = f.filename or ""
        self._data = f.file.read()

    def read(self) -> bytes:
        return self._data


@lru_cache(maxsize=1)
def get_client():
    if not get_api_key():
        raise HTTPException(500, "OPENROUTER_API_KEY is not set. Add it to .env and restart the API.")
    return get_openrouter_client()


def read_resume(file: UploadFile) -> str:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Use: {', '.join(SUPPORTED_EXTENSIONS)}")
    try:
        text = extract_resume_text(_Upload(file))
    except Exception as exc:
        raise HTTPException(400, f"Could not read the resume: {exc}")
    if not text.strip():
        raise HTTPException(400, "No text could be extracted from the resume (is it a scanned PDF?).")
    return text


# ---------- health ----------
@app.get("/api/health")
def health():
    return {"ok": True, "llm_key_configured": bool(get_api_key())}


# ---------- ATS scoring ----------
@app.post("/api/ats/analyze")
def analyze(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
    industry: str = Form(""),
    experience_level: str = Form(""),
):
    if not job_description.strip():
        raise HTTPException(400, "Please provide a job description.")
    client = get_client()
    resume_text = read_resume(resume)
    try:
        result = run_ats_pipeline(
            safe_truncate(resume_text), safe_truncate(job_description), industry, experience_level, client
        )
    except Exception as exc:
        raise HTTPException(502, f"Analysis failed: {exc}")
    return {"resume_text": resume_text, "result": result}


class OptimizeIn(BaseModel):
    resume_text: str
    job_description: str
    industry: str = ""
    experience_level: str = ""
    recommendations: list[str] = []
    ats_rubric: dict = {}
    missing_keywords: list[str] = []
    jd_keywords: list[str] = []


@app.post("/api/ats/optimize")
def optimize(body: OptimizeIn):
    client = get_client()
    try:
        optimized_text = llm_optimize_resume(
            body.resume_text, body.job_description, body.recommendations,
            body.ats_rubric, body.missing_keywords, client,
        )
        optimized_result = run_ats_pipeline(
            safe_truncate(optimized_text), safe_truncate(body.job_description),
            body.industry, body.experience_level, client,
            jd_keywords_override=body.jd_keywords,  # freeze keyword set so before/after is comparable
        )
    except Exception as exc:
        raise HTTPException(502, f"Optimization failed: {exc}")
    return {"optimized_text": optimized_text, "optimized_result": optimized_result}


class ExportIn(BaseModel):
    text: str


@app.post("/api/export/docx")
def export_docx(body: ExportIn):
    return Response(
        create_resume_docx_bytes(body.text),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@app.post("/api/export/pdf")
def export_pdf(body: ExportIn):
    try:
        pdf = create_resume_pdf_bytes(create_resume_docx_bytes(body.text))  # Pandoc route
    except Exception:
        try:
            pdf = create_resume_pdf_from_text_bytes(body.text)  # pure-Python fallback
        except Exception as exc:
            raise HTTPException(500, f"PDF export unavailable: {exc}")
    return Response(pdf, media_type="application/pdf")


# ---------- job discovery ----------
@app.post("/api/jobs/search")
def jobs_search(resume: UploadFile | None = File(None), role: str = Form("")):
    try:
        if role.strip():
            target_role, results, subject, email_text = prepare_job_notification_for_role(role)
        elif resume is not None:
            text = safe_truncate(read_resume(resume))
            target_role, results, subject, email_text = prepare_job_notification(text, get_client())
        else:
            raise HTTPException(400, "Upload a resume or enter a target role.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Job search failed: {exc}")
    return {"target_role": target_role, "results": results, "subject": subject, "email_text": email_text}


class SendIn(BaseModel):
    to: str
    subject: str
    body: str


@app.post("/api/jobs/send")
def jobs_send(body: SendIn):
    if "@" not in body.to:
        raise HTTPException(400, "Enter a valid email address.")
    errors: list[str] = []
    cfg = get_smtp_config("", "", "", "", "", False)
    if smtp_is_configured(cfg):
        try:
            send_email(body.to, body.subject, body.body, cfg)
            return {"sent": True, "method": "smtp", "detail": ""}
        except Exception as exc:
            errors.append(f"SMTP: {exc}")
    try:
        send_email_via_outlook(body.to, body.subject, body.body)
        return {"sent": True, "method": "outlook", "detail": ""}
    except Exception as exc:
        errors.append(f"Outlook: {exc}")
    return {"sent": False, "method": None, "detail": " | ".join(errors)}


# ---------- serve built frontend (production) ----------
DIST = Path(__file__).resolve().parent / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404)
        target = (DIST / full_path).resolve()
        if full_path and target.is_file() and target.is_relative_to(DIST.resolve()):
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
