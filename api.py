import sys
from pathlib import Path

# Add repository root and nested backend to sys.path
_REPO_ROOT = Path(__file__).resolve().parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

_BACKEND_DIR = _REPO_ROOT / "ats_ui" / "ResumeRise-fullstack" / "ResumeRise"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Import the FastAPI app from api.index (or fallback)
from api.index import app
