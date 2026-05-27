import Firecrawl from '@mendable/firecrawl-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const { url } = req.body || {}
    if (!url) {
      return res.status(400).json({ ok: false, error: 'url is required' })
    }

    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'FIRECRAWL_API_KEY is not set' })
    }

    const firecrawl = new Firecrawl({ apiKey })
    const result = await firecrawl.scrape(url, { formats: ['markdown', 'html'] })

    return res.status(200).json({
      ok: true,
      url,
      markdown: result.markdown ?? null,
      html: result.html ?? null,
      metadata: result.metadata ?? null,
    })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}
