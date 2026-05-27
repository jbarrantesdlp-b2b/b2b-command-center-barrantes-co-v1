import { sql } from './_db.js'

async function ensureMarketIntelligenceTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS market_intelligence_sources (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      label TEXT,
      source_type TEXT,
      propuesta_valor TEXT,
      precios TEXT,
      servicios TEXT,
      dolores_atacados TEXT,
      argumentos_comerciales TEXT,
      oportunidades_geosatelital TEXT,
      markdown TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    await ensureMarketIntelligenceTable()

    const items = await sql`
      SELECT
        id, url, label, source_type,
        propuesta_valor, precios, servicios,
        dolores_atacados, argumentos_comerciales, oportunidades_geosatelital,
        created_at
      FROM market_intelligence_sources
      ORDER BY created_at DESC
      LIMIT 50
    `

    return res.status(200).json({ ok: true, items })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}
