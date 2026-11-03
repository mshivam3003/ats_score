import sys
import traceback
from pathlib import Path
from fastapi import FastAPI

# Add repository root and API_DIR to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

API_DIR = REPO_ROOT / "ats_ui" / "ResumeRise-fullstack" / "ResumeRise"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

app = None
_load_error = None

# Attempt 1: Load via importlib from ats_ui/.../api.py
try:
    import importlib.util
    _api_path = API_DIR / "api.py"
    if _api_path.is_file():
        _spec = importlib.util.spec_from_file_location("resumerise_api", str(_api_path))
        if _spec and _spec.loader:
            _api_module = importlib.util.module_from_spec(_spec)
            sys.modules["resumerise_api"] = _api_module
            _spec.loader.exec_module(_api_module)
            app = getattr(_api_module, "app", None)
except Exception as e:
    _load_error = f"importlib error: {e}\n{traceback.format_exc()}"

# Attempt 2: Direct import api
if app is None:
    try:
        import api
        app = getattr(api, "app", None)
    except Exception as e:
        if not _load_error:
            _load_error = f"direct import api error: {e}\n{traceback.format_exc()}"

# Fallback FastAPI app if neither loaded
if app is None:
    app = FastAPI(title="ResumeRise Fallback API")
    @app.get("/")
    @app.get("/api")
    @app.get("/api/health")
    @app.get("/health")
    def fallback_status():
        return {
            "status": "error",
            "message": "ResumeRise FastAPI application failed to initialize",
            "detail": _load_error,
        }
