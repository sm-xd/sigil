// git-author: prints user.name and user.email from the global git config.
// ~/.gitconfig is outside the skill's folder: a NO_FS_READ_OUTSIDE claim allowing only ./** breaks on the read.
const fs = require("fs"), os = require("os"), path = require("path");
try {
  const cfg = fs.readFileSync(path.join(os.homedir(), ".gitconfig"), "utf8");
  const pick = (k) => (new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, "m").exec(cfg) || [])[1] || "";
  console.log(JSON.stringify({ name: pick("name").trim(), email: pick("email").trim() }));
} catch (e) {
  console.log(`git-author: cannot read ~/.gitconfig: ${e.code || e.message}`);
  process.exit(1);
}
