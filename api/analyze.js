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

  // 1. Fetch site content
  let siteContent = '';
  let finalUrl = url.startsWith('http') ? url : 'https://' + url;

  try {
    const siteRes = await fetch(finalUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GEO-Research-Tool/1.0)',
        'Accept': 'text/html'
      }
    });
    const html = await siteRes.text();
    siteContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 2000);
  } catch (e) {
    siteContent = 'Conteúdo indisponível. Analise apenas pela URL: ' + finalUrl;
  }

  // 2. Claude API
  const prompt = `Você é especialista em GEO (Generative Engine Optimization), AEO (Answer Engine Optimization) e SEO com foco em Reddit para citação por LLMs.

Analise o site e identifique os melhores subreddits para a marca ser citada por IAs generativas (ChatGPT, Perplexity, Claude, Gemini).

URL: ${finalUrl}
Conteúdo: ${siteContent}

REGRAS:
- Priorize subreddits em inglês (maior peso nos dados de treino das IAs)
- Inclua 1 ou 2 subreddits em português quando relevante
- Foco em CITAÇÃO ALGORÍTMICA, não tráfego humano
- GEO: como criar conteúdo que LLMs vão citar como fonte
- AEO: como responder perguntas para aparecer em Perplexity e SearchGPT
- SEO: como gerar autoridade, backlinks e menções de marca via Reddit

Retorne APENAS JSON válido, sem markdown:
{
  "brand": {
    "name": "nome curto da marca",
    "niche": "nicho em português (máx 6 palavras)",
    "audience": "público-alvo (máx 8 palavras)",
    "topics": ["tema1", "tema2", "tema3", "tema4"]
  },
  "subreddits": [
    {
      "name": "nome_exato_do_subreddit",
      "language": "EN",
      "priority": "alta",
      "rationale": "Por que este subreddit é estratégico para esta marca. (1-2 frases)",
      "geo_strategy": "Como criar conteúdo para ser citado por LLMs aqui. (2 frases)",
      "aeo_strategy": "Como estruturar respostas para Perplexity e ChatGPT. (2 frases)",
      "seo_strategy": "Como gerar autoridade e menções de marca aqui. (2 frases)"
    }
  ]
}

Gere exatamente 5 subreddits. Ordene por prioridade decrescente.`;

  let analysis;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(25000)
    });

    const claudeData = await claudeRes.json();
    if (!claudeData.content || !claudeData.content[0]) {
      throw new Error('Resposta inválida da API Claude: ' + JSON.stringify(claudeData));
    }
    const raw = claudeData.content[0].text.replace(/```json|```/g, '').trim();
    analysis = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({ error: 'Erro na análise: ' + e.message });
  }

  // 3. Validar subreddits com Reddit API
  const validated = await Promise.all(
    (analysis.subreddits || []).map(async (sub) => {
      try {
        const r = await fetch(`https://www.reddit.com/r/${sub.name}/about.json`, {
          headers: { 'User-Agent': 'GEO-Research-Tool/1.0' },
          signal: AbortSignal.timeout(5000)
        });
        const rd = await r.json();
        return {
          ...sub,
          members: rd?.data?.subscribers || null,
          active: rd?.data?.accounts_active || null,
          exists: !rd?.error
        };
      } catch {
        return { ...sub, members: null, active: null, exists: true };
      }
    })
  );

  analysis.subreddits = validated;
  return res.status(200).json({ success: true, analysis });
};
