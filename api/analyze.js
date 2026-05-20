module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL obrigatória' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });
  const finalUrl = url.startsWith('http') ? url : 'https://' + url;
  let siteContent = '';
  try {
    const siteRes = await fetch(finalUrl, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    });
    const html = await siteRes.text();
    siteContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 800);
  } catch (e) {
    siteContent = '';
  }
  const prompt = `Especialista em GEO, AEO e SEO. Identifique os melhores subreddits para a marca ser citada por LLMs.
Domínio: ${finalUrl}
${siteContent ? `Conteúdo: ${siteContent}` : ''}
Retorne APENAS JSON válido, sem markdown:
{
  "brand": {
    "name": "nome da marca",
    "niche": "nicho em português",
    "audience": "público-alvo",
    "topics": ["tema1", "tema2", "tema3"]
  },
  "subreddits": [
    {
      "name": "subreddit_name",
      "language": "EN",
      "priority": "alta",
      "rationale": "Por que é estratégico. (1 frase)",
      "geo_strategy": "Como ser citado por LLMs aqui. (1 frase)",
      "aeo_strategy": "Como estruturar respostas para Perplexity e ChatGPT. (1 frase)",
      "seo_strategy": "Como gerar autoridade e menções de marca. (1 frase)"
    }
  ]
}
Gere 5 subreddits: 4 em inglês e 1 em português. Ordene por prioridade decrescente.`;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(8000)
    });
    const claudeData = await claudeRes.json();
    if (!claudeData.content || !claudeData.content[0]) {
      throw new Error('Resposta inválida da API Claude: ' + JSON.stringify(claudeData));
    }
    const raw = claudeData.content[0].text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(raw);
    return res.status(200).json({ success: true, analysis });
  } catch (e) {
    return res.status(500).json({ error: 'Erro na análise: ' + e.message });
  }
};
