import Firecrawl from '@mendable/firecrawl-js'
import { sql } from './_db.js'

function unwrapScrapeResult(result) {
  const data = result?.data ?? result
  return {
    markdown: data?.markdown ?? '',
    html: data?.html ?? null,
    metadata: data?.metadata ?? null,
  }
}

const SOURCE_TYPES = ['competidor', 'cliente', 'mercado', 'referencia']

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

function pickLines(lines, pattern, limit = 6) {
  return lines.filter(l => pattern.test(l)).slice(0, limit)
}

function buildStructuredSummary(markdown, { label, source_type, url }) {
  const text = (markdown || '').slice(0, 80000)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  const headings = lines.filter(l => /^#{1,3}\s+/.test(l)).map(l => l.replace(/^#+\s+/, ''))
  const bullets = lines.filter(l => /^[-*•]\s+/.test(l)).map(l => l.replace(/^[-*•]\s+/, ''))

  const priceMatches = [...text.matchAll(/(?:S\/\.?\s*|USD\s*|US\$|\$\s*|soles?\s*)[\d,.]+(?:\s*(?:\/\s*(?:mes|año|año|unidad|vehículo|placa))?)?/gi)]
    .map(m => m[0].trim())
  const preciosUnique = [...new Set(priceMatches)].slice(0, 14)
  const precios = preciosUnique.length
    ? preciosUnique.join('\n')
    : 'No se detectaron precios explícitos en la fuente. Revisar planes, cotizaciones o sección comercial del sitio.'

  const serviciosLines = [
    ...pickLines(bullets, /servicio|producto|plan|módulo|plataforma|solución|paquete|addon|add-on/i, 8),
    ...pickLines(lines, /servicio|producto|plan|módulo|plataforma|solución/i, 4),
  ]
  const servicios = [...new Set(serviciosLines)].slice(0, 10).join('\n') ||
    bullets.slice(0, 8).join('\n') ||
    'Servicios no estructurados claramente; revisar menú o secciones de producto en la URL analizada.'

  const propuesta_valor =
    headings.find(h => /propuesta|valor|por qué|why|beneficio|ventaja/i.test(h)) ||
    lines.find(l => /propuesta de valor|value proposition|nuestra propuesta/i.test(l)) ||
    bullets.find(l => /lider|líder|especialistas|ayudamos|ofrecemos|somos/i.test(l)) ||
    headings[0] ||
    `${label || 'Fuente'} — análisis de ${source_type} (${url})`

  const doloresLines = [
    ...pickLines(bullets, /problema|dolor|riesgo|desafío|pérdida|insegur|fraude|robo|accidente|multa|desperdicio|ineficien/i, 8),
    ...pickLines(lines, /problema|dolor|riesgo|desafío|pérdida|sin visibilidad|puntos ciegos/i, 4),
  ]
  const dolores_atacados = [...new Set(doloresLines)].slice(0, 10).join('\n') ||
    'Dolores inferidos: falta de visibilidad operativa, riesgo en flota, costos ocultos y reacción tardía ante incidentes.'

  const argumentosLines = [
    ...pickLines(bullets, /beneficio|ventaja|garantía|resultado|ahorro|control|evidencia|reporte|alerta|prevención|roi|tco/i, 8),
    ...pickLines(lines, /beneficio|ventaja|garantía|ahorro|control|evidencia/i, 4),
  ]
  const argumentos_comerciales = [...new Set(argumentosLines)].slice(0, 10).join('\n') ||
    'Argumentos a validar con el cliente: control operativo, trazabilidad, prevención y medición de resultados.'

  const geoBase = [
    'Posicionar telemetría y evidencia operativa frente a soluciones que solo muestran ubicación.',
    'Proponer piloto con KPIs de riesgo, continuidad operativa y costo evitable medible.',
    'Enfatizar alertas preventivas, trazabilidad verificable y reportes ejecutivos para gerencia.',
  ]
  if (/gps|rastreo|flota|logíst|transporte|monitoreo|telemetr/i.test(text)) {
    geoBase.push('Diferenciar Geosatelital con control preventivo, no solo tracking reactivo.')
  }
  if (source_type === 'competidor') {
    geoBase.push('Mapear brechas del competidor y convertirlas en mensajes de sustitución o upgrade.')
  }
  if (source_type === 'cliente') {
    geoBase.push('Alinear propuesta a dolores explícitos del cliente y casos de uso por vertical.')
  }
  const oportunidades_geosatelital = geoBase.slice(0, 6).join('\n')

  return {
    propuesta_valor,
    precios,
    servicios,
    dolores_atacados,
    argumentos_comerciales,
    oportunidades_geosatelital,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const { url, label, source_type } = req.body || {}

    if (!url) {
      return res.status(400).json({ ok: false, error: 'url is required' })
    }
    if (!label || !String(label).trim()) {
      return res.status(400).json({ ok: false, error: 'label is required' })
    }
    if (!source_type || !SOURCE_TYPES.includes(source_type)) {
      return res.status(400).json({ ok: false, error: `source_type must be one of: ${SOURCE_TYPES.join(', ')}` })
    }

    if (!process.env.FIRECRAWL_API_KEY) {
      return res.status(500).json({ ok: false, error: 'FIRECRAWL_API_KEY is not set' })
    }

    await ensureMarketIntelligenceTable()

    const firecrawl = new Firecrawl({
      apiKey: process.env.FIRECRAWL_API_KEY,
    })

    const scrapeResult = await firecrawl.scrape(url, {
      formats: ['markdown', 'html'],
    })
    const { markdown } = unwrapScrapeResult(scrapeResult)

    const summary = buildStructuredSummary(markdown, { label: String(label).trim(), source_type, url })

    const rows = await sql`
      INSERT INTO market_intelligence_sources (
        url, label, source_type,
        propuesta_valor, precios, servicios,
        dolores_atacados, argumentos_comerciales, oportunidades_geosatelital,
        markdown
      ) VALUES (
        ${url},
        ${String(label).trim()},
        ${source_type},
        ${summary.propuesta_valor},
        ${summary.precios},
        ${summary.servicios},
        ${summary.dolores_atacados},
        ${summary.argumentos_comerciales},
        ${summary.oportunidades_geosatelital},
        ${markdown}
      )
      RETURNING *
    `

    const item = rows[0]
    return res.status(200).json({ ok: true, item })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}
