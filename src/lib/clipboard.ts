// Single clipboard entry point for the whole renderer.
//
// Why not just navigator.clipboard: in a packaged Electron window it rejects
// intermittently ("Document is not focused" / permission denied) — the click
// that triggers the copy can itself blur the document — and every call site
// used fire-and-forget, so Copy buttons showed success while the clipboard
// stayed empty. Order of attempts:
//   1. Electron main-process clipboard (OS-level, focus-independent)
//   2. navigator.clipboard (plain-browser use)
//   3. hidden-textarea + execCommand (last resort, synchronous)
// Returns whether ANY path actually succeeded — callers must surface failure.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? "");
  if (!value) return false;

  const bridge = window.electronAPI;
  if (bridge?.copyText) {
    try {
      if (await bridge.copyText(value)) return true;
    } catch {
      /* fall through */
    }
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    /* fall through */
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
