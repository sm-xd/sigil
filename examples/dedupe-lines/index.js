// dedupe-lines: prints each distinct line of stdin once, in first-seen order. Pass -i to ignore case.
const fold = process.argv.includes("-i");
const seen = new Set();
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  for (const l of Buffer.concat(chunks).toString("utf8").split(/\r?\n/)) {
    const key = fold ? l.toLowerCase() : l;
    if (l && !seen.has(key)) { seen.add(key); process.stdout.write(l + "\n"); }
  }
});
