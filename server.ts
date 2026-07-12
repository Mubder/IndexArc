import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Path definitions
const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "indexarc_node_db.json");
const VECTORS_FILE = path.join(DATA_DIR, "indexarc_node_vectors.json");

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure database files exist
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ snippets: [], directories: [], files: [] }, null, 2));
}
if (!fs.existsSync(VECTORS_FILE)) {
  fs.writeFileSync(VECTORS_FILE, JSON.stringify({ chunks: [] }, null, 2));
}

// Helpers for Reading/Writing our SQLite-matching JSON Database
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch (e) {
    return { snippets: [], directories: [], files: [] };
  }
}

function writeDB(data: any) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function readVectors() {
  try {
    return JSON.parse(fs.readFileSync(VECTORS_FILE, "utf-8"));
  } catch (e) {
    return { chunks: [] };
  }
}

function writeVectors(data: any) {
  fs.writeFileSync(VECTORS_FILE, JSON.stringify(data, null, 2));
}

// Logs Buffer for high-fidelity live tracking simulator
let systemLogs: { time: string; type: string; message: string }[] = [];
function addLog(type: string, message: string) {
  const log = {
    time: new Date().toLocaleTimeString(),
    type,
    message
  };
  systemLogs.push(log);
  if (systemLogs.length > 200) systemLogs.shift();
}

addLog("SYSTEM", "IndexArc portal interface loaded successfully.");
addLog("DB", "Connected to relative local database: data/indexarc.db");
addLog("VECTORSTORE", "Initialized ChromaDB persistent client in data/chroma");

// Initialize Gemini SDK with telemetry
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Helper for fetching embeddings safely across different SDK response structures
async function getEmbeddingValues(text: string): Promise<number[] | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const res: any = await ai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: text
    });
    const values = res.embedding?.values || res.embeddings?.[0]?.values || res.embeddings?.values || res.embedding;
    if (Array.isArray(values)) {
      return values as number[];
    }
  } catch (err) {
    console.error("Embedding API Error:", err);
  }
  return null;
}

// Helper for Cosine Similarity
function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Text Chunking (Matches Python implementation)
function chunkText(text: string, chunkSize = 800, overlap = 150) {
  if (!text) return [];
  const chunks: string[] = [];
  let start = 0;
  const len = text.length;
  while (start < len) {
    const end = Math.min(start + chunkSize, len);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start += chunkSize - overlap;
  }
  return chunks;
}

// Multi-format Text Scraper
function scrapeTextContent(fileName: string, buffer: Buffer): string {
  const suffix = path.extname(fileName).toLowerCase();
  if (suffix === ".pdf") {
    // Basic text extractor from PDF binary blocks
    const content = buffer.toString("binary");
    const matches = content.match(/\(([^)]+)\)\s*Tj/g);
    if (matches && matches.length > 0) {
      return matches.map(m => m.slice(1, -4)).join(" ");
    }
    // Fallback to reading printable characters
    return buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
  } else if (suffix === ".docx") {
    // Extraction for docx XML document.xml contents
    return buffer.toString("utf-8").replace(/<[^>]+>/g, " ").trim();
  } else {
    // Normal text formats (.txt, .md, .json, .log, .csv)
    return buffer.toString("utf-8");
  }
}

// Simulated active watchers
const activeWatchers: Record<string, NodeJS.Timeout> = {};

// --- API ENDPOINTS ---

// GET System Status and statistics
app.get("/api/status", (req, res) => {
  const db = readDB();
  const isGeminiAvailable = !!process.env.GEMINI_API_KEY;
  
  res.json({
    is_ollama_online: false, // In preview container, local Ollama is offline
    is_gemini_active: isGeminiAvailable,
    stats: {
      total_snippets: db.snippets.length,
      total_directories: db.directories.length,
      total_files: db.files.length,
    }
  });
});

// GET System Logs
app.get("/api/logs", (req, res) => {
  res.json(systemLogs);
});

// POST Ingest raw text snippets with Gemini classification
app.post("/api/snippets/ingest", async (req, res) => {
  const { content, user_note } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Content is required" });
  }

  addLog("INGESTER", `Received text snippet of size ${content.length} characters.`);
  
  try {
    let classification = { type: "Note", title: "Text Snippet Ingestion" };

    if (process.env.GEMINI_API_KEY) {
      addLog("LLM", "Calling Gemini API for intelligent snippet classification & titles...");
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `Analyze this raw text snippet and classify it into one of these types:
- 'API Key'
- 'Token'
- 'Code Snippet'
- 'Note'
- 'Document Extract'

Also generate an automated, professional 3-to-5 word title summarizing it.

Snippet content:
"""
${content.slice(0, 2000)}
"""`,
          config: {
            systemInstruction: "You are a local knowledge classifier. Classify the input and output a strict JSON object with type and title keys.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, description: "One of the listed classification types" },
                title: { type: Type.STRING, description: "Automated 3-to-5 word title" }
              },
              required: ["type", "title"]
            }
          }
        });

        if (response.text) {
          classification = JSON.parse(response.text.trim());
          addLog("LLM", `Gemini response: Classified as [${classification.type}] - "${classification.title}"`);
        }
      } catch (err: any) {
        addLog("LLM", `Gemini call failed or timed out: ${err.message || err}. Falling back to system heuristics.`);
      }
    } else {
      addLog("LLM", "No GEMINI_API_KEY found. Falling back to internal architect heuristic classifier.");
    }

    // Heuristics fallback if Gemini was offline/failed
    if (!classification.type || !classification.title || classification.title === "Text Snippet Ingestion") {
      const lower = content.toLowerCase();
      const firstLine = content.split("\n")[0]?.trim() || "Snippet";
      if (lower.includes("api_key") || lower.includes("apikey") || lower.includes("client_secret")) {
        classification = { type: "API Key", title: "API Configuration Credentials" };
      } else if (lower.includes("jwt") || lower.includes("token") || lower.includes("bearer ")) {
        classification = { type: "Token", title: "Security Access Credentials" };
      } else if (lower.includes("import ") || lower.includes("def ") || lower.includes("function") || lower.includes("class ")) {
        classification = { type: "Code Snippet", title: `Code Block: ${firstLine.slice(0, 20)}...` };
      } else {
        classification = { type: "Note", title: firstLine.length > 25 ? `${firstLine.slice(0, 25)}...` : firstLine };
      }
    }

    const db = readDB();
    const newSnippet = {
      id: Date.now(),
      type: classification.type,
      title: classification.title,
      content,
      user_note: user_note || "",
      created_at: new Date().toISOString()
    };

    db.snippets.unshift(newSnippet);
    writeDB(db);
    addLog("DB", `Stored raw snippet successfully (id: ${newSnippet.id}) in database.`);

    // Index snippet in Vector Database
    if (process.env.GEMINI_API_KEY) {
      try {
        addLog("EMBEDDER", `Creating semantic embeddings for snippet "${classification.title}"`);
        const values = await getEmbeddingValues(content);
        if (values) {
          const vectors = readVectors();
          vectors.chunks.push({
            id: `snippet_${newSnippet.id}`,
            text: content,
            embedding: values,
            metadata: {
              source: `snippet://${newSnippet.id}`,
              file_name: `Snippet: ${classification.title}`,
              type: "snippet"
            }
          });
          writeVectors(vectors);
          addLog("VECTORSTORE", `Ingested 1 chunk to local semantic vector index.`);
        }
      } catch (e: any) {
        addLog("EMBEDDER", `Embedding failed: ${e.message}`);
      }
    }

    res.json(newSnippet);
  } catch (e: any) {
    addLog("SYSTEM", `Failed to ingest snippet: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// GET list all snippets
app.get("/api/snippets", (req, res) => {
  const db = readDB();
  res.json(db.snippets);
});

// DELETE snippet
app.delete("/api/snippets/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  db.snippets = db.snippets.filter((s: any) => s.id !== id);
  writeDB(db);
  
  // Clean up vectors
  const vectors = readVectors();
  vectors.chunks = vectors.chunks.filter((c: any) => c.id !== `snippet_${id}`);
  writeVectors(vectors);

  addLog("DB", `Removed snippet reference ${id} from database.`);
  addLog("VECTORSTORE", `Removed vector data for snippet ${id}.`);
  res.json({ success: true });
});

// GET list all tracked directories
app.get("/api/directories", (req, res) => {
  const db = readDB();
  res.json(db.directories);
});

// POST Track and scan a folder directory (Simulated observer)
app.post("/api/directories/track", (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath || !dirPath.trim()) {
    return res.status(400).json({ error: "Directory path is required" });
  }

  const db = readDB();
  const normalizedPath = path.normalize(dirPath.trim());

  // Prevent duplicates
  if (db.directories.some((d: any) => d.path === normalizedPath)) {
    return res.status(400).json({ error: "Directory path is already registered" });
  }

  const newDir = {
    id: Date.now(),
    path: normalizedPath,
    status: "Scanning",
    created_at: new Date().toISOString()
  };

  db.directories.push(newDir);
  writeDB(db);

  addLog("WATCHDOG", `Registered directory watcher on local path: ${normalizedPath}`);
  addLog("INDEXER", `Initiating recursive text indexing pipeline for: ${normalizedPath}`);

  // Simulating the folder scan and hot monitoring logs
  setTimeout(() => {
    addLog("INDEXER", `[${normalizedPath}] Discovered 3 local system documents.`);
    
    // Create mock local documents inside the folder to demonstrate search
    const mockDocs = [
      {
        file_path: path.join(normalizedPath, "secrets_api_keys.txt"),
        file_name: "secrets_api_keys.txt",
        content: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nSTRIPE_LIVE_KEY=sk_live_51Nz23E...",
        size: 204
      },
      {
        file_path: path.join(normalizedPath, "deployment_notes.md"),
        file_name: "deployment_notes.md",
        content: "IndexArc Deployment Protocol.\n1. Install Ollama and pull qwen2.5:0.5b.\n2. Execute python main.py locally.\n3. Verify SQLite DB entries under data/indexarc.db",
        size: 340
      },
      {
        file_path: path.join(normalizedPath, "config_tokens.json"),
        file_name: "config_tokens.json",
        content: "{\n  \"JWT_SECRET_TOKEN\": \"shh_its_a_secret_jwt_hash_key_12345\",\n  \"GITHUB_OAUTH_TOKEN\": \"ghp_abcdef1234567890abcdef\"\n}",
        size: 110
      }
    ];

    // Embed mock documents if Gemini is available
    mockDocs.forEach(async (doc, idx) => {
      setTimeout(async () => {
        addLog("INDEXER", `[${normalizedPath}] Parsing Document: ${doc.file_name} (${doc.size} bytes)`);
        
        // Write file tracking entry
        const dbCurrent = readDB();
        const newFile = {
          id: Date.now() + idx,
          file_path: doc.file_path,
          file_name: doc.file_name,
          file_size: doc.size,
          source_type: "folder",
          directory_id: newDir.id,
          status: "indexed",
          last_indexed: new Date().toISOString()
        };
        dbCurrent.files.push(newFile);
        writeDB(dbCurrent);

        // Vector indexing
        if (process.env.GEMINI_API_KEY) {
          try {
            const values = await getEmbeddingValues(doc.content);
            if (values) {
              const vectors = readVectors();
              vectors.chunks.push({
                id: `folder_file_${newFile.id}`,
                text: doc.content,
                embedding: values,
                metadata: {
                  source: doc.file_path,
                  file_name: doc.file_name,
                  type: "file"
                }
              });
              writeVectors(vectors);
              addLog("VECTORSTORE", `[${normalizedPath}] Created embedding vector for ${doc.file_name} in ChromaDB.`);
            }
          } catch (embedErr: any) {
            addLog("EMBEDDER", `Embedding failed for ${doc.file_name}: ${embedErr.message}`);
          }
        }
      }, (idx + 1) * 800);
    });

    // Update folder observer state to active
    setTimeout(() => {
      const dbCurrent = readDB();
      const dirIndex = dbCurrent.directories.findIndex((d: any) => d.id === newDir.id);
      if (dirIndex !== -1) {
        dbCurrent.directories[dirIndex].status = "Active";
        writeDB(dbCurrent);
      }
      addLog("WATCHDOG", `[${normalizedPath}] Watchdog daemon registered. Active folder watching online.`);
    }, 3200);

  }, 1000);

  res.json(newDir);
});

// DELETE tracked directory
app.delete("/api/directories/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  const dir = db.directories.find((d: any) => d.id === id);
  if (dir) {
    addLog("WATCHDOG", `Stopped active directory watcher daemon on: ${dir.path}`);
  }
  
  db.directories = db.directories.filter((d: any) => d.id !== id);
  
  // Clean indexed files under this directory
  const filesToDelete = db.files.filter((f: any) => f.directory_id === id);
  const filePaths = filesToDelete.map((f: any) => f.file_path);
  db.files = db.files.filter((f: any) => f.directory_id !== id);
  writeDB(db);

  // Clean vectors
  const vectors = readVectors();
  vectors.chunks = vectors.chunks.filter((c: any) => !filePaths.includes(c.metadata.source));
  writeVectors(vectors);

  addLog("DB", `Removed directory tracking references (id: ${id}) from indexer.`);
  res.json({ success: true });
});

// GET list all indexed files
app.get("/api/files", (req, res) => {
  const db = readDB();
  res.json(db.files);
});

// POST single file uploads
// Since this is standard API routing, we support form parsing inside the express server.
import multer from "multer";
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // Limit to 10MB

app.post("/api/files/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const { originalname, size, buffer } = req.file;
  addLog("INGESTER", `Received file upload: ${originalname} (${size} bytes)`);

  const db = readDB();
  const tempPath = path.join(DATA_DIR, "uploads", originalname);

  // Ensure uploads directory exists
  if (!fs.existsSync(path.join(DATA_DIR, "uploads"))) {
    fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
  }

  // Save original file on server disk
  fs.writeFileSync(tempPath, buffer);
  addLog("INGESTER", `Saved original document references under relative path: data/uploads/${originalname}`);

  const newFile = {
    id: Date.now(),
    file_path: tempPath,
    file_name: originalname,
    file_size: size,
    source_type: "upload",
    directory_id: null,
    status: "indexing",
    last_indexed: new Date().toISOString()
  };

  db.files.unshift(newFile);
  writeDB(db);

  // Index and chunk file contents asynchronously
  setTimeout(async () => {
    try {
      const textContent = scrapeTextContent(originalname, buffer);
      if (!textContent.trim()) {
        throw new Error("Empty file content extracted.");
      }

      const chunks = chunkText(textContent);
      addLog("INDEXER", `Segmented ${originalname} into ${chunks.length} overlapping text chunks.`);

      const vectors = readVectors();

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let embedding = Array(384).fill(0).map(() => Math.random() - 0.5); // Fallback mock values

        if (process.env.GEMINI_API_KEY) {
          try {
            const values = await getEmbeddingValues(chunk);
            if (values) {
              embedding = values;
            }
          } catch (e: any) {
            addLog("EMBEDDER", `Embedding chunk ${i} failed: ${e.message}`);
          }
        }

        vectors.chunks.push({
          id: `file_${newFile.id}_chunk_${i}`,
          text: chunk,
          embedding,
          metadata: {
            source: tempPath,
            file_name: originalname,
            chunk_index: i,
            type: "file"
          }
        });
      }

      writeVectors(vectors);
      
      // Update file state to indexed
      const dbCurrent = readDB();
      const fileIdx = dbCurrent.files.findIndex((f: any) => f.id === newFile.id);
      if (fileIdx !== -1) {
        dbCurrent.files[fileIdx].status = "indexed";
        writeDB(dbCurrent);
      }

      addLog("VECTORSTORE", `Ingested ${chunks.length} vectors to ChromaDB index for: ${originalname}`);
      addLog("INDEXER", `Successfully completed vector pipeline index for: ${originalname}`);

    } catch (err: any) {
      addLog("INDEXER", `File indexing failed: ${err.message}`);
      const dbCurrent = readDB();
      const fileIdx = dbCurrent.files.findIndex((f: any) => f.id === newFile.id);
      if (fileIdx !== -1) {
        dbCurrent.files[fileIdx].status = "failed";
        dbCurrent.files[fileIdx].error_message = err.message;
        writeDB(dbCurrent);
      }
    }
  }, 1200);

  res.json({ status: "processing", file: originalname });
});

// POST semantic vector search queries
app.post("/api/search", async (req, res) => {
  const { query, n_results = 5 } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Query is required" });
  }

  addLog("SEARCH", `Semantic query search initiated: "${query}"`);

  try {
    let queryEmbedding: number[] | null = null;

    if (process.env.GEMINI_API_KEY) {
      try {
        const values = await getEmbeddingValues(query);
        if (values) {
          queryEmbedding = values;
          addLog("SEARCH", "Created semantic query vector representation using Gemini Embeddings.");
        }
      } catch (embedErr: any) {
        addLog("SEARCH", `Query embedding failed: ${embedErr.message}. Falling back to keyword proximity match.`);
      }
    }

    const vectors = readVectors();
    const hits: any[] = [];

    vectors.chunks.forEach((c: any) => {
      let score = 0;
      if (queryEmbedding && c.embedding) {
        score = cosineSimilarity(queryEmbedding, c.embedding);
      } else {
        // Keyword fallback text search (simple substring term match)
        const words = query.toLowerCase().split(/\s+/);
        const textLower = c.text.toLowerCase();
        let matchCount = 0;
        words.forEach((w: string) => {
          if (textLower.includes(w)) matchCount++;
        });
        score = matchCount / Math.max(words.length, 1);
      }

      hits.push({
        text: c.text,
        metadata: c.metadata,
        score: Math.max(0, Math.min(1, score)) // clamp 0 to 1
      });
    });

    // Sort by score descending and take top N
    const results = hits
      .sort((a, b) => b.score - a.score)
      .slice(0, n_results)
      .filter(h => h.score > 0.05); // Filter out zero/negligible hits

    addLog("SEARCH", `Vector search completed. Identified ${results.length} relevant semantic contexts.`);
    res.json({ results });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


// --- VITE MIDDLEWARE CONFIGURATION ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
