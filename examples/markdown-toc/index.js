// markdown-toc: reads Markdown on stdin and prints a nested list of its headings with anchor links.
// Pure text transform: nothing outside stdin and stdout.
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (!m) continue;
    const slug = m[2].toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    out.push(`${"  ".repeat(m[1].length - 1)}- [${m[2]}](#${slug})`);
  }
  process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
});
