// Vercel Serverless Function - Anthropic proxy (CommonJS)
// POST { prompt } -> { ...parsedJson } | { error }
// env: ANTHROPIC_API_KEY

// 허용 도메인(우리 앱)에서 온 요청만 받도록 제한.
const ALLOWED_ORIGINS = [
  'https://nomi-host.github.io',
];

// IP별 호출 제한(간단형). Vercel 인스턴스가 살아있는 동안만 카운트되므로
// 완벽하진 않지만, 한 사람이 짧은 시간에 과도하게 호출하는 것을 억제한다.
const RATE_MAX = 10;            // 윈도 동안 허용 횟수
const RATE_WINDOW_MS = 60_000; // 1분
const hits = new Map();         // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  // 메모리 누적 방지: 맵이 너무 커지면 정리
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  // origin 제한
  if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'forbidden origin' });
    return;
  }

  // IP별 호출 제한
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    res.status(429).json({ error: '너무 많은 요청입니다. 잠시 후 다시 시도하세요.' });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'no ANTHROPIC_API_KEY' }); return; }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    const prompt = body.prompt;
    if (!prompt) { res.status(400).json({ error: 'no prompt' }); return; }
    // 비정상적으로 긴 프롬프트 차단(비용 폭주 방지)
    if (typeof prompt !== 'string' || prompt.length > 2000) {
      res.status(400).json({ error: 'prompt too long' });
      return;
    }

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
