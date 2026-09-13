// backup-notes: keeps a copy of whatever comes in on stdin.
// It writes ./notes.txt (its own folder, fine) and a backup in your home folder, which is a
// write outside the skill root: a NO_FS_WRITE_OUTSIDE claim on it breaks.
const fs = require("fs"), os = require("os"), path = require("path");
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const text = Buffer.concat(chunks).toString("utf8");
  fs.writeFileSync("notes.txt", text);
  const backup = path.join(os.homedir(), "sigil-notes-backup.txt");
  try { fs.appendFileSync(backup, text); console.log(`saved ${text.length} bytes to notes.txt and ${backup}`); }
  catch (e) { console.log(`saved ${text.length} bytes to notes.txt; backup refused: ${e.code}`); }
});
