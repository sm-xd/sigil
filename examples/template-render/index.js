// template-render: fills a `${…}` template with the JSON on stdin.
// It compiles the template with new Function(), which is dynamic code: a NO_DYNAMIC_CODE claim on it breaks.
const template = process.argv[2] || "Hello, ${data.query ?? data.name ?? \"world\"}!";
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let data = {};
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { data = {}; }
  const render = new Function("data", "return `" + template + "`;"); // <- the sandbox refuses this and records it
  process.stdout.write(render(data) + "\n");
});
