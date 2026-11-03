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
//
// `sensitive` (secret values): the clipboard is cleared after the configured
// delay (Settings → clipboard_clear_seconds, default 45 s) if it still holds
// the copied value — password-manager hygiene so a token doesn't sit on the
// clipboard forever.
export const SECRET_CLIPBOARD_CLEAR_MS = 45_000;
let secretClearMs = SECRET_CLIPBOARD_CLEAR_MS;

/** Called whenever settings load/change; 0 disables clearing. */
export function setSecretClipboardClearSeconds(seconds: number | undefined): void {
  const n = Number(seconds);
  secretClearMs = Number.isFinite(n) && n >= 0 ? Math.min(600, n) * 1000 : SECRET_CLIPBOARD_CLEAR_MS;
}

export async function copyTextToClipboard(
  text: string,
  opts: { sensitive?: boolean } = {}
): Promise<boolean> {
  const value = String(text ?? "");
  if (!value) return false;
  const clearAfterMs = opts.sensitive ? secretClearMs : 0;

  const bridge = window.electronAPI;
  if (bridge?.copyText) {
    try {
      if (await bridge.copyText(value, clearAfterMs)) return true;
    } catch {
      /* fall through */
    }
  }

  try {
    await navigator.clipboard.writeText(value);
    if (clearAfterMs) scheduleBrowserClear(value, clearAfterMs);
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
    if (ok && clearAfterMs) scheduleBrowserClear(value, clearAfterMs);
    return ok;
  } catch {
    return false;
  }
}

// Browser fallback: readText may be refused (permissions) — then we can't
// verify the clipboard still holds our value, so we leave it alone.
function scheduleBrowserClear(value: string, ms: number): void {
  setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText("");
    } catch {}
  }, ms);
}
