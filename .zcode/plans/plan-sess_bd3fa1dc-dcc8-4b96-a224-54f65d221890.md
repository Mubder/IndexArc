# Complete Fix: Uncontrolled Editor + Owned History Stack

## Problem (root cause confirmed)
Four systems write to the same `contenteditable` DOM and conflict:
1. `onEditorInput` → `setTabs(content: editorRef.innerHTML)` — every keystroke pushes innerHTML back into React state
2. `dangerouslySetInnerHTML={{__html: active.content}}` — React re-applies that HTML, destroying DOM nodes the selection was anchored to → **selection disappears**
3. `document.execCommand("undo")` relies on the browser undo stack, but React's DOM replacement is an uncommandable op that fragments/clears it → **undo/redo broken**
4. Direct `innerHTML =` writes (rephrase `:534`, undo-rephrase `:556`, clear `:736`) bypass the undo stack entirely

No patch survives the next keystroke (5 failed git commits confirm this).

## Fix Strategy (in `ScratchpadTab.tsx` — one file, no new deps)
Keep `contenteditable` + existing HTML persistence model, but fix the architecture:

### A. Make the editor UNCONTROLLED (the core fix)
- Mount with `dangerouslySetInnerHTML` ONCE per tab switch via the existing `key={activeId}` remount — after that React NEVER re-applies HTML during editing.
- **Remove `active.content` from the editor's render path.** Use a seeded-html ref instead so the editor DOM is set imperatively on mount and left alone.
- `onEditorInput` writes to a **ref buffer** (`contentRef.current[activeId]`), NOT to React state while typing. This stops the re-render cycle that destroys the selection.
- A **debounced effect** reads the ref buffer and pushes to `tabs` state for persistence (localStorage + server) — so saving still works, just not synchronously per keystroke.

### B. Own the undo/redo history stack (replaces `execCommand("undo/redo")`)
- New `useEditorHistory(editorRef, activeId)` hook with: `push()` (snapshot innerHTML + a selection Range bookmark via `Range.cloneRange()`), `undo()`, `redo()`, `canUndo`, `canRedo`.
- `onEditorInput` calls `history.push()` debounced (~300ms) so each "word" is one entry, not each character.
- Toolbar Undo/Redo buttons call `history.undo()/redo()` — these restore both innerHTML AND the saved selection range. Immune to React reconciliation because it's OUR stack.
- Initial seed pushes the starting content as the first history entry.

### C. Single entry point for all external content writes
- New `setEditorHtml(html, {snapshot=true})` — one function that: updates the DOM, updates the ref buffer, pushes a history entry, and syncs to state for persistence.
- Replace the 3 scattered `editorRef.current.innerHTML = ...` writes (rephrase `:534`, undo-rephrase `:556`, clear `:736`) to call `setEditorHtml()`.
- Keep the existing `rephraseUndo` stack AS-IS (it's a separate rephrase-specific undo; doesn't conflict).

### D. Toolbar selection preservation (already correct, keep it)
- Keep `onMouseDown={(e) => e.preventDefault()}` on the toolbar container (the fix I added) — prevents buttons stealing focus so the live selection stays visible.
- `execFormat` now operates on a LIVE selection (not a restored saved-range), since focus never leaves the editor. Remove the `savedSelection` ref + `selectionchange` listener — no longer needed.
- Keep `document.execCommand("bold/italic/foreColor/...")` for formatting application — it's deprecated but still works for applying inline styles; the owned history stack makes undo work regardless.

### E. Preserve everything else untouched
- Arabic spellcheck overlay (`overlayHtml`/`overlayRef`) — reads from `active.content`; switch it to read from the ref buffer (debounced) so it stays in sync without forcing editor re-renders.
- Tab switching (`key={activeId}` remount) — still reseeds the editor on switch.
- Persistence (localStorage + `/api/scratchpad`) — unchanged, fed from ref buffer via debounce.
- Tab CRUD, archive, rephrase, analyze, copy — unchanged.

## Files Changed
- `src/components/ScratchpadTab.tsx` — the only file. All edits localized to:
  - State/refs section (~line 135-148): add `contentRef`, `useEditorHistory`, remove `savedSelection`
  - `execFormat` (~172-186): simplify — no saved-range restore needed
  - `onEditorInput` (~363-377): write to ref buffer + `history.push()` instead of `setTabs`
  - Add `setEditorHtml()` helper + `useEditorHistory` hook
  - External writes (~534, 556, 736): route through `setEditorHtml`
  - Editor JSX (~808-828): remove `dangerouslySetInnerHTML={{__html: active.content}}`, seed imperatively on mount via `useEffect` keyed on `activeId`
  - Undo/Redo buttons (~840, 850): call `history.undo()/redo()`, wire `canUndo/canRedo` to disabled state

## Verification
- `npx tsc --noEmit` — type check passes
- Manual: select text → move mouse to Bold → selection STAYS highlighted → click → bold applies to selection
- Undo/Redo buttons step through typed edits, not corrupted
- Rephrase + its undo still work; Clear still works; tab switch reseeds; persistence survives reload
- Arabic overlay still renders misspell marks