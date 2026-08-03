"""ERP backend package bootstrap."""
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if (PROJECT_ROOT / "shared_domain").exists():
    root = str(PROJECT_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
