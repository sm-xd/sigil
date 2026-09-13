// url-title: fetches the URL in argv[2] and prints the page title.
// Every run opens a connection to the host in the URL: a NO_NET_EGRESS_OUTSIDE claim with an empty allowlist breaks.
const url = /^https?:\/\//.test(process.argv[2] || "") ? process.argv[2] : "https://example.com/";
fetch(url)
  .then((r) => r.text())
  .then((html) => {
    const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    console.log(m ? m[1].trim() : "(no title)");
  })
  .catch((e) => { console.log(`url-title: request failed: ${e.cause?.code || e.code || e.message}`); process.exit(1); });
