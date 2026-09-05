import React, { useState, useEffect } from "react";
import {
  X,
  Edit3,
  Copy,
  Check,
  Download,
  ExternalLink,
  Save,
  Clock,
  FileText,
  Type,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { VaultEntry, Settings } from "../types";
import { getTranslation } from "../utils/i18n";
import { isArabicText } from "../utils";
import { sanitizeNoteHtml } from "../sanitize";

interface NoteDetailModalProps {
  entry: VaultEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveEntry?: (id: string, updates: Partial<VaultEntry>) => Promise<void>;
  onReopenInScratchpad?: (title: string, contentHtml: string) => void;
  settings: Settings | null;
}

export const NoteDetailModal: React.FC<NoteDetailModalProps> = ({
  entry,
  isOpen,
  onClose,
  onSaveEntry,
  onReopenInScratchpad,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (entry) {
      setEditTitle(entry.name || "Untitled Note");
      const richContent = entry.raw_fragment || entry.notes || entry.value;
      setEditBody(richContent);
    }
  }, [entry]);

  if (!isOpen || !entry) return null;

  const richHtml = entry.raw_fragment && entry.raw_fragment.includes("<") ? sanitizeNoteHtml(entry.raw_fragment) : null;
  const plainText = entry.notes && entry.notes.trim() ? entry.notes : entry.value;
  const isArTitle = isArabicText(entry.name);
  const isArBody = isArabicText(plainText);

  const wordCount = plainText.trim().split(/\s+/).filter(Boolean).length;
  const charCount = plainText.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  const handleCopy = (text: string, typeLabel: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedType(typeLabel);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleExport = (format: "md" | "txt") => {
    const filename = `${entry.name.replace(/[^a-z0-9\u0600-\u06FF]/gi, "_") || "note"}.${format}`;
    const blob = new Blob([plainText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!onSaveEntry) return;
    setIsSaving(true);
    try {
      await onSaveEntry(entry.id, {
        name: editTitle,
        notes: editBody.replace(/<[^>]*>/g, ""),
        value: editBody.replace(/<[^>]*>/g, ""),
        raw_fragment: editBody,
      });
      setIsEditing(false);
    } catch {
      /* ignore */
    } finally {
      setIsSaving(false);
    }
  };

  const handleReopen = () => {
    if (onReopenInScratchpad) {
      onReopenInScratchpad(entry.name, richHtml || plainText.replace(/\n/g, "<br>"));
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md transition-all animate-fade-in">
      <div
        className={`rounded-2xl flex flex-col min-w-0 transition-all duration-300 shadow-2xl ${
          isMaximized ? "w-[98vw] h-[96vh]" : "w-full max-w-4xl max-h-[90vh]"
        }`}
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-glow)",
        }}
      >
        {/* Header */}
        <div
          className="p-4 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="p-2 rounded-xl shrink-0"
              style={{ background: "var(--accent-bg)", color: "var(--accent-bright)" }}
            >
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              {isEditing ? (
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  dir="auto"
                  className="w-full px-2 py-1 rounded text-base font-semibold focus:outline-none"
                  style={{
                    background: "var(--bg-input)",
                    border: "1px solid var(--accent-bright)",
                    color: "var(--text)",
                  }}
                />
              ) : (
                <h3
                  className={`text-base font-semibold truncate ${
                    isArTitle ? "font-arabic ar-text" : ""
                  }`}
                  dir={isArTitle ? "rtl" : "auto"}
                  style={{ color: "var(--text)" }}
                >
                  {entry.name}
                </h3>
              )}
              <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                <span>{new Date(entry.created_at).toLocaleDateString()}</span>
                <span>•</span>
                <span>{wordCount} words</span>
                <span>•</span>
                <span>~{readingTime} min read</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-2 rounded-xl transition-all hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--text-muted)" }}
              title={isMaximized ? "Restore Size" : "Maximize View"}
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl transition-all hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--text-muted)" }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Toolbar */}
        <div
          className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs"
          style={{ background: "var(--bg-base)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {onReopenInScratchpad && (
              <button
                type="button"
                onClick={handleReopen}
                className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-all"
                style={{
                  background: "var(--accent-bg)",
                  color: "var(--accent-bright)",
                  border: "1px solid var(--border-glow)",
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> Reopen in Scratchpad
              </button>
            )}

            <button
              type="button"
              onClick={() => handleCopy(plainText, "text")}
              className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
              style={{ background: "var(--bg-input)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              {copiedType === "text" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedType === "text" ? "Copied!" : "Copy Text"}
            </button>

            {richHtml && (
              <button
                type="button"
                onClick={() => handleCopy(richHtml, "html")}
                className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
                style={{ background: "var(--bg-input)", color: "var(--text)", border: "1px solid var(--border)" }}
              >
                {copiedType === "html" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <CodeIcon className="w-3.5 h-3.5" />}
                {copiedType === "html" ? "Copied!" : "Copy HTML"}
              </button>
            )}

            <div className="h-4 w-px bg-[var(--border)] mx-1 hidden sm:block" />

            <button
              type="button"
              onClick={() => handleExport("md")}
              className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
              style={{ background: "var(--bg-input)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              <Download className="w-3.5 h-3.5" /> .MD
            </button>
            <button
              type="button"
              onClick={() => handleExport("txt")}
              className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
              style={{ background: "var(--bg-input)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              <Download className="w-3.5 h-3.5" /> .TXT
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all"
                style={{ background: "var(--emerald)", color: "#000" }}
              >
                <Save className="w-3.5 h-3.5" /> {isSaving ? "Saving..." : "Save Changes"}
              </button>
            ) : (
              onSaveEntry && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-all"
                  style={{ background: "var(--bg-input)", color: "var(--cyan)", border: "1px solid var(--border)" }}
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit Note
                </button>
              )
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar leading-relaxed">
          {isEditing ? (
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              dir="auto"
              className="w-full h-full min-h-[300px] p-4 rounded-xl text-sm font-mono focus:outline-none transition-all resize-none"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--accent-bright)",
                color: "var(--text)",
              }}
            />
          ) : richHtml ? (
            <div
              className={`prose prose-invert max-w-none text-sm leading-relaxed ${
                isArBody ? "font-arabic ar-text" : ""
              }`}
              dir={isArBody ? "rtl" : "auto"}
              lang={isArBody ? "ar" : undefined}
              style={{ color: "var(--text)" }}
              dangerouslySetInnerHTML={{ __html: richHtml }}
            />
          ) : (
            <div
              className={`text-sm leading-relaxed whitespace-pre-wrap select-text break-words ${
                isArBody ? "font-arabic ar-text" : ""
              }`}
              dir={isArBody ? "rtl" : "auto"}
              lang={isArBody ? "ar" : undefined}
              style={{ color: "var(--text)" }}
            >
              {plainText}
            </div>
          )}
        </div>

        {/* Footer Stats Bar */}
        <div
          className="px-6 py-3 border-t flex items-center justify-between text-xs shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--bg-base)", color: "var(--text-muted)" }}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Type className="w-3.5 h-3.5" /> {charCount} characters
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Created {new Date(entry.created_at).toLocaleString()}
            </span>
          </div>

          <div className="text-[11px] font-mono" style={{ color: "var(--accent-bright)" }}>
            ID: {entry.id.slice(0, 8)}
          </div>
        </div>
      </div>
    </div>
  );
};

function CodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
