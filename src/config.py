import os
from pathlib import Path

# Base directory is the project root (where src/ is located)
BASE_DIR = Path(__file__).resolve().parent.parent

# Storage configuration - entirely relative to run within the project folder
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "indexarc.db"
CHROMA_DIR = DATA_DIR / "chroma"

# Ollama Endpoint Configuration
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_LLM_MODEL = os.environ.get("OLLAMA_LLM_MODEL", "qwen2.5:0.5b")
DEFAULT_EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# Ensure storage directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)
