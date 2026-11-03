import sys
from pathlib import Path

# Add repository root to sys.path so 'src' and all modules resolve
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

API_DIR = REPO_ROOT / "ats_ui" / "ResumeRise-fullstack" / "ResumeRise"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

# Load the existing FastAPI app instance from ats_ui/.../api.py
import importlib.util

_api_path = API_DIR / "api.py"
_spec = importlib.util.spec_from_file_location("resumerise_api", str(_api_path))
if _spec and _spec.loader:
    _api_module = importlib.util.module_from_spec(_spec)
    sys.modules["resumerise_api"] = _api_module
    _spec.loader.exec_module(_api_module)
    app = _api_module.app
else:
    raise RuntimeError(f"Could not load FastAPI application from {_api_path}")

