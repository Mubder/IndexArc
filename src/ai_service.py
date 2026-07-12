import json
import logging
import requests
from typing import List, Dict, Any, Optional
from src.config import OLLAMA_BASE_URL, DEFAULT_LLM_MODEL, DEFAULT_EMBED_MODEL

logger = logging.getLogger("IndexArc.AIService")

class AIService:
    @staticmethod
    def get_ollama_models() -> List[str]:
        """Fetch available models from the local Ollama instance."""
        url = f"{OLLAMA_BASE_URL}/api/tags"
        try:
            response = requests.get(url, timeout=3.0)
            if response.status_code == 200:
                data = response.json()
                models = [model["name"] for model in data.get("models", [])]
                return models
        except Exception as e:
            logger.warning(f"Failed to connect to Ollama at {OLLAMA_BASE_URL}: {e}")
        return []

    @staticmethod
    def generate_embedding(text: str, model_name: str = DEFAULT_EMBED_MODEL) -> Optional[List[float]]:
        """Generate vector embeddings for the given text using local Ollama."""
        # Clean text
        text = text.strip()
        if not text:
            return None

        # Ollama has two endpoints: /api/embed (newer) and /api/embeddings (older)
        # We try /api/embed first, and fallback to /api/embeddings
        for endpoint in ["/api/embed", "/api/embeddings"]:
            url = f"{OLLAMA_BASE_URL}{endpoint}"
            try:
                # Prepare payload based on endpoint specifications
                if endpoint == "/api/embed":
                    payload = {"model": model_name, "input": text}
                else:
                    payload = {"model": model_name, "prompt": text}
                
                response = requests.post(url, json=payload, timeout=10.0)
                if response.status_code == 200:
                    data = response.json()
                    # /api/embed returns "embeddings": [[...]], /api/embeddings returns "embedding": [...]
                    if "embeddings" in data and data["embeddings"]:
                        return data["embeddings"][0]
                    elif "embedding" in data:
                        return data["embedding"]
            except Exception as e:
                logger.debug(f"Endpoint {endpoint} failed: {e}")
                continue
                
        logger.error(f"Failed to generate embedding for text using model {model_name}")
        return None

    @staticmethod
    def classify_and_title(content: str, model_name: str = DEFAULT_LLM_MODEL) -> Dict[str, str]:
        """
        Classify raw text snippet and generate an automated 3-to-5 word title.
        Returns a strict JSON object: {"type": "...", "title": "..."}.
        """
        url = f"{OLLAMA_BASE_URL}/api/generate"
        
        prompt = f"""You are a Knowledge Ingestion Classifier. Analyze this raw text snippet and classify it into one of these types:
- 'API Key'
- 'Token'
- 'Code Snippet'
- 'Note'
- 'Document Extract'

Also, generate an automated, professional 3-to-5 word title summarizing the snippet.
Return a STRICT JSON object with exactly two keys: "type" and "title".
Do not include any explanation, markdown formatting, or preamble.

Snippet content:
\"\"\"
{content[:2000]}
\"\"\"

Expected JSON response format:
{{"type": "<classified_type>", "title": "<3_to_5_word_title>"}}
"""

        payload = {
            "model": model_name,
            "prompt": prompt,
            "system": "You are a precise classifier that only outputs JSON.",
            "stream": False,
            "format": "json"  # Forces Ollama to return a valid JSON object
        }

        try:
            response = requests.post(url, json=payload, timeout=15.0)
            if response.status_code == 200:
                result_text = response.json().get("response", "").strip()
                # Parse JSON
                try:
                    data = json.loads(result_text)
                    if "type" in data and "title" in data:
                        return {
                            "type": data["type"],
                            "title": data["title"]
                        }
                except json.JSONDecodeError:
                    logger.error(f"Ollama returned invalid JSON: {result_text}")
        except Exception as e:
            logger.error(f"Error calling Ollama classify: {e}")

        # Intelligent local fallback in case Ollama is not running or fails
        return AIService._local_fallback_classifier(content)

    @staticmethod
    def _local_fallback_classifier(content: str) -> Dict[str, str]:
        """Local static heuristics fallback if Ollama model fails or is offline."""
        lines = [line.strip() for line in content.split("\n") if line.strip()]
        if not lines:
            return {"type": "Note", "title": "Empty Snippet Note"}

        first_line = lines[0]
        content_lower = content.lower()

        # Classification heuristics
        if any(keyword in content_lower for keyword in ["api_key", "apikey", "client_secret", "bearer ", "token="]) or (len(first_line) > 20 and first_line.isalnum() and not first_line.islower() and not first_line.isupper()):
            snippet_type = "API Key"
            title = "Extracted API Credentials"
        elif any(keyword in content_lower for keyword in ["jwt", "access_token", "id_token", "refresh_token"]):
            snippet_type = "Token"
            title = "Security Access Token"
        elif any(keyword in content_lower for keyword in ["def ", "class ", "import ", "function ", "const ", "let ", "var ", "<html>", "<?php"]):
            snippet_type = "Code Snippet"
            # Try to make a code snippet title
            title = f"Code Snippet: {first_line[:20]}..." if len(first_line) > 20 else f"Code Snippet ({first_line})"
        else:
            snippet_type = "Note"
            words = content.split()
            title = " ".join(words[:4]) + "..." if len(words) > 4 else content[:25]

        return {"type": snippet_type, "title": title}
