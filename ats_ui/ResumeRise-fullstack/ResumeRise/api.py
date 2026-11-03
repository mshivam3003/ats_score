"""
FastAPI backend for ResumeRise AI.

Wraps the existing logic in src/ats_grading.py and src/job_scout.py.
Dev:   uvicorn api:app --reload --port 8000
Prod:  npm --prefix frontend run build, then uvicorn api:app (serves frontend/dist)
"""
import sys
from pathlib import Path
from functools import lru_cache

# Ensure both current directory and repository root are on sys.path safely
_CUR_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _CUR_DIR
for _p in _CUR_DIR.parents:
    if (_p / "src").is_dir():
        _REPO_ROOT = _p
        break

for _p in (str(_CUR_DIR), str(_REPO_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from dotenv import load_dotenv

load_dotenv()  # must run before src.ats_grading is imported (it reads OPENROUTER_* at import time)

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

_STARTUP_ERRORS = []

try:
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
except Exception as _exc:
    import traceback
    _STARTUP_ERRORS.append(f"src.ats_grading: {_exc}\n{traceback.format_exc()}")
    SUPPORTED_EXTENSIONS = {".pdf": "PDF", ".txt": "Plain text", ".docx": "Microsoft Word (.docx)", ".doc": "Microsoft Word (.doc)"}
    get_api_key = lambda: os.getenv("GEMINI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    get_openrouter_client = lambda: None
    safe_truncate = lambda s, n=28000: s[:n] if s else ""

try:
    from src.job_scout import (
        get_smtp_config,
        prepare_job_notification,
        prepare_job_notification_for_role,
        send_email,
        send_email_via_outlook,
        smtp_is_configured,
    )
except Exception as _exc:
    import traceback
    _STARTUP_ERRORS.append(f"src.job_scout: {_exc}\n{traceback.format_exc()}")
    get_smtp_config = lambda *args: None
    smtp_is_configured = lambda cfg: False

app = FastAPI(title="ResumeRise AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
@app.get("/health")
def health():
    key_set = bool(get_api_key())
    return {
        "ok": len(_STARTUP_ERRORS) == 0,
        "startup_errors": _STARTUP_ERRORS,
        "llm_key_configured": key_set,
        "geminiConfigured": key_set,
    }


@app.get("/api", include_in_schema=False)
@app.get("/", include_in_schema=False)
def api_root():
    key_set = bool(get_api_key())
    return {
        "status": "online" if len(_STARTUP_ERRORS) == 0 else "degraded",
        "message": "ResumeRise AI API is running",
        "startup_errors": _STARTUP_ERRORS,
        "llm_key_configured": key_set,
        "geminiConfigured": key_set,
    }


# ---------- ATS scoring ----------
@app.post("/api/ats/analyze")
@app.post("/ats/analyze")
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
@app.post("/api/ats/optimize-compat")
@app.post("/ats/optimize")
@app.post("/ats/optimize-compat")
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
@app.post("/api/ats/export-docx")
@app.post("/export/docx")
@app.post("/ats/export-docx")
def export_docx(body: ExportIn):
    return Response(
        create_resume_docx_bytes(body.text),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@app.post("/api/export/pdf")
@app.post("/api/ats/export-pdf")
@app.post("/export/pdf")
@app.post("/ats/export-pdf")
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
@app.post("/api/jobs/search-compat")
@app.post("/jobs/search")
@app.post("/jobs/search-compat")
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
@app.post("/jobs/send")
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


# ---------- authentication (Email OTP + JWT) ----------
import base64
import hashlib
import hmac
import json
import os
import random
import tempfile
import time
from fastapi import Header, Request

JWT_SECRET = os.getenv("JWT_SECRET", "resumerise-ai-secret-jwt-key-2026-secure")

# In serverless environments (e.g. AWS Lambda / Vercel), the task directory is read-only.
# Only /tmp is writable for ephemeral storage.
if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    DATA_DIR = Path("/tmp") / "data"
else:
    DATA_DIR = _REPO_ROOT / "data"

try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    DATA_DIR = Path(tempfile.gettempdir()) / "data"
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

USERS_FILE = DATA_DIR / "users.json"
OTPS_FILE = DATA_DIR / "otps.json"


def _read_json(p: Path, default):
    if not p.is_file():
        # Fallback to seed file in repository if exists
        seed = _REPO_ROOT / "data" / p.name
        if seed.is_file():
            try:
                with open(seed, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return default
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(p: Path, data):
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(f".{time.time()}.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        tmp.replace(p)
    except Exception as exc:
        print(f"[Storage Warning] Could not write {p}: {exc}")


def _b64_url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64_url_decode(data: str) -> bytes:
    pad = 4 - (len(data) % 4)
    if pad != 4:
        data += "=" * pad
    return base64.urlsafe_b64decode(data.encode())


def _create_jwt(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64_url_encode(json.dumps(header, separators=(",", ":")).encode())
    p = _b64_url_encode(json.dumps(payload, separators=(",", ":")).encode())
    msg = f"{h}.{p}".encode()
    sig = _b64_url_encode(hmac.new(JWT_SECRET.encode(), msg, hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"


def _verify_jwt(token: str) -> dict | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        h, p, sig = parts
        msg = f"{h}.{p}".encode()
        expected = _b64_url_encode(hmac.new(JWT_SECRET.encode(), msg, hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_b64_url_decode(p).decode())
        if data.get("exp") and time.time() > data["exp"]:
            return None
        return data
    except Exception:
        return None


class SendOtpIn(BaseModel):
    email: str


class VerifyOtpIn(BaseModel):
    email: str
    otp: str
    name: str = ""


@app.post("/api/auth/send-otp")
@app.post("/auth/send-otp")
def auth_send_otp(body: SendOtpIn):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Please provide a valid email address.")

    plain_otp = f"{random.randint(100000, 999999)}"
    otp_hash = hashlib.sha256(plain_otp.encode()).hexdigest()

    otps = _read_json(OTPS_FILE, [])
    # Mark old unused codes for this email as used
    for o in otps:
        if o.get("email") == email and not o.get("used"):
            o["used"] = True

    otps.append({
        "id": f"otp_{int(time.time()*1000)}",
        "email": email,
        "otpHash": otp_hash,
        "expiresAt": int((time.time() + 600) * 1000),  # 10 min
        "attempts": 0,
        "used": False,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    _write_json(OTPS_FILE, otps)

    print(f"\n[FastAPI Auth] OTP generated for {email}: {plain_otp}\n")

    # Send email
    cfg = get_smtp_config("", "", "", "", "", False)
    if smtp_is_configured(cfg):
        try:
            send_email(
                email,
                f"Your ResumeRise AI verification code: {plain_otp}",
                f"Your verification code is: {plain_otp}\n\nValid for 10 minutes.",
                cfg,
            )
        except Exception as exc:
            print(f"[FastAPI Auth] SMTP dispatch note: {exc}")

    return {"ok": True, "message": "Verification code sent to your email. Please check your inbox."}


@app.post("/api/auth/verify-otp")
@app.post("/auth/verify-otp")
def auth_verify_otp(body: VerifyOtpIn):
    email = body.email.strip().lower()
    clean_otp = body.otp.strip()
    if not email or not clean_otp:
        raise HTTPException(400, "Email and OTP are required.")

    otps = _read_json(OTPS_FILE, [])
    active = [
        o for o in otps
        if o.get("email") == email and not o.get("used")
    ]
    active.sort(key=lambda x: x.get("expiresAt", 0), reverse=True)

    if not active:
        raise HTTPException(400, "No active verification code found. Please request a new code.")

    record = active[0]
    now_ms = int(time.time() * 1000)
    if now_ms > record.get("expiresAt", 0):
        record["used"] = True
        _write_json(OTPS_FILE, otps)
        raise HTTPException(400, "Verification code has expired. Please request a new code.")

    if record.get("attempts", 0) >= 5:
        record["used"] = True
        _write_json(OTPS_FILE, otps)
        raise HTTPException(400, "Too many incorrect attempts. Please request a new code.")

    expected_hash = hashlib.sha256(clean_otp.encode()).hexdigest()
    if expected_hash != record.get("otpHash"):
        record["attempts"] = record.get("attempts", 0) + 1
        _write_json(OTPS_FILE, otps)
        remaining = 5 - record["attempts"]
        raise HTTPException(400, f"Invalid verification code. {remaining} attempt(s) remaining.")

    record["used"] = True
    _write_json(OTPS_FILE, otps)

    # Upsert user
    users = _read_json(USERS_FILE, [])
    user = next((u for u in users if u.get("email") == email), None)
    iso_now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    if user:
        user["lastLoginAt"] = iso_now
        if body.name.strip():
            user["name"] = body.name.strip()
    else:
        user = {
            "id": f"usr_{int(time.time()*1000)}",
            "email": email,
            "name": body.name.strip() or email.split("@")[0],
            "createdAt": iso_now,
            "lastLoginAt": iso_now,
        }
        users.append(user)
    _write_json(USERS_FILE, users)

    token = _create_jwt({
        "userId": user["id"],
        "email": user["email"],
        "exp": int(time.time() + 7 * 86400),
    })

    return {
        "ok": True,
        "token": token,
        "user": user,
    }


@app.get("/api/auth/me")
@app.get("/auth/me")
def auth_me(authorization: str | None = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required. Missing Bearer token.")

    token = authorization[7:].strip()
    payload = _verify_jwt(token)
    if not payload:
        raise HTTPException(401, "Invalid or expired token.")

    users = _read_json(USERS_FILE, [])
    user = next((u for u in users if u.get("id") == payload.get("userId")), None)
    if not user:
        raise HTTPException(401, "User not found.")

    return {"ok": True, "user": user}


@app.post("/api/auth/logout")
@app.post("/auth/logout")
def auth_logout():
    return {"ok": True, "message": "Logged out successfully."}


# ---------- serve built frontend (production) ----------
DIST = Path(__file__).resolve().parent / "frontend" / "dist"
if not DIST.is_dir():
    alt_dist = _REPO_ROOT / "frontend" / "dist"
    if alt_dist.is_dir():
        DIST = alt_dist

if DIST.is_dir() and (DIST / "index.html").is_file():
    assets_dir = DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Endpoint not found")
        target = (DIST / full_path).resolve()
        if full_path and target.is_file() and target.is_relative_to(DIST.resolve()):
            return FileResponse(target)
        index_file = DIST / "index.html"
        if index_file.is_file():
            return FileResponse(index_file)
        return {"status": "online", "message": "ResumeRise AI API is running"}
else:
    @app.get("/", include_in_schema=False)
    def root_fallback():
        return {
            "status": "online",
            "message": "ResumeRise AI API is running",
        }
