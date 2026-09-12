// Launch the installed IndexArc against a throwaway data root (render tests).
const { spawn } = require("child_process");
const path = require("path");
const exe = path.join(process.env.USERPROFILE, ".IndexArc", "IndexArc.exe");
const child = spawn(exe, [], {
  env: { ...process.env, INDEXARC_ROOT: path.join(__dirname, "..", "tmp", "render-test") },
  detached: true,
  stdio: "ignore",
});
child.unref();
console.log("launched pid", child.pid, "with INDEXARC_ROOT=tmp/render-test");
