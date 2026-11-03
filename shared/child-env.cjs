"use strict";

// Environment for third-party child processes (Ollama installer/server, the
// LanguageTool JVM). The API pairing token and the settings wrap key live in
// process.env so the embedded server can read them — spawned children would
// otherwise inherit both (a long-lived detached `ollama serve` keeps them for
// its whole lifetime). Cloud AI keys loaded from .env are dropped too: none
// of these children needs them.
const SECRET_ENV_KEYS = [
  "INDEXARC_API_TOKEN",
  "INDEXARC_SETTINGS_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "LOCAL_OPENAI_API_KEY",
];

function childEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  for (const k of SECRET_ENV_KEYS) delete env[k];
  return env;
}

module.exports = { childEnv, SECRET_ENV_KEYS };
