// Vercel Serverless Function — Anthropic API 프록시 (CommonJS)
// 경로: /api/claude  (POST { prompt } → { …parsedJson } 또는 { error })
// 환경변수: ANTHROPIC_API_KEY

module.exports = async (req, res) => {
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “POST, OPTIONS”);
res.setHeader(“Access-Control-Allow-Headers”, “Content-Type”);

if (req.method === “OPTIONS”) { res.status(204).end(); return; }
if (req.method !== “POST”) { res.status(405).json({ error: “POST only” }); return; }

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { res.status(500).json({ error: “ANTHROPIC_API_KEY 미설정” }); return; }

try {
let body = req.body;
if (typeof body === “string”) { try { body = JSON.parse(body); } catch (_) { body = {}; } }
if (!body || typeof body !== “object”) body = {};
const prompt = body.prompt;
if (!prompt) { res.status(400).json({ error: “prompt 없음” }); return; }

```
const r = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  }),
});

const text = await r.text();
if (!r.ok) {
  res.status(502).json({ error: "claude error", status: r.status, detail: text.slice(0, 500) });
  return;
}

const data = JSON.parse(text);
const out = (data.content || [])
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("\n");

const clean = out.replace(/```json|```/g, "").trim();
try {
  res.status(200).json(JSON.parse(clean));
} catch (_) {
  res.status(200).json({ text: clean });
}
```

} catch (e) {
res.status(500).json({ error: “proxy error”, detail: String(e && e.message ? e.message : e) });
}
};
