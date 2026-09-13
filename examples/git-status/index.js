// git-status: prints the working tree status of the current folder.
// It runs the git binary in a child process, which the sandbox never allows: a NO_CHILD_PROCESS claim on it breaks.
const { execSync } = require("child_process");
try {
  const out = execSync("git status --short", { encoding: "utf8" });
  process.stdout.write(out || "clean\n");
} catch (e) {
  console.log(`git refused: ${e.code || e.message}`);
}
