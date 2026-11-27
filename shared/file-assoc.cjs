// @ts-check
// Windows file-type registration for the document window.
// The user turns each type on. Nothing is registered until then.

const KINDS = {
  md: { exts: [".md", ".markdown"], label: "Markdown file" },
  txt: { exts: [".txt", ".text", ".log"], label: "Text file" },
  json: { exts: [".json", ".jsonc"], label: "JSON file" },
  yaml: { exts: [".yaml", ".yml"], label: "YAML file" },
  data: { exts: [".toml", ".ini", ".cfg", ".conf", ".xml", ".csv", ".tsv"], label: "Text data file" },
  pdf: { exts: [".pdf"], label: "PDF file (read-only)" },
};

/**
 * @param {string} kind
 * @param {string} exe absolute path to IndexArc.exe
 * @returns {{ kind: string, exts: string[], id: string, label: string, command: string } | null}
 */
function associationPlan(kind, exe) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return null;
  const spec = KINDS[/** @type {keyof typeof KINDS} */ (kind)];
  if (!spec || typeof exe !== "string" || !exe.trim()) return null;
  const id = `IndexArc.${kind}`;
  return {
    kind,
    exts: spec.exts,
    id,
    label: `IndexArc ${spec.label}`,
    command: `"${exe}" "%1"`,
  };
}

module.exports = { associationPlan, KINDS };
