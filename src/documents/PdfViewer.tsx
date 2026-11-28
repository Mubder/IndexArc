import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// The worker is copied to dist/ by scripts/copy-pdf-worker.cjs and served by
// the local vault server. Chromium's built-in PDF plugin is no longer shipped
// with recent Electron, so pages are rendered with pdf.js instead.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

export function PdfViewer({ base64, name }: { base64: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [pages, setPages] = useState(0);

  useEffect(() => {
    const root = host.current;
    if (!root || !base64) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    let task: RenderTask | null = null;
    root.replaceChildren();
    setError("");
    setPages(0);

    (async () => {
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const loading = pdfjs.getDocument({ data: bytes });
        doc = await loading.promise;
        if (cancelled) return;
        setPages(doc.numPages);
        const scale = Math.min(2, Math.max(1, (root.clientWidth || 800) / 700));
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return;
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute("aria-label", `${name} page ${n}`);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          task = page.render({ canvas, canvasContext: ctx, viewport });
          await task.promise;
          if (cancelled) return;
          root.appendChild(canvas);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      try { task?.cancel(); } catch {}
      void doc?.destroy().catch(() => {});
      root.replaceChildren();
    };
  }, [base64, name]);

  return (
    <div className="h-full overflow-auto" data-doc-scroll>
      <div ref={host} className="pdf-pages" />
      {error && <p className="p-8 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      {!error && !pages && <p className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Rendering PDF…</p>}
    </div>
  );
}
