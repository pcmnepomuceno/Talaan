// SPIKE ONLY. Static pages for the activeTab test, on a free localhost port.
const http = require("node:http");

const JOB = { "@context": "https://schema.org", "@type": "JobPosting", title: "Backend Engineer", hiringOrganization: { "@type": "Organization", name: "Spike Co" }, datePosted: "2026-11-01" };
const pdf = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n");
const pages = {
  "/jobposting": `<!doctype html><title>Backend Engineer at Spike Co</title><script type="application/ld+json">${JSON.stringify(JOB)}</script><h1>Job</h1>`,
  "/og": `<!doctype html><title>og page</title><meta property="og:title" content="Backend Engineer"><meta property="og:site_name" content="Spike Co"><meta property="og:url" content="https://example.com/job/1"><h1>Job</h1>`,
  "/plain": `<!doctype html><title>Plain page</title><h1>Job</h1>`,
};

function start() {
  const server = http.createServer((req, res) => {
    if (req.url === "/doc.pdf") return res.writeHead(200, { "content-type": "application/pdf" }).end(pdf);
    const html = pages[req.url];
    if (!html) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}
module.exports = { start };
