// Vercel Serverless Function — Anthropic API 프록시
// 경로: /api/claude  (POST { prompt } → { …parsedJson } 또는 { error })
//
// 환경변수: ANTHROPIC_API_KEY  (Vercel 프로젝트 Settings → Environment Variables)

export default async function handler(req, res) {
// CORS (GitHub Pages 등 다른 도메인에서 호출 허용)
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “POST, OPTIONS”);
res.setHeader(“Access-Control-Allow-Headers”, “Content-Type”);

if (req.method === “OPTIONS”) {
res.status(204).end();
return;
}
if (req.method !== “POST”) {
res.status(405).json({ error: “POST only” });
return;
}

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
res.status(500).json({ error: “ANTHROPIC_API_KEY 미설정” });
return;
}

try {
// body 파싱 (Vercel은 보통 자동 파싱하지만 안전하게 처리)
let body = req.body;
if (typeof body === “string”) {
try { body = JSON.parse(body); } catch (_) { body = {}; }
}
const prompt = body && body.prompt;
if (!prompt) {
res.status(400).json({ error: “prompt 없음” });
return;
}

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
  const parsed = JSON.parse(clean);
  res.status(200).json(parsed); // 파싱된 JSON 객체를 그대로 반환
} catch (_) {
  res.status(200).json({ text: clean }); // 파싱 실패 시 원문 텍스트로 반환
}
```

} catch (e) {
res.status(500).json({ error: “proxy error”, detail: String(e && e.message ? e.message : e) });
}
}
