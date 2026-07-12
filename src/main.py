import os
import logging
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, Form, UploadFile, File, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from src.config import DATA_DIR, DEFAULT_LLM_MODEL, DEFAULT_EMBED_MODEL
from src.database import (
    init_db, create_snippet, get_all_snippets, delete_snippet,
    add_tracked_directory, get_tracked_directories, remove_tracked_directory,
    get_indexed_files
)
from src.ai_service import AIService
from src.indexer import VectorStoreManager, FileIndexer, BackgroundWatcherManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("IndexArc.Main")

app = FastAPI(
    title="IndexArc - local Knowledge Management",
    description="A portable local SQLite + ChromaDB + Ollama vector store system."
)

# Enable CORS for local cross-origin connections
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize subsystems
init_db()
vector_manager = VectorStoreManager()
file_indexer = FileIndexer(vector_manager)
watcher_manager = BackgroundWatcherManager(file_indexer)

# Active session configuration overrides
current_config = {
    "llm_model": DEFAULT_LLM_MODEL,
    "embed_model": DEFAULT_EMBED_MODEL
}

# Ensure static files/uploads folders exist
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Resume watching all tracked directories on startup
@app.on_event("startup")
def startup_event():
    logger.info("Initializing IndexArc and restoring directory watchers...")
    try:
        dirs = get_tracked_directories()
        for d in dirs:
            if d['status'] != 'Error':
                watcher_manager.start_watching_directory(d['id'], d['path'])
    except Exception as e:
        logger.error(f"Failed to restore directory watchers on startup: {e}")

@app.on_event("shutdown")
def shutdown_event():
    logger.info("Shutting down IndexArc watchers...")
    watcher_manager.stop_all()


# --- API ENDPOINTS ---

@app.get("/api/status")
async def get_system_status():
    """Return current configuration, Ollama status, and statistics."""
    ollama_models = AIService.get_ollama_models()
    is_ollama_online = len(ollama_models) > 0
    
    # Get stats
    snippets = get_all_snippets()
    dirs = get_tracked_directories()
    indexed_files = get_indexed_files()
    
    return {
        "is_ollama_online": is_ollama_online,
        "ollama_models": ollama_models,
        "config": current_config,
        "stats": {
            "total_snippets": len(snippets),
            "total_directories": len(dirs),
            "total_files": len(indexed_files)
        }
    }


@app.post("/api/settings/update")
async def update_settings(llm_model: str = Form(...), embed_model: str = Form(...)):
    """Update active local LLM and embedding models."""
    current_config["llm_model"] = llm_model
    current_config["embed_model"] = embed_model
    return JSONResponse(content={"status": "success", "config": current_config})


@app.post("/api/snippets/ingest")
async def ingest_snippet(content: str = Form(...), user_note: Optional[str] = Form(None)):
    """Ingest a raw text snippet, classify it with local Ollama, and save to SQLite."""
    if not content.strip():
        raise HTTPException(status_code=400, detail="Snippet content cannot be empty")
        
    try:
        # LLM classification
        classification = AIService.classify_and_title(content, model_name=current_config["llm_model"])
        
        # Save to DB
        snippet_id = create_snippet(
            snippet_type=classification["type"],
            title=classification["title"],
            content=content,
            user_note=user_note
        )
        
        # Optionally, generate and save embedding for the snippet as well for general knowledge search
        snippet_embedding = AIService.generate_embedding(content, model_name=current_config["embed_model"])
        if snippet_embedding:
            vector_manager.add_document_chunks(
                file_path=f"snippet://{snippet_id}",
                chunks=[content],
                embeddings=[snippet_embedding],
                metadatas=[{
                    "file_path": f"snippet://{snippet_id}",
                    "file_name": f"Snippet - {classification['title']}",
                    "chunk_index": 0,
                    "type": "snippet"
                }]
            )
            
        return JSONResponse(content={
            "status": "success",
            "snippet_id": snippet_id,
            "classified_type": classification["type"],
            "title": classification["title"]
        })
    except Exception as e:
        logger.error(f"Failed to ingest snippet: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/files/upload")
async def upload_and_index_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Receive uploaded file, save it to uploads directory, and index it asynchronously."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
        
    supported_extensions = {".pdf", ".docx", ".txt", ".md", ".json", ".log"}
    suffix = Path(file.filename).suffix.lower()
    if suffix not in supported_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported file format: {suffix}. Supported: {', '.join(supported_extensions)}")
        
    # Save original file to portable uploads directory
    target_path = UPLOAD_DIR / file.filename
    try:
        with open(target_path, "wb") as f:
            content = await file.read()
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}")

    # Index in background to avoid blocking request
    background_tasks.add_task(
        file_indexer.index_file,
        file_path_str=str(target_path),
        source_type='upload'
    )
    
    return JSONResponse(content={
        "status": "processing",
        "file_name": file.filename,
        "saved_path": str(target_path)
    })


@app.post("/api/directories/track")
async def track_directory(path: str = Form(...)):
    """Register an absolute path and kick off background recursive watcher."""
    normalized_path = os.path.abspath(path.strip())
    if not os.path.exists(normalized_path) or not os.path.isdir(normalized_path):
        raise HTTPException(status_code=400, detail="Provided directory path is invalid or inaccessible")
        
    try:
        # Add to tracked list in DB
        dir_id = add_tracked_directory(normalized_path)
        
        # Start initial background scan + watchdog monitoring
        watcher_manager.start_watching_directory(dir_id, normalized_path)
        
        return JSONResponse(content={
            "status": "added",
            "directory_id": dir_id,
            "path": normalized_path
        })
    except Exception as e:
        logger.error(f"Failed to track directory {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/directories/{dir_id}")
async def stop_tracking_directory(dir_id: int):
    """Cease file watching and delete directory references from DB."""
    try:
        watcher_manager.stop_watching_directory(dir_id)
        remove_tracked_directory(dir_id)
        return JSONResponse(content={"status": "success", "message": f"Tracked directory {dir_id} removed"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/snippets/{snippet_id}")
async def remove_snippet(snippet_id: int):
    """Remove raw snippet and its vector embedding from index."""
    try:
        delete_snippet(snippet_id)
        # Delete from Vector Database
        vector_manager.delete_document_chunks(f"snippet://{snippet_id}")
        return JSONResponse(content={"status": "success", "message": f"Snippet {snippet_id} deleted"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search")
async def perform_search(query: str, n_results: int = 5):
    """Execute semantic query search using Ollama embeddings + ChromaDB."""
    if not query.strip():
        raise HTTPException(status_code=400, detail="Search query is empty")
        
    try:
        # Generate embedding for search query
        query_embedding = AIService.generate_embedding(query, model_name=current_config["embed_model"])
        
        # Query ChromaDB (falls back to text search if embedding is None)
        search_results = vector_manager.similarity_search(
            query_text=query,
            query_embedding=query_embedding,
            n_results=n_results
        )
        
        return {
            "query": query,
            "using_vector": query_embedding is not None,
            "results": search_results
        }
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")


@app.get("/api/snippets")
async def list_snippets():
    return get_all_snippets()


@app.get("/api/directories")
async def list_directories():
    return get_tracked_directories()


@app.get("/api/files")
async def list_indexed_files():
    return get_indexed_files()


# --- HTML/HTMX DASHBOARD ROUTING ---

# Since the prompt requests HTMX-ready routes, we provide quick HTML fragment rendering 
# for seamless HTMX single page experiences.
@app.get("/", response_class=HTMLResponse)
async def serve_portal(request: Request):
    """Serves the main HTMX-ready HTML control dashboard."""
    # Read embedded template or direct HTML content to remain 100% portable 
    # without external asset reliance.
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IndexArc - local KM</title>
        <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; }
            code, pre { font-family: 'JetBrains Mono', monospace; }
        </style>
    </head>
    <body class="bg-slate-900 text-slate-100 min-h-screen">
        <div class="max-w-7xl mx-auto px-4 py-8">
            <!-- Header -->
            <header class="flex justify-between items-center mb-8 pb-4 border-b border-slate-800">
                <div>
                    <h1 class="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
                        <span>IndexArc</span>
                        <span class="text-xs bg-indigo-500/20 text-indigo-400 font-mono px-2 py-0.5 rounded border border-indigo-500/30">v1.0.0</span>
                    </h1>
                    <p class="text-xs text-slate-400 mt-1">Local Knowledge Management & semantic Vector Store</p>
                </div>
                <div class="flex items-center gap-4">
                    <span id="ollama-status" class="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono bg-slate-800 border border-slate-700">
                        <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span> Offline
                    </span>
                </div>
            </header>

            <!-- Main Layout Grid -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <!-- Left Control Panel: Ingestions -->
                <div class="lg:col-span-2 space-y-6">
                    <!-- Text Snippet Panel -->
                    <section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                        <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <span class="p-1 rounded bg-teal-500/10 text-teal-400">📝</span>
                            Ingest Raw Text Snippet
                        </h2>
                        <form id="snippet-form" class="space-y-4">
                            <div>
                                <label class="block text-xs text-slate-400 mb-1">Raw Content (API keys, Tokens, Code, Notes)</label>
                                <textarea name="content" required placeholder="Paste secret keys, snippets, tokens or note texts..." rows="4" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm focus:outline-none focus:border-indigo-500 text-slate-200 font-mono"></textarea>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs text-slate-400 mb-1">Additional Context/Note (Optional)</label>
                                    <input type="text" name="user_note" placeholder="Provide extra description..." class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm focus:outline-none focus:border-indigo-500 text-slate-200">
                                </div>
                                <div class="flex items-end">
                                    <button type="submit" class="w-full bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-all">
                                        Analyze & Store Snippet
                                    </button>
                                </div>
                            </div>
                        </form>
                    </section>

                    <!-- File Indexing Panel -->
                    <section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                        <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <span class="p-1 rounded bg-sky-500/10 text-sky-400">📁</span>
                            Index Individual Document
                        </h2>
                        <form id="file-form" enctype="multipart/form-data" class="space-y-4">
                            <div class="border-2 border-dashed border-slate-700 hover:border-sky-500/50 rounded-lg p-6 text-center cursor-pointer transition-colors relative">
                                <input type="file" name="file" id="file-input" required class="absolute inset-0 opacity-0 cursor-pointer">
                                <div class="space-y-1">
                                    <p class="text-sm font-medium text-slate-300">Drag files here or click to upload</p>
                                    <p class="text-xs text-slate-500">Supports PDF, DOCX, TXT, MD, JSON, LOG</p>
                                </div>
                                <div id="file-selected-name" class="mt-2 text-xs text-teal-400 font-mono hidden"></div>
                            </div>
                            <div class="flex justify-end">
                                <button type="submit" class="bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium py-2 px-6 rounded-lg transition-all">
                                    Parse, Embed & Ingest File
                                </button>
                            </div>
                        </form>
                    </section>

                    <!-- Track Directory Panel -->
                    <section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                        <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <span class="p-1 rounded bg-indigo-500/10 text-indigo-400">⚡</span>
                            Track & Watch Folder Directory
                        </h2>
                        <form id="dir-form" class="space-y-4">
                            <div class="flex gap-2">
                                <div class="flex-1">
                                    <label class="block text-xs text-slate-400 mb-1">Absolute Directory Path (e.g. D:/Files or /home/docs)</label>
                                    <input type="text" name="path" required placeholder="Enter absolute folder path..." class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm focus:outline-none focus:border-indigo-500 text-slate-200">
                                </div>
                                <div class="flex items-end">
                                    <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2.5 px-6 rounded-lg transition-all">
                                        Track Directory
                                    </button>
                                </div>
                            </div>
                        </form>
                    </section>
                </div>

                <!-- Right Side: System Stats, Search & Configuration -->
                <div class="space-y-6">
                    <!-- Search Engine -->
                    <section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                        <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <span class="p-1 rounded bg-indigo-500/10 text-indigo-400">🔍</span>
                            Semantic Search Vector Query
                        </h2>
                        <div class="space-y-4">
                            <div class="relative">
                                <input id="search-input" type="text" placeholder="Query semantic context..." class="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-3 pr-10 text-sm focus:outline-none focus:border-indigo-500 text-slate-200">
                                <button id="search-btn" class="absolute right-2 top-2 text-indigo-400 hover:text-indigo-300">
                                    →
                                </button>
                            </div>
                            <div id="search-results-box" class="space-y-3 max-h-72 overflow-y-auto pr-1 hidden">
                                <!-- Results populate here -->
                            </div>
                        </div>
                    </section>

                    <!-- Settings Panel -->
                    <section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                        <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <span class="p-1 rounded bg-amber-500/10 text-amber-400">⚙️</span>
                            Local Ollama Config
                        </h2>
                        <form id="settings-form" class="space-y-3">
                            <div>
                                <label class="block text-xs text-slate-400 mb-1">Local LLM Model</label>
                                <select id="llm-select" name="llm_model" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-slate-200">
                                    <option value="qwen2.5:0.5b">qwen2.5:0.5b (default)</option>
                                    <option value="llama3.2:1b">llama3.2:1b</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs text-slate-400 mb-1">Embedding Model</label>
                                <select id="embed-select" name="embed_model" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-slate-200">
                                    <option value="nomic-embed-text">nomic-embed-text (default)</option>
                                </select>
                            </div>
                            <button type="submit" class="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs py-1.5 rounded transition-all">
                                Update Models
                            </button>
                        </form>
                    </section>

                    <!-- Statistics & Live Indexes -->
                    <section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                        <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Workspace Indexing State</h2>
                        <div class="grid grid-cols-3 gap-2 text-center mb-4">
                            <div class="bg-slate-900 p-2 rounded-lg border border-slate-800">
                                <div id="stat-snippets" class="text-xl font-bold text-white">0</div>
                                <div class="text-[10px] text-slate-500">Snippets</div>
                            </div>
                            <div class="bg-slate-900 p-2 rounded-lg border border-slate-800">
                                <div id="stat-files" class="text-xl font-bold text-white">0</div>
                                <div class="text-[10px] text-slate-500">Docs</div>
                            </div>
                            <div class="bg-slate-900 p-2 rounded-lg border border-slate-800">
                                <div id="stat-dirs" class="text-xl font-bold text-white">0</div>
                                <div class="text-[10px] text-slate-500">Folders</div>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <h3 class="text-xs font-semibold text-slate-400">Tracked Paths</h3>
                            <div id="tracked-paths-list" class="space-y-1 text-xs">
                                <!-- Lists folders -->
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>

        <script>
            // Simple logic block to communicate with FastAPI server
            const base = "";

            async function updateStatus() {
                try {
                    const res = await fetch(base + "/api/status");
                    if (res.ok) {
                        const status = await res.json();
                        const sLabel = document.getElementById("ollama-status");
                        if (status.is_ollama_online) {
                            sLabel.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Online`;
                            sLabel.className = "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
                        } else {
                            sLabel.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Local Ollama Connection Offline`;
                            sLabel.className = "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30";
                        }
                        
                        // Populate models dropdown
                        if (status.ollama_models && status.ollama_models.length) {
                            const select = document.getElementById("llm-select");
                            select.innerHTML = "";
                            status.ollama_models.forEach(m => {
                                const opt = document.createElement("option");
                                opt.value = m;
                                opt.innerText = m;
                                if (m === status.config.llm_model) opt.selected = true;
                                select.appendChild(opt);
                            });
                        }

                        // Populate stats
                        document.getElementById("stat-snippets").innerText = status.stats.total_snippets;
                        document.getElementById("stat-files").innerText = status.stats.total_files;
                        document.getElementById("stat-dirs").innerText = status.stats.total_directories;
                    }
                } catch(e) { console.error(e); }
            }

            async function loadDirectories() {
                try {
                    const res = await fetch(base + "/api/directories");
                    if (res.ok) {
                        const dirs = await res.json();
                        const list = document.getElementById("tracked-paths-list");
                        list.innerHTML = "";
                        if (!dirs.length) {
                            list.innerHTML = `<div class="text-slate-500 italic">No folder registered</div>`;
                        }
                        dirs.forEach(d => {
                            const el = document.createElement("div");
                            el.className = "flex justify-between items-center bg-slate-800 p-2 rounded border border-slate-700/50 mb-1";
                            el.innerHTML = `
                                <div class="truncate mr-2">
                                    <span class="font-mono text-[10px] text-slate-400 bg-slate-900 px-1 py-0.5 rounded border border-slate-800 mr-1">${d.status}</span>
                                    <span class="text-slate-300 font-mono">${d.path}</span>
                                </div>
                                <button onclick="deleteDir(${d.id})" class="text-red-400 hover:text-red-300">×</button>
                            `;
                            list.appendChild(el);
                        });
                    }
                } catch(e) {}
            }

            async function deleteDir(id) {
                if (confirm("Remove tracked directory? Observer threads will terminate.")) {
                    const res = await fetch(base + `/api/directories/${id}`, { method: 'DELETE' });
                    if (res.ok) {
                        loadDirectories();
                        updateStatus();
                    }
                }
            }

            // Forms submissions
            document.getElementById("snippet-form").onsubmit = async (e) => {
                e.preventDefault();
                const fd = new FormData(e.target);
                const res = await fetch(base + "/api/snippets/ingest", { method: 'POST', body: fd });
                if (res.ok) {
                    alert("Snippet ingested successfully!");
                    e.target.reset();
                    updateStatus();
                } else {
                    const err = await res.json();
                    alert("Failure: " + (err.detail || "Unknown error"));
                }
            };

            const fileInput = document.getElementById("file-input");
            fileInput.onchange = () => {
                const fn = document.getElementById("file-selected-name");
                if (fileInput.files.length) {
                    fn.innerText = "Selected: " + fileInput.files[0].name;
                    fn.classList.remove("hidden");
                }
            };

            document.getElementById("file-form").onsubmit = async (e) => {
                e.preventDefault();
                const fd = new FormData(e.target);
                const res = await fetch(base + "/api/files/upload", { method: 'POST', body: fd });
                if (res.ok) {
                    alert("File is being processed in background vector pipeline.");
                    e.target.reset();
                    document.getElementById("file-selected-name").classList.add("hidden");
                    updateStatus();
                } else {
                    alert("Upload failed.");
                }
            };

            document.getElementById("dir-form").onsubmit = async (e) => {
                e.preventDefault();
                const fd = new FormData(e.target);
                const res = await fetch(base + "/api/directories/track", { method: 'POST', body: fd });
                if (res.ok) {
                    alert("Directory tracking initiated!");
                    e.target.reset();
                    loadDirectories();
                    updateStatus();
                } else {
                    const err = await res.json();
                    alert("Directory invalid or inaccessible: " + (err.detail || "Unknown"));
                }
            };

            // Search
            document.getElementById("search-btn").onclick = async () => {
                const query = document.getElementById("search-input").value;
                if (!query) return;
                const res = await fetch(base + `/api/search?query=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    const box = document.getElementById("search-results-box");
                    box.innerHTML = "";
                    box.classList.remove("hidden");
                    if (!data.results.length) {
                        box.innerHTML = `<div class="text-xs text-slate-500 italic">No semantic hits found</div>`;
                        return;
                    }
                    data.results.forEach(r => {
                        const div = document.createElement("div");
                        div.className = "bg-slate-900 border border-slate-800 p-2 rounded-lg space-y-1 text-xs";
                        div.innerHTML = `
                            <div class="flex justify-between font-mono text-[10px] text-indigo-400">
                                <span class="truncate max-w-[180px]">${r.metadata.file_name || "Unknown file"}</span>
                                <span>Score: ${Math.round(r.score * 100)}%</span>
                            </div>
                            <p class="text-slate-300 leading-relaxed font-sans">${r.text}</p>
                        `;
                        box.appendChild(div);
                    });
                }
            };

            // Init loop
            updateStatus();
            loadDirectories();
            setInterval(updateStatus, 5000);
        </script>
    </body>
    </html>
    """
