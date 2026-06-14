// Vercel Serverless Function - Anthropic proxy (CommonJS)
// POST { prompt } -> { ...parsedJson } | { error }
// env: ANTHROPIC_API_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async (req, res) => {
  for (const k in CORS) res.setHeader(k, CORS[k]);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'no ANTHROPIC_API_KEY' }); return; }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    const prompt = body.prompt;
    if (!prompt) { res.status(400).json({ error: 'no prompt' }); return; }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const text = await r.text();
    if (!r.ok) { res.status(502).json({ error: 'claude error', status: r.status, detail: text.slice(0, 500) }); return; }

    const data = JSON.parse(text);
    let out = '';
    const blocks = data.content || [];
    for (const b of blocks) { if (b.type === 'text') out += b.text + '\n'; }
    const clean = out.replace(/```json/g, '').replace(/```/g, '').trim();

    try { res.status(200).json(JSON.parse(clean)); }
    catch (e) { res.status(200).json({ text: clean }); }
  } catch (e) {
    res.status(500).json({ error: 'proxy error', detail: String(e && e.message ? e.message : e) });
  }
};
