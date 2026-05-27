import Firecrawl from '@mendable/firecrawl-js'

function unwrapScrapeResult(result) {
  const data = result?.data ?? result
  return {
    markdown: data?.markdown ?? null,
    html: data?.html ?? null,
    metadata: data?.metadata ?? null,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const { url } = req.body || {}
    if (!url) {
      return res.status(400).json({ ok: false, error: 'url is required' })
    }

    if (!process.env.FIRECRAWL_API_KEY) {
      return res.status(500).json({ ok: false, error: 'FIRECRAWL_API_KEY is not set' })
    }

    const firecrawl = new Firecrawl({
      apiKey: process.env.FIRECRAWL_API_KEY,
    })

    const result = await firecrawl.scrape(url, {
      formats: ['markdown', 'html'],
    })

    const { markdown, html, metadata } = unwrapScrapeResult(result)

    return res.status(200).json({
      ok: true,
      url,
      markdown,
      html,
      metadata,
    })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}
