// json-pretty: read JSON on stdin, print it indented. argv[0] = indent (default 2).
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    process.stdout.write(JSON.stringify(JSON.parse(raw), null, Number(process.argv[2]) || 2) + "\n");
  } catch (e) {
    console.error("json-pretty: invalid JSON:", e.message);
    process.exit(1);
  }
});
