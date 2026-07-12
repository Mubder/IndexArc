import React, { useState, useEffect, useRef } from "react";
import { 
  Folder, 
  FileText, 
  Terminal, 
  Search, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Sliders, 
  HelpCircle, 
  Database, 
  Server, 
  CheckCircle, 
  AlertCircle,
  FilePlus2,
  Code,
  Tag,
  KeyRound,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Layers,
  Eye
} from "lucide-react";

interface Snippet {
  id: number;
  type: string;
  title: string;
  content: string;
  user_note?: string;
  created_at: string;
}

interface TrackedDirectory {
  id: number;
  path: string;
  status: string;
  created_at: string;
}

interface IndexedFile {
  id: number;
  file_path: string;
  file_name: string;
  file_size: number;
  source_type: string;
  directory_id: number | null;
  status: string;
  error_message?: string;
  last_indexed: string;
}

interface SystemLog {
  time: string;
  type: string;
  message: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"overview" | "snippets" | "files" | "directories" | "search" | "database">("overview");
  
  // Real database states retrieved via Express API
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [directories, setDirectories] = useState<TrackedDirectory[]>([]);
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [systemStatus, setSystemStatus] = useState({
    is_ollama_online: false,
    is_gemini_active: false,
    stats: {
      total_snippets: 0,
      total_directories: 0,
      total_files: 0
    }
  });
  const [logs, setLogs] = useState<SystemLog[]>([]);

  // Form inputs
  const [snippetContent, setSnippetContent] = useState("");
  const [snippetNote, setSnippetNote] = useState("");
  const [dirPath, setDirPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Interactive content viewer & filter states
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedItemType, setSelectedItemType] = useState<"snippet" | "file" | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [viewerContent, setViewerContent] = useState("");
  const [isFetchingViewerContent, setIsFetchingViewerContent] = useState(false);
  const [searchFilterType, setSearchFilterType] = useState<string>("all");

  // Simulation states & Local config overrides (for demonstrating Ollama locally vs Cloud preview)
  const [localGatewayMode, setLocalGatewayMode] = useState<"gemini" | "ollama">("gemini");
  const [selectedLLM, setSelectedLLM] = useState("qwen2.5:0.5b");
  const [selectedEmbed, setSelectedEmbed] = useState("nomic-embed-text");
  
  // UI states
  const [isSubmittingSnippet, setIsSubmittingSnippet] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isTrackingDir, setIsTrackingDir] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  // Poll database & status on load and periodically
  const fetchData = async () => {
    try {
      // Fetch Status
      const statusRes = await fetch("/api/status");
      if (statusRes.ok) {
        const data = await statusRes.json();
        setSystemStatus(data);
      }

      // Fetch Snippets
      const snippetsRes = await fetch("/api/snippets");
      if (snippetsRes.ok) {
        const data = await snippetsRes.json();
        setSnippets(data);
      }

      // Fetch Directories
      const dirsRes = await fetch("/api/directories");
      if (dirsRes.ok) {
        const data = await dirsRes.json();
        setDirectories(data);
      }

      // Fetch Files
      const filesRes = await fetch("/api/files");
      if (filesRes.ok) {
        const data = await filesRes.json();
        setFiles(data);
      }

      // Fetch Logs
      const logsRes = await fetch("/api/logs");
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data);
      }
    } catch (e) {
      console.error("Error communicating with full-stack IndexArc server:", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll logs panel
  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Form Submission: Raw text snippet ingestion
  const handleIngestSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snippetContent.trim()) return;

    setIsSubmittingSnippet(true);
    try {
      const response = await fetch("/api/snippets/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: snippetContent,
          user_note: snippetNote
        })
      });

      if (response.ok) {
        setSnippetContent("");
        setSnippetNote("");
        fetchData();
        setActiveTab("database");
      } else {
        const err = await response.json();
        alert(`Ingestion failed: ${err.error || "Unknown server error"}`);
      }
    } catch (err) {
      alert("Error sending snippet to gateway.");
    } finally {
      setIsSubmittingSnippet(false);
    }
  };

  // Directory tracker submission
  const handleTrackDirectory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirPath.trim()) return;

    setIsTrackingDir(true);
    try {
      const response = await fetch("/api/directories/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath })
      });

      if (response.ok) {
        setDirPath("");
        fetchData();
        setActiveTab("overview");
      } else {
        const err = await response.json();
        alert(`Could not track directory: ${err.error || "Path invalid or inaccessible"}`);
      }
    } catch (err) {
      alert("Network error tracking path.");
    } finally {
      setIsTrackingDir(false);
    }
  };

  // File drag-and-drop mechanics
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFileToUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileToUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileToUpload) return;

    setIsUploadingFile(true);
    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData
      });

      if (response.ok) {
        setFileToUpload(null);
        fetchData();
        setActiveTab("database");
      } else {
        alert("File ingestion failed. Check logs for detail.");
      }
    } catch (err) {
      alert("Error uploading file.");
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Perform vector semantic search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, n_results: 6 })
      });

      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.results || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  // Delete snippets
  const handleDeleteSnippet = async (id: number) => {
    if (confirm("Permanently delete this snippet and purge its vector context?")) {
      try {
        const res = await fetch(`/api/snippets/${id}`, { method: "DELETE" });
        if (res.ok) fetchData();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Delete individual indexed file
  const handleDeleteFile = async (id: number) => {
    if (confirm("Permanently delete this file and purge all its text chunk embeddings from ChromaDB?")) {
      try {
        const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
        if (res.ok) fetchData();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Open Snippet content detail viewer
  const handleOpenSnippetViewer = (snip: Snippet) => {
    setSelectedItem(snip);
    setSelectedItemType("snippet");
    setViewerContent(snip.content);
    setIsViewerOpen(true);
  };

  // Open File content detail viewer (fetch from backend)
  const handleOpenFileViewer = async (file: IndexedFile) => {
    setSelectedItem(file);
    setSelectedItemType("file");
    setIsViewerOpen(true);
    setIsFetchingViewerContent(true);
    setViewerContent("");
    try {
      const res = await fetch(`/api/files/${file.id}/content`);
      if (res.ok) {
        const data = await res.json();
        setViewerContent(data.content || "No content extracted.");
      } else {
        setViewerContent("Failed to load file content from database.");
      }
    } catch (err) {
      setViewerContent("Error loading file content.");
    } finally {
      setIsFetchingViewerContent(false);
    }
  };

  // Stop tracking directories
  const handleDeleteDir = async (id: number) => {
    if (confirm("Stop tracking directory and terminate daemon filesystem watchers?")) {
      try {
        const res = await fetch(`/api/directories/${id}`, { method: "DELETE" });
        if (res.ok) fetchData();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Clipboard copying state & match highlight helper
  const [copiedHitIdx, setCopiedHitIdx] = useState<number | null>(null);
  const [copiedGeneral, setCopiedGeneral] = useState(false);

  const handleCopyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedHitIdx(index);
    setTimeout(() => setCopiedHitIdx(null), 1800);
  };

  const handleCopyGeneral = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedGeneral(true);
    setTimeout(() => setCopiedGeneral(false), 1800);
  };

  const highlightText = (text: string, query: string) => {
    if (!query || !query.trim()) return <span>{text}</span>;
    const words = query.split(/\s+/).filter(w => w.length > 1);
    if (words.length === 0) return <span>{text}</span>;
    
    try {
      const escapedWords = words.map(w => w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
      const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');
      const parts = text.split(regex);
      return (
        <span>
          {parts.map((part, i) => 
            regex.test(part) ? (
              <mark key={i} className="bg-yellow-500/25 text-amber-200 px-0.5 py-0.5 rounded font-medium">{part}</mark>
            ) : (
              part
            )
          )}
        </span>
      );
    } catch (e) {
      return <span>{text}</span>;
    }
  };

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen font-sans selection:bg-indigo-500/30 selection:text-white antialiased flex flex-col">
      {/* Upper Status Ribbon */}
      <div className="bg-slate-900 border-b border-slate-800 text-xs py-2 px-6 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="font-medium text-slate-300">IndexArc Local Instance Active</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">ChromaDB Path:</span>
            <span className="font-mono text-[11px] text-indigo-400 bg-slate-950/60 px-1.5 py-0.5 rounded">./data/chroma</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">SQLite DB:</span>
            <span className="font-mono text-[11px] text-teal-400 bg-slate-950/60 px-1.5 py-0.5 rounded">./data/indexarc.db</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Model:</span>
            <span className="font-mono text-[11px] text-amber-400 bg-slate-950/60 px-1.5 py-0.5 rounded">
              {localGatewayMode === "gemini" ? "gemini-3.5-flash" : selectedLLM}
            </span>
          </div>
        </div>
      </div>

      {/* Primary Header */}
      <header className="px-8 py-6 bg-slate-900/60 backdrop-blur-md border-b border-slate-800 flex flex-wrap justify-between items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 id="app-title" className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              IndexArc
              <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded border border-slate-700">v1.0.0</span>
            </h1>
            <p className="text-xs text-slate-400">Zero-Dependency Portable Knowledge Management & filesystem watch-dog daemon</p>
          </div>
        </div>

        {/* Local Ollama connection toggle for demoing sandbox vs desktop */}
        <div className="flex items-center gap-3 bg-slate-950 p-1.5 rounded-lg border border-slate-800">
          <button 
            onClick={() => setLocalGatewayMode("gemini")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${localGatewayMode === "gemini" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Cloud Gateway (AI Studio)
          </button>
          <button 
            onClick={() => setLocalGatewayMode("ollama")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${localGatewayMode === "ollama" ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-400 hover:text-slate-200"}`}
          >
            <Server className="w-3.5 h-3.5" />
            Local Ollama (Offline)
          </button>
        </div>
      </header>

      {/* Main Core Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Navigation Sidebar Panel */}
        <div className="space-y-6">
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab("overview")}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "overview" 
                  ? "bg-slate-800/80 text-white border-l-4 border-indigo-500 shadow" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <Terminal className="w-4 h-4" />
                <span>Overview & Console</span>
              </div>
              <ChevronRight className={`w-4 h-4 opacity-55 ${activeTab === "overview" ? "block" : "hidden"}`} />
            </button>

            <button
              onClick={() => setActiveTab("snippets")}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "snippets" 
                  ? "bg-slate-800/80 text-white border-l-4 border-teal-500 shadow" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4" />
                <span>Raw Text Snippet</span>
              </div>
              <ChevronRight className={`w-4 h-4 opacity-55 ${activeTab === "snippets" ? "block" : "hidden"}`} />
            </button>

            <button
              onClick={() => setActiveTab("files")}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "files" 
                  ? "bg-slate-800/80 text-white border-l-4 border-sky-500 shadow" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <FilePlus2 className="w-4 h-4" />
                <span>File Ingestion</span>
              </div>
              <ChevronRight className={`w-4 h-4 opacity-55 ${activeTab === "files" ? "block" : "hidden"}`} />
            </button>

            <button
              onClick={() => setActiveTab("directories")}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "directories" 
                  ? "bg-slate-800/80 text-white border-l-4 border-indigo-500 shadow" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <Folder className="w-4 h-4" />
                <span>Directory Indexer</span>
              </div>
              <ChevronRight className={`w-4 h-4 opacity-55 ${activeTab === "directories" ? "block" : "hidden"}`} />
            </button>

            <button
              onClick={() => setActiveTab("search")}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "search" 
                  ? "bg-slate-800/80 text-white border-l-4 border-pink-500 shadow" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <Search className="w-4 h-4" />
                <span>Vector Semantic Query</span>
              </div>
              <ChevronRight className={`w-4 h-4 opacity-55 ${activeTab === "search" ? "block" : "hidden"}`} />
            </button>

            <button
              onClick={() => setActiveTab("database")}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "database" 
                  ? "bg-slate-800/80 text-white border-l-4 border-emerald-500 shadow" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <Database className="w-4 h-4" />
                <span>Local Database Explorer</span>
              </div>
              <ChevronRight className={`w-4 h-4 opacity-55 ${activeTab === "database" ? "block" : "hidden"}`} />
            </button>
          </nav>

          {/* Quick Stats Panel */}
          <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-indigo-400" />
              System Status Metrics
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800/80">
                <span className="text-xs text-slate-500">Pasted Snippets</span>
                <span className="font-mono font-bold text-teal-400">{systemStatus.stats.total_snippets}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800/80">
                <span className="text-xs text-slate-500">Tracked Directories</span>
                <span className="font-mono font-bold text-indigo-400">{systemStatus.stats.total_directories}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800/80">
                <span className="text-xs text-slate-500">Indexed Files</span>
                <span className="font-mono font-bold text-sky-400">{systemStatus.stats.total_files}</span>
              </div>
            </div>
          </div>

          {/* Active Model Configuration Settings */}
          <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Sliders className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-semibold text-slate-300">Model Ingestion Tuner</h3>
            </div>
            
            {localGatewayMode === "gemini" ? (
              <div className="text-xs text-slate-400 space-y-2">
                <p>Running in cloud-bridged gateway mode inside AI Studio environment.</p>
                <div className="p-2 rounded bg-indigo-950/40 border border-indigo-900/50 text-[11px] text-indigo-300">
                  <Sparkles className="w-3 h-3 inline-block mr-1 text-indigo-400" />
                  Classification model: <strong>gemini-3.5-flash</strong>
                </div>
                <div className="p-2 rounded bg-teal-950/40 border border-teal-900/50 text-[11px] text-teal-300">
                  <Sparkles className="w-3 h-3 inline-block mr-1 text-teal-400" />
                  Embedding model: <strong>gemini-embedding-2-preview</strong>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 space-y-1">
                  <AlertCircle className="w-4 h-4 inline-block mr-1" />
                  <span>Ollama daemon must be active locally on host post-export:</span>
                  <pre className="text-[10px] mt-1 bg-slate-950 p-1 rounded border border-slate-800 font-mono text-slate-300 select-all">ollama serve</pre>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Local LLM Classifier</label>
                  <select 
                    value={selectedLLM} 
                    onChange={(e) => setSelectedLLM(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="qwen2.5:0.5b">qwen2.5:0.5b (recommended)</option>
                    <option value="llama3.2:1b">llama3.2:1b</option>
                    <option value="mistral">mistral:latest</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Embedding Engine</label>
                  <select 
                    value={selectedEmbed} 
                    onChange={(e) => setSelectedEmbed(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="nomic-embed-text">nomic-embed-text (default)</option>
                    <option value="all-minilm">all-minilm:latest</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Display Panel */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* TAB 1: OVERVIEW & LIVE LOGS */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              
              {/* Architecture Intro banner */}
              <div className="relative bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 border border-slate-800 overflow-hidden">
                <div className="absolute top-0 right-0 p-8 text-indigo-500/10 pointer-events-none">
                  <Database className="w-48 h-48" />
                </div>
                <div className="relative max-w-xl">
                  <span className="text-xs bg-indigo-500/10 text-indigo-400 font-semibold px-2.5 py-1 rounded-full border border-indigo-500/20">Arch. Design</span>
                  <h2 className="text-xl font-bold text-white mt-3 mb-2">Completely Portable Local Vector Database</h2>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    IndexArc has been built from the ground up as a zero-dependency system operating strictly within the local workspace directory. It uses standard SQLite to log ingestion databases and persistent relative ChromaDB collections.
                  </p>
                  <div className="mt-4 flex gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/5 px-2.5 py-1 rounded border border-emerald-500/10">
                      <CheckCircle className="w-3.5 h-3.5" /> SQLite Table Transactions
                    </span>
                    <span className="flex items-center gap-1.5 text-indigo-400 bg-indigo-500/5 px-2.5 py-1 rounded border border-indigo-500/10">
                      <CheckCircle className="w-3.5 h-3.5" /> Hot Watchdog observer online
                    </span>
                  </div>
                </div>
              </div>

              {/* NEW: High-Fidelity Interactive Analytics Panel */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900/40 rounded-xl p-5 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Total Indexed Content</span>
                    <h3 className="text-2xl font-black text-white mt-1 font-mono tracking-tight">
                      {formatBytes(files.reduce((acc, f) => acc + (f.file_size || 0), 0) + snippets.reduce((acc, s) => acc + s.content.length, 0))}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Combined volume of file systems and raw pasted fragments indexed locally.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-800/60 flex justify-between items-center text-[10px] text-slate-500">
                    <span>Files: {files.length}</span>
                    <span>Snippets: {snippets.length}</span>
                  </div>
                </div>

                <div className="bg-slate-900/40 rounded-xl p-5 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Embedding Dimensions</span>
                    <h3 className="text-2xl font-black text-indigo-300 mt-1 font-mono tracking-tight">
                      768-D <span className="text-xs text-slate-500 font-normal">Vectors</span>
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Generating highly descriptive semantic mappings using Gemini dense vectors.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-800/60 flex justify-between items-center text-[10px] text-indigo-400/80">
                    <span>Model: gemini-embedding-2</span>
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                  </div>
                </div>

                <div className="bg-slate-900/40 rounded-xl p-5 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-teal-400 tracking-wider">System Classification Rate</span>
                    <h3 className="text-2xl font-black text-teal-300 mt-1 font-mono tracking-tight">
                      {snippets.length > 0 ? "100%" : "N/A"}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Automated classification & descriptive indexing on raw code blocks & secret keys.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-800/60 flex justify-between items-center text-[10px] text-teal-400/80">
                    <span>SQLite Status: Connected</span>
                    <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
                  </div>
                </div>
              </div>

              {/* Ingestion Distribution Chart */}
              <div className="bg-slate-900/40 rounded-xl p-6 border border-slate-800 space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Database Ingestion Categories</h3>
                    <p className="text-xs text-slate-500">Live proportional classification of indexed content streams</p>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    Total Items: {snippets.length + files.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  {/* SVG Bar Chart */}
                  <div className="space-y-3.5">
                    {[
                      { label: "API Keys", count: snippets.filter(s => s.type === "API Key").length, color: "bg-teal-500", text: "text-teal-400" },
                      { label: "Security Tokens", count: snippets.filter(s => s.type === "Token").length, color: "bg-sky-500", text: "text-sky-400" },
                      { label: "Code Snippets", count: snippets.filter(s => s.type === "Code Snippet").length, color: "bg-indigo-500", text: "text-indigo-400" },
                      { label: "General Notes", count: snippets.filter(s => s.type === "Note").length, color: "bg-amber-500", text: "text-amber-400" },
                      { label: "Indexed Files", count: files.length, color: "bg-pink-500", text: "text-pink-400" }
                    ].map((item, idx) => {
                      const total = snippets.length + files.length || 1;
                      const percentage = Math.round((item.count / total) * 100);
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-300 font-medium">{item.label}</span>
                            <span className={`font-mono font-bold ${item.text}`}>{item.count} <span className="text-slate-600 font-normal">({percentage}%)</span></span>
                          </div>
                          <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-900">
                            <div 
                              className={`h-full ${item.color} transition-all duration-1000`} 
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Circle Distribution Chart */}
                  <div className="flex justify-center md:border-l md:border-slate-850 md:pl-6">
                    <div className="relative w-40 h-40 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="40" fill="transparent" stroke="#0f172a" strokeWidth="10" />
                        {(() => {
                          let accumulatedPercent = 0;
                          const items = [
                            { count: snippets.filter(s => s.type === "API Key").length, color: "#14b8a6" },
                            { count: snippets.filter(s => s.type === "Token").length, color: "#0ea5e9" },
                            { count: snippets.filter(s => s.type === "Code Snippet").length, color: "#6366f1" },
                            { count: snippets.filter(s => s.type === "Note").length, color: "#f59e0b" },
                            { count: files.length, color: "#ec4899" }
                          ];
                          const total = snippets.length + files.length || 1;
                          const radius = 40;
                          const circumference = 2 * Math.PI * radius;

                          return items.map((item, i) => {
                            const percent = (item.count / total);
                            if (percent === 0) return null;
                            const strokeDasharray = `${percent * circumference} ${circumference}`;
                            const strokeDashoffset = -((accumulatedPercent / 100) * circumference);
                            accumulatedPercent += percent * 100;

                            return (
                              <circle
                                key={i}
                                cx="50"
                                cy="50"
                                r={radius}
                                fill="transparent"
                                stroke={item.color}
                                strokeWidth="10"
                                strokeDasharray={strokeDasharray}
                                strokeDashoffset={strokeDashoffset}
                                className="transition-all duration-1000"
                              />
                            );
                          });
                        })()}
                      </svg>
                      <div className="absolute flex flex-col items-center justify-center text-center">
                        <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Metrics</span>
                        <span className="text-xl font-extrabold text-white font-mono">{snippets.length + files.length}</span>
                        <span className="text-[9px] text-slate-400">Total Items</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Indicator grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Active Watchers status */}
                <div className="bg-slate-900/40 rounded-xl p-5 border border-slate-800/80">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Folder className="w-4.5 h-4.5 text-indigo-400" />
                      Active Daemon Watchers
                    </h3>
                    <span className="text-xs font-mono bg-slate-950 px-2 py-0.5 rounded text-indigo-400 border border-slate-800">
                      {directories.length} watched
                    </span>
                  </div>

                  {directories.length === 0 ? (
                    <div className="text-center py-6 text-slate-500 text-xs italic bg-slate-950/40 rounded-lg border border-slate-900">
                      No folders registered. Track a directory folder path below to start watching filesystem changes.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {directories.map((dir) => (
                        <div key={dir.id} className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex justify-between items-center text-xs">
                          <div className="flex flex-col gap-1 truncate max-w-[80%]">
                            <span className="font-mono text-slate-300 truncate">{dir.path}</span>
                            <span className="text-[10px] text-slate-500">Tracked since {new Date(dir.created_at).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                              dir.status === "Active" 
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse" 
                                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            }`}>
                              {dir.status}
                            </span>
                            <button 
                              onClick={() => handleDeleteDir(dir.id)}
                              className="text-slate-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Gateway Details */}
                <div className="bg-slate-900/40 rounded-xl p-5 border border-slate-800/80 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                      <Server className="w-4.5 h-4.5 text-teal-400" />
                      AI Embedding Gateway
                    </h3>
                    
                    {localGatewayMode === "gemini" ? (
                      <div className="space-y-3 text-xs text-slate-400">
                        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-lg text-emerald-400">
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                          <span>Gemini Developer Server Inbound Link OK</span>
                        </div>
                        <p>
                          Leveraging fully production-ready Gemini API routes proxying model requests server-side. High-fidelity classification, metadata structuring, and text embeddings are active.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3 text-xs text-slate-400">
                        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg text-amber-400">
                          <AlertCircle className="w-4 h-4 text-amber-400" />
                          <span>Ollama Endpoint Offline (Simulated Local Mode)</span>
                        </div>
                        <p>
                          Awaiting connection on <code className="bg-slate-950 px-1 py-0.5 rounded font-mono text-[10px] text-amber-400">http://localhost:11434</code>. Post-export, Ollama will run natively within your command line environment.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Vector Dimension: <strong className="font-mono text-slate-300">768-D</strong></span>
                    <span>Backend Port: <strong className="font-mono text-slate-300">3000</strong></span>
                  </div>
                </div>

              </div>

              {/* Console Watchdog Log panel */}
              <div className="bg-slate-900/80 rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
                <div className="bg-slate-900 border-b border-slate-800 px-5 py-3.5 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold font-mono tracking-wider text-slate-200">Watchdog Daemon Log Stream</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={fetchData}
                      className="p-1 text-slate-400 hover:text-white transition-colors"
                      title="Force Log Sync"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[10px] font-mono text-slate-500 uppercase">Live Console</span>
                  </div>
                </div>
                
                <div className="bg-slate-950 p-5 h-80 overflow-y-auto font-mono text-xs text-slate-400 space-y-2.5 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800">
                  {logs.length === 0 ? (
                    <div className="text-slate-600 italic">Console starting... Logging database operations and watcher scans</div>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className="flex gap-4 items-start hover:bg-slate-900/30 py-0.5 rounded px-1 transition-colors">
                        <span className="text-slate-600 select-none text-[10px] pt-0.5">{log.time}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold select-none ${
                          log.type === "DB" ? "bg-teal-500/10 text-teal-400 border border-teal-500/20" :
                          log.type === "WATCHDOG" ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" :
                          log.type === "LLM" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                          log.type === "VECTORSTORE" ? "bg-pink-500/10 text-pink-400 border border-pink-500/20" :
                          log.type === "INGESTER" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          log.type === "SEARCH" ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" :
                          "bg-slate-800 text-slate-400"
                        }`}>
                          {log.type}
                        </span>
                        <span className="text-slate-300 select-text flex-1 break-all">{log.message}</span>
                      </div>
                    ))
                  )}
                  <div ref={consoleBottomRef} />
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: RAW TEXT SNIPPET INGESTION */}
          {activeTab === "snippets" && (
            <div className="bg-slate-900/40 rounded-xl p-6 border border-slate-800 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <span className="p-1 rounded bg-teal-500/10 text-teal-400">📝</span>
                  Ingest Raw Text Snippet
                </h2>
                <p className="text-xs text-slate-400">
                  Paste code, config values, API credentials or miscellaneous notes. The gateway parses the structure, classifies content using LLMs, structures a dynamic title, and saves it in standard SQLite.
                </p>
              </div>

              <form onSubmit={handleIngestSnippet} className="space-y-4">
                <div>
                  <label className="block text-[11px] text-slate-500 uppercase tracking-wider mb-1">Snippet Raw Content</label>
                  <textarea
                    required
                    value={snippetContent}
                    onChange={(e) => setSnippetContent(e.target.value)}
                    placeholder="Paste tokens, code, keys, configurations, or texts..."
                    rows={8}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 uppercase tracking-wider mb-1">User Context Note (Optional)</label>
                  <input
                    type="text"
                    value={snippetNote}
                    onChange={(e) => setSnippetNote(e.target.value)}
                    placeholder="Provide additional contexts, descriptions or labels..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSubmittingSnippet || !snippetContent.trim()}
                    className="bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs py-2.5 px-6 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmittingSnippet ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Analyzing & Registering Snippet...
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        Analyze & Classify Snippet
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Classification instructions */}
              <div className="border-t border-slate-800/80 pt-6 space-y-3">
                <h3 className="text-xs font-semibold text-slate-300">Automated Snippet Categorization Matrix</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="bg-slate-950 p-3 rounded border border-slate-900 flex flex-col gap-1 text-center">
                    <KeyRound className="w-4 h-4 mx-auto text-teal-400" />
                    <span className="text-[10px] font-semibold text-slate-300">API Key</span>
                    <span className="text-[9px] text-slate-500">Regex AWS, Stripe, Slack client keys</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded border border-slate-900 flex flex-col gap-1 text-center">
                    <Tag className="w-4 h-4 mx-auto text-sky-400" />
                    <span className="text-[10px] font-semibold text-slate-300">Token</span>
                    <span className="text-[9px] text-slate-500">JWT, OAuth and Auth headers</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded border border-slate-900 flex flex-col gap-1 text-center">
                    <Code className="w-4 h-4 mx-auto text-indigo-400" />
                    <span className="text-[10px] font-semibold text-slate-300">Code Snippet</span>
                    <span className="text-[9px] text-slate-500">TypeScript, Python, XML code</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded border border-slate-900 flex flex-col gap-1 text-center">
                    <FileText className="w-4 h-4 mx-auto text-amber-400" />
                    <span className="text-[10px] font-semibold text-slate-300">Note</span>
                    <span className="text-[9px] text-slate-500">Plain description texts and comments</span>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: FILE UPLOAD INGESTION */}
          {activeTab === "files" && (
            <div className="bg-slate-900/40 rounded-xl p-6 border border-slate-800 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <span className="p-1 rounded bg-sky-500/10 text-sky-400">📁</span>
                  Ingest Individual Document File
                </h2>
                <p className="text-xs text-slate-400">
                  Select a document to index. The background parsing engine extracts readable text, splits content into overlapping chunks, creates embeddings with Gemini embedding APIs, and stores vectors inside the relative vector database.
                </p>
              </div>

              <form onSubmit={handleFileUpload} className="space-y-4">
                <div 
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all relative ${
                    dragActive 
                      ? "border-indigo-500 bg-indigo-500/5" 
                      : "border-slate-800 hover:border-slate-700 bg-slate-950/40"
                  }`}
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.json,.log"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  <div className="space-y-3">
                    <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-850 flex items-center justify-center mx-auto text-slate-400">
                      <FilePlus2 className="w-6 h-6 text-sky-400" />
                    </div>
                    {fileToUpload ? (
                      <div>
                        <p className="text-sm font-semibold text-white">{fileToUpload.name}</p>
                        <p className="text-xs text-teal-400 font-mono mt-1">{formatBytes(fileToUpload.size)}</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-300">Drag files here or click to choose from system explorer</p>
                        <p className="text-xs text-slate-500">Supports PDF, DOCX, TXT, MD, JSON, LOG (Max 10MB)</p>
                      </div>
                    )}
                  </div>
                </div>

                {fileToUpload && (
                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isUploadingFile}
                      className="bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs py-2.5 px-6 rounded-lg transition-all flex items-center gap-2"
                    >
                      {isUploadingFile ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Processing, Chunking & Embedding Document...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-3.5 h-3.5" />
                          Commit File Ingestion Pipeline
                        </>
                      )}
                    </button>
                  </div>
                )}
              </form>

              {/* Portable guidelines */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-850 space-y-2.5 text-xs">
                <h4 className="font-semibold text-slate-300">File Ingest Pipeline Specs</h4>
                <ul className="list-disc pl-4 space-y-1.5 text-slate-400 text-[11px] leading-relaxed">
                  <li><strong>Text Extraction:</strong> Standardized text scraping block scans files. PDF content is parsed using <code className="bg-slate-900 px-1 py-0.5 rounded font-mono text-indigo-400">pypdf</code>.</li>
                  <li><strong>Chunk Segmenting:</strong> Text chunks are split with 800 character windows and a 150 character overlap window to maintain cross-chunk continuity.</li>
                  <li><strong>Embedding:</strong> Dimensions mapped via <code className="bg-slate-900 px-1 py-0.5 rounded font-mono text-amber-400">gemini-embedding-2-preview</code> on port 3000.</li>
                </ul>
              </div>

            </div>
          )}

          {/* TAB 4: FOLDER WATCHER DIRECTORY TRACKING */}
          {activeTab === "directories" && (
            <div className="bg-slate-900/40 rounded-xl p-6 border border-slate-800 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <span className="p-1 rounded bg-indigo-500/10 text-indigo-400">⚡</span>
                  Track & Watch Folder Directory
                </h2>
                <p className="text-xs text-slate-400">
                  Register absolute filesystem paths (e.g. <code className="bg-slate-950 px-1 py-0.5 rounded font-mono text-teal-400">D:/MyFiles</code>). Watchdog daemon threads recursively scan target paths to process all supported document structures.
                </p>
              </div>

              <form onSubmit={handleTrackDirectory} className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] text-slate-500 uppercase tracking-wider mb-1">Absolute Directory Path</label>
                    <input
                      type="text"
                      required
                      value={dirPath}
                      onChange={(e) => setDirPath(e.target.value)}
                      placeholder="e.g., D:/ProjectDocuments or /home/user/workspace"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={isTrackingDir || !dirPath.trim()}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs py-3 px-6 rounded-lg transition-all flex items-center gap-2 h-[38px] disabled:opacity-50"
                    >
                      {isTrackingDir ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          Track Directory
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>

              {/* Simulation instructions */}
              <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4 text-xs text-indigo-300 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>Sandbox Environment Simulation</span>
                </div>
                <p className="leading-relaxed text-[11px] text-slate-400">
                  Because IndexArc is running inside a secure container preview, path scanning is simulated! When you track a mock path above, the directory watcher will create 3 mock files, parse them, index them, and register a background Watchdog daemon that streams live filesystem changes. Try tracking path: 
                  <code className="bg-slate-950/80 px-1.5 py-0.5 rounded font-mono text-teal-400 ml-1 border border-slate-850">D:/Vault</code>.
                </p>
              </div>

            </div>
          )}

          {/* TAB 5: VECTOR SEMANTIC QUERY */}
          {activeTab === "search" && (
            <div className="bg-slate-900/40 rounded-xl p-6 border border-slate-800 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <span className="p-1 rounded bg-pink-500/10 text-pink-400">🔍</span>
                  Vector Semantic Search Queries
                </h2>
                <p className="text-xs text-slate-400">
                  Search through all ingested documents, text snippets, and scanned file contents. The query is converted into a vector and cosine proximity comparisons identify semantic relevant matches.
                </p>
              </div>

              <form onSubmit={handleSearch} className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Ask a question or enter key phrases (e.g. 'AWS configuration' or 'IndexArc startup')"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-4 pr-12 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={isSearching || !searchQuery.trim()}
                    className="absolute right-2 top-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg p-1.5 transition-all disabled:opacity-55"
                  >
                    {isSearching ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </form>

              {/* Results display */}
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Semantic Database Hits</h3>
                  
                  {/* Interactive Category Filter Tag Pills */}
                  {searchResults.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      {[
                        { id: "all", label: "All Matches" },
                        { id: "file", label: "Files Only" },
                        { id: "snippet", label: "Snippets Only" },
                        { id: "credentials", label: "Credentials & Keys" }
                      ].map((pill) => (
                        <button
                          key={pill.id}
                          type="button"
                          onClick={() => setSearchFilterType(pill.id)}
                          className={`px-2.5 py-1 rounded-md border transition-all font-medium ${
                            searchFilterType === pill.id
                              ? "bg-pink-600/20 text-pink-400 border-pink-500/40"
                              : "bg-slate-950 text-slate-400 border-slate-850 hover:border-slate-700"
                          }`}
                        >
                          {pill.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {searchResults.length === 0 ? (
                  <div className="text-center py-10 bg-slate-950/40 border border-slate-900 rounded-xl text-slate-500 text-xs italic">
                    {searchQuery ? "No matches found. Check that you have ingested files or snippets." : "Awaiting search query query representation."}
                  </div>
                ) : (
                  (() => {
                    const filteredHits = searchResults.filter(hit => {
                      if (searchFilterType === "all") return true;
                      if (searchFilterType === "file") return hit.metadata.type === "file";
                      if (searchFilterType === "snippet") return hit.metadata.type === "snippet";
                      if (searchFilterType === "credentials") {
                        const fileLower = (hit.metadata.file_name || "").toLowerCase();
                        const textLower = (hit.text || "").toLowerCase();
                        return (
                          fileLower.includes("key") || 
                          fileLower.includes("token") || 
                          fileLower.includes("secret") || 
                          textLower.includes("api_key") || 
                          textLower.includes("bearer") || 
                          textLower.includes("secret")
                        );
                      }
                      return true;
                    });

                    if (filteredHits.length === 0) {
                      return (
                        <div className="text-center py-8 bg-slate-950/30 border border-slate-900/60 rounded-xl text-slate-500 text-xs italic">
                          No hits match the selected category filter.
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredHits.map((hit, idx) => {
                          // Try linking back to raw source files/snippets for the quick open button
                          const matchedFile = files.find(f => f.file_path === hit.metadata.source);
                          const matchedSnip = snippets.find(s => 
                            hit.metadata.source.includes(s.id.toString()) || 
                            hit.metadata.file_name.includes(s.title)
                          );

                          return (
                            <div key={idx} className="bg-slate-950 border border-slate-800/80 rounded-xl p-4.5 space-y-3 flex flex-col justify-between hover:border-slate-700 transition-all group">
                              <div className="space-y-2">
                                <div className="flex justify-between items-start gap-3">
                                  <span className="font-mono text-[10px] text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10 truncate max-w-[70%]" title={hit.metadata.file_name}>
                                    {hit.metadata.file_name}
                                  </span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                                      Score: {Math.round(hit.score * 100)}%
                                    </span>
                                    
                                    {/* Action: Copy Text */}
                                    <button
                                      onClick={() => handleCopyToClipboard(hit.text, idx)}
                                      className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded bg-slate-900 border border-slate-800"
                                      title="Copy chunk to clipboard"
                                    >
                                      {copiedHitIdx === idx ? (
                                        <span className="text-[9px] font-sans font-bold text-teal-400 px-0.5">Copied!</span>
                                      ) : (
                                        <Layers className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <p className="text-slate-300 text-xs leading-relaxed font-sans select-text whitespace-pre-wrap max-h-48 overflow-y-auto scrollbar-thin">
                                  {highlightText(hit.text, searchQuery)}
                                </p>
                              </div>
                              <div className="pt-2.5 border-t border-slate-900 flex justify-between items-center text-[9px] text-slate-500 font-mono">
                                <span className="truncate max-w-[150px]" title={hit.metadata.source}>{hit.metadata.source}</span>
                                
                                {/* Quick view source file linkage */}
                                {matchedFile ? (
                                  <button
                                    onClick={() => handleOpenFileViewer(matchedFile)}
                                    className="text-indigo-400 hover:text-indigo-300 font-sans font-medium text-[10px] transition-all flex items-center gap-1 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20"
                                  >
                                    View Source File
                                  </button>
                                ) : matchedSnip ? (
                                  <button
                                    onClick={() => handleOpenSnippetViewer(matchedSnip)}
                                    className="text-teal-400 hover:text-teal-300 font-sans font-medium text-[10px] transition-all flex items-center gap-1 bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20"
                                  >
                                    View Source Snippet
                                  </button>
                                ) : (
                                  hit.metadata.chunk_index !== undefined && <span>Chunk {hit.metadata.chunk_index}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>

            </div>
          )}

          {/* TAB 6: LOCAL DATABASE EXPLORER */}
          {activeTab === "database" && (
            <div className="space-y-6">
              
              {/* Table Toggle selectors */}
              <div className="bg-slate-900/40 rounded-xl p-6 border border-slate-800 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <Database className="w-5 h-5 text-teal-400" />
                      SQLite Local Database Tables
                    </h2>
                    <p className="text-xs text-slate-400">Inspect record transactions mapped to the IndexArc sqlite database schema.</p>
                  </div>
                  <button 
                    onClick={fetchData}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-850 hover:bg-slate-800 text-slate-300 text-xs transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Re-sync Tables
                  </button>
                </div>

                {/* Sub table 1: Snippets */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                    Table: snippets
                  </h3>
                  
                  {snippets.length === 0 ? (
                    <div className="text-center py-6 bg-slate-950/40 rounded-lg border border-slate-900 text-slate-500 text-xs italic">
                      Empty table snippets
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-850 bg-slate-950">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 border-b border-slate-850">
                            <th className="p-3 font-semibold w-16">id</th>
                            <th className="p-3 font-semibold w-24">type</th>
                            <th className="p-3 font-semibold w-48">title</th>
                            <th className="p-3 font-semibold">content</th>
                            <th className="p-3 font-semibold w-16 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900">
                          {snippets.map((snip) => (
                            <tr key={snip.id} className="hover:bg-slate-900/30 text-slate-300">
                              <td className="p-3 font-mono text-slate-500 text-[10px]">{snip.id.toString().slice(-6)}</td>
                              <td className="p-3">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                  {snip.type}
                                </span>
                              </td>
                              <td className="p-3 font-medium text-slate-200">{snip.title}</td>
                              <td className="p-3 font-mono text-[11px] max-w-xs truncate">{snip.content}</td>
                              <td className="p-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button 
                                    onClick={() => handleOpenSnippetViewer(snip)}
                                    className="text-slate-500 hover:text-teal-400 transition-all p-1"
                                    title="View snippet detail"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteSnippet(snip.id)}
                                    className="text-slate-500 hover:text-red-400 transition-all p-1"
                                    title="Delete snippet"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Sub table 2: Tracked Directories */}
                <div className="space-y-3 pt-4">
                  <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    Table: tracked_directories
                  </h3>
                  
                  {directories.length === 0 ? (
                    <div className="text-center py-6 bg-slate-950/40 rounded-lg border border-slate-900 text-slate-500 text-xs italic">
                      Empty table tracked_directories
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-850 bg-slate-950">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 border-b border-slate-850">
                            <th className="p-3 font-semibold w-16">id</th>
                            <th className="p-3 font-semibold">watch_path</th>
                            <th className="p-3 font-semibold w-24">status</th>
                            <th className="p-3 font-semibold w-32">created_at</th>
                            <th className="p-3 font-semibold w-16 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900">
                          {directories.map((dir) => (
                            <tr key={dir.id} className="hover:bg-slate-900/30 text-slate-300">
                              <td className="p-3 font-mono text-slate-500 text-[10px]">{dir.id.toString().slice(-6)}</td>
                              <td className="p-3 font-mono text-[11px] text-slate-200">{dir.path}</td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                                  dir.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" : "bg-amber-500/10 text-amber-400 border border-amber-500/25"
                                }`}>
                                  {dir.status}
                                </span>
                              </td>
                              <td className="p-3 text-slate-500 text-[11px]">{new Date(dir.created_at).toLocaleString()}</td>
                              <td className="p-3 text-center">
                                <button 
                                  onClick={() => handleDeleteDir(dir.id)}
                                  className="text-slate-500 hover:text-red-400 transition-all p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Sub table 3: Indexed files */}
                <div className="space-y-3 pt-4">
                  <h3 className="text-xs font-semibold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                    Table: indexed_files
                  </h3>
                  
                  {files.length === 0 ? (
                    <div className="text-center py-6 bg-slate-950/40 rounded-lg border border-slate-900 text-slate-500 text-xs italic">
                      Empty table indexed_files
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-850 bg-slate-950">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 border-b border-slate-850">
                            <th className="p-3 font-semibold w-16">id</th>
                            <th className="p-3 font-semibold w-40">file_name</th>
                            <th className="p-3 font-semibold w-24">size</th>
                            <th className="p-3 font-semibold">absolute_file_path</th>
                            <th className="p-3 font-semibold w-24">source</th>
                            <th className="p-3 font-semibold w-20">status</th>
                            <th className="p-3 font-semibold w-20 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900">
                          {files.map((f) => (
                            <tr key={f.id} className="hover:bg-slate-900/30 text-slate-300">
                              <td className="p-3 font-mono text-slate-500 text-[10px]">{f.id.toString().slice(-6)}</td>
                              <td className="p-3 font-medium text-slate-200">{f.file_name}</td>
                              <td className="p-3 font-mono text-[11px] text-slate-400">{formatBytes(f.file_size)}</td>
                              <td className="p-3 font-mono text-[10px] text-slate-500 max-w-xs truncate" title={f.file_path}>{f.file_path}</td>
                              <td className="p-3">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  f.source_type === "upload" ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                                }`}>
                                  {f.source_type}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className="text-xs font-semibold text-emerald-400">
                                  {f.status}
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button 
                                    onClick={() => handleOpenFileViewer(f)}
                                    className="text-slate-500 hover:text-indigo-400 transition-all p-1"
                                    title="View parsed file content"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteFile(f.id)}
                                    className="text-slate-500 hover:text-red-400 transition-all p-1"
                                    title="Permanently purge indexed file and embeddings"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>

            </div>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto bg-slate-950 border-t border-slate-900/80 py-6 text-center text-xs text-slate-600">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <p>IndexArc Knowledge Management portal. Powered by relative sqlite, ChromaDB and local Ollama pipeline.</p>
          <div className="flex gap-4">
            <a href="https://ollama.com" target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors flex items-center gap-1">
              Ollama.com <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-slate-800">|</span>
            <a href="https://github.com/chroma-core/chroma" target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors flex items-center gap-1">
              ChromaDB <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>

      {/* Dynamic Content Detail Drawer Overlay */}
      {isViewerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex justify-end" id="content-viewer-overlay">
          <div className="w-full max-w-2xl h-full bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl relative animate-slide-left">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${
                  selectedItemType === "snippet" 
                    ? "bg-teal-500/10 text-teal-400 border-teal-500/20" 
                    : "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                }`}>
                  {selectedItemType === "snippet" ? `Snippet: ${selectedItem?.type || "Raw"}` : "Document File Content"}
                </span>
                <h3 className="text-sm font-bold text-slate-100 mt-2 font-mono truncate max-w-md">
                  {selectedItemType === "snippet" ? selectedItem?.title : selectedItem?.file_name}
                </h3>
              </div>
              <button 
                onClick={() => setIsViewerOpen(false)}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 transition-colors"
              >
                ✕ Close
              </button>
            </div>

            {/* Content Container */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              
              {/* If we are fetching file content */}
              {isFetchingViewerContent ? (
                <div className="flex flex-col items-center justify-center h-48 space-y-3">
                  <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
                  <span className="text-xs text-slate-400">Loading extracted database text segments...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedItemType === "snippet" && selectedItem?.user_note && (
                    <div className="p-3.5 bg-amber-500/5 border border-amber-500/10 text-amber-300 text-xs rounded-lg">
                      <span className="font-semibold block mb-1">User Context Note:</span>
                      {selectedItem.user_note}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs text-slate-500">
                      <span>Database Extracted Text Representation</span>
                      <button 
                        onClick={() => handleCopyGeneral(viewerContent)}
                        className="text-indigo-400 hover:text-indigo-300 transition-colors text-[11px] font-semibold flex items-center gap-1 bg-indigo-500/5 border border-indigo-500/10 px-2 py-1 rounded cursor-pointer"
                      >
                        {copiedGeneral ? "✓ Copied Content!" : "Copy Raw Text"}
                      </button>
                    </div>
                    
                    {/* Plain/Code Raw Content Box */}
                    <pre className="p-4 bg-slate-950 rounded-xl border border-slate-850 font-mono text-xs text-slate-300 select-text whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto scrollbar-thin">
                      {viewerContent || "No text available."}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Footer metadata details */}
            <div className="p-5 border-t border-slate-850 bg-slate-950/60 flex flex-wrap justify-between items-center gap-3 text-[10px] text-slate-500 font-mono">
              <div className="space-y-0.5">
                <span>Created At: {selectedItem ? new Date(selectedItem.created_at || Date.now()).toLocaleString() : "N/A"}</span>
                {selectedItemType === "file" && (
                  <span className="block text-slate-500 truncate max-w-md">Path: {selectedItem?.file_path}</span>
                )}
              </div>
              <span className="text-slate-600 bg-slate-900 border border-slate-850 px-2 py-1 rounded">
                ID: {selectedItem?.id?.toString().slice(-8)}
              </span>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
