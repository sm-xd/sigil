// changelog-stamp: puts a "## <tag> — <date>" header above the notes on stdin.
// Declares RELEASE_TAG. The "released by" line reads USER too, which nobody declared: a
// NO_ENV_READ_OUTSIDE claim whose allowlist is just RELEASE_TAG breaks on it.
const tag = process.env.RELEASE_TAG || "unreleased";
const by = process.env.USER || "unknown"; // <- outside the allowlist; the sandbox records it
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const notes = Buffer.concat(chunks).toString("utf8").trim();
  process.stdout.write(`## ${tag} — ${new Date().toISOString().slice(0, 10)}\nreleased by ${by}\n\n${notes}\n`);
});
