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

const GENERIC_HEADINGS = [
  /por que elegir/i,
  /propuesta de valor/i,
  /nuestros servicios/i,
  /servicios/i,
  /soluciones/i,
  /inicio/i,
  /contacto/i,
]

const NAVIGATION_NOISE = [
  /^(inicio|home|contacto|blog|menu|leer mas|ver mas)$/i,
  /^(facebook|instagram|linkedin|youtube|twitter|x|whatsapp)$/i,
  /cookie|copyright|todos los derechos|politica de privacidad/i,
]

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

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function cleanText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\((?:https?:\/\/|mailto:|tel:)[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\\+/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/^#{1,6}\s*/g, '')
    .replace(/^[-*\u2022]\s*/g, '')
    .replace(/[*_`>|[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isGenericHeading(value) {
  const normalized = stripAccents(cleanText(value)).toLowerCase()
  return GENERIC_HEADINGS.some(pattern => pattern.test(normalized))
}

function isUsefulLine(value) {
  const cleaned = cleanText(value)
  if (cleaned.length < 18 || cleaned.length > 280) return false
  if (/^https?:\/\//i.test(cleaned)) return false
  if (NAVIGATION_NOISE.some(pattern => pattern.test(cleaned))) return false
  return !isGenericHeading(cleaned)
}

function unique(values, limit = 8) {
  const seen = new Set()
  const output = []
  for (const value of values) {
    const cleaned = cleanText(value)
    const key = stripAccents(cleaned).toLowerCase()
    if (!cleaned || seen.has(key)) continue
    seen.add(key)
    output.push(cleaned)
    if (output.length >= limit) break
  }
  return output
}

function pickLines(lines, pattern, limit = 6) {
  return unique(lines.filter(line => pattern.test(stripAccents(line))), limit)
}

function toSentenceList(values, fallback) {
  const items = unique(values, 10)
  return items.length ? items.join('\n') : fallback
}

function extractPrices(text) {
  const matches = [...String(text || '').matchAll(/(?:S\/\.?\s*|US\$\s*|USD\s*|\$\s*|soles?\s+)((?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?)(?!\d)(?:\s*(?:\/|por|al)\s*(?:mes|ano|unidad|vehiculo|placa|equipo|usuario))?/gi)]
  const prices = matches
    .map(match => cleanText(match[0]))
    .filter(price => {
      const amountText = price.match(/\d[\d.,]*/)?.[0] ?? ''
      const numeric = Number(amountText.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))
      if (numeric >= 1900 && numeric <= 2099 && !/[.,]\d{2}\b/.test(amountText)) return false
      return numeric > 0
    })

  const cleaned = unique(prices, 14)
  return cleaned.length
    ? cleaned.join('\n')
    : 'No se detectan precios p\u00fablicos en la p\u00e1gina analizada.'
}

function buildResumenEjecutivo(lines, { label, source_type, url }) {
  const signal = lines.find(line => /empresa|plataforma|solucion|servicio|flota|rastreo|telemetria|seguridad|operacion/i.test(stripAccents(line)))
  if (signal) {
    return `${label} presenta una oferta relacionada con ${cleanText(signal).replace(/\.$/, '')}. Desde una lectura comercial, la fuente funciona como ${source_type} y permite identificar mensajes, servicios y puntos de diferenciacion para comparar contra Geosatelital.`
  }
  return `${label} fue analizada como fuente de ${source_type} desde ${url}. La pagina no expone suficiente contenido estructurado, por lo que el resumen prioriza senales comerciales verificables y oportunidades B2B inferidas.`
}

function buildPropuestaValor(lines, headings, bullets, { label }) {
  const candidates = [
    ...pickLines(lines, /ofrec|brinda|permite|ayuda|especialista|lider|lidera|rastreo|telemetria|monitoreo|flota|seguridad|plataforma|app|alerta|control/i, 10),
    ...pickLines(bullets, /ofrec|brinda|permite|ayuda|rastreo|telemetria|monitoreo|flota|seguridad|plataforma|app|alerta|control/i, 6),
  ].filter(line => !isGenericHeading(line))

  const relevantHeadings = headings.filter(heading => isUsefulLine(heading))
  const base = unique([...candidates, ...relevantHeadings], 4)
  if (base.length) {
    return `${label} ofrece ${base.map(item => item.replace(/\.$/, '')).join(', ')}. Su valor comercial se concentra en convertir datos operativos en control, trazabilidad, alertas y evidencia para decisiones de flota y seguridad.`
  }

  return `${label} comunica una oferta orientada a resolver necesidades operativas y comerciales. El valor debe validarse contra evidencia de servicios, cobertura, soporte, plataforma y resultados medibles.`
}

function buildCommercialScore({ services, pains, differentiators, trustProofs, prices }) {
  let score = 35
  if (services.length >= 3) score += 18
  else if (services.length) score += 10
  if (pains.length >= 2) score += 12
  else if (pains.length) score += 6
  if (differentiators.length >= 2) score += 12
  else if (differentiators.length) score += 6
  if (trustProofs.length >= 2) score += 10
  else if (trustProofs.length) score += 5
  if (!prices.startsWith('No se detectan')) score += 8
  if (stripAccents(services.join(' ')).match(/rastreo|telemetria|flota|gps|monitoreo/i)) score += 5
  return Math.max(0, Math.min(100, score))
}

function buildStructuredSummary(markdown, { label, source_type, url }) {
  const text = String(markdown || '').slice(0, 80000)
  const rawLines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const lines = unique(rawLines.map(cleanText).filter(isUsefulLine), 180)
  const headings = unique(rawLines.filter(line => /^#{1,4}\s+/.test(line)).map(cleanText).filter(isUsefulLine), 40)
  const bullets = unique(rawLines.filter(line => /^[-*\u2022]\s+/.test(line)).map(cleanText).filter(isUsefulLine), 80)

  const serviciosList = unique([
    ...pickLines([...bullets, ...lines], /servicio|producto|plan|modulo|plataforma|solucion|rastreo|gps|telemetria|monitoreo|flota|seguridad|app|alerta|control|sensor|camara|combustible|conductor/i, 12),
  ], 10)

  const doloresList = unique([
    ...pickLines([...bullets, ...lines], /problema|dolor|riesgo|desafio|perdida|insegur|fraude|robo|accidente|multa|desperdicio|ineficien|sin visibilidad|puntos ciegos|parada|desvio|siniestro/i, 10),
  ], 10)

  const diferenciadoresList = unique([
    ...pickLines([...bullets, ...lines], /diferenc|ventaja|unico|ia|inteligencia artificial|24\/7|soporte|certific|experiencia|cobertura|integracion|web|movil|tiempo real|personaliz/i, 10),
  ], 10)

  const pruebasList = unique([
    ...pickLines([...bullets, ...lines], /cliente|caso|testimonio|certific|alianza|anos de experiencia|garantia|soporte 24\/7|homolog|cobertura|evidencia|reporte/i, 8),
  ], 8)

  const argumentosList = unique([
    ...pickLines([...bullets, ...lines], /beneficio|ahorro|control|evidencia|reporte|alerta|prevencion|roi|tco|trazabilidad|productividad|seguridad|reduccion|optimiza|mejora/i, 10),
    'Reduce puntos ciegos operativos al consolidar ubicacion, eventos y alertas en una plataforma accionable.',
    'Convierte incidentes de flota en evidencia para gestionar seguridad, costos y cumplimiento.',
  ], 10)

  const segmentosList = unique([
    ...pickLines([...bullets, ...lines], /empresa|flota|transporte|logistica|mineria|construccion|distribucion|particular|entidad publica|gobierno|retail|seguridad/i, 8),
  ], 8)

  const precios = extractPrices(text)
  const ai_summary = {
    resumen_ejecutivo: buildResumenEjecutivo(lines, { label, source_type, url }),
    propuesta_valor: buildPropuestaValor(lines, headings, bullets, { label }),
    servicios: toSentenceList(serviciosList, 'No se detectan servicios especificos publicados; revisar menu, secciones internas o contenido comercial complementario.'),
    segmentos: toSentenceList(segmentosList, 'Segmentos inferidos: empresas con flotas, operaciones logisticas, transporte, seguridad patrimonial y entidades con activos moviles.'),
    dolores_atacados: toSentenceList(doloresList, 'Dolores inferidos: falta de visibilidad operativa, riesgo de robo, costos no controlados, baja trazabilidad y reaccion tardia ante incidentes.'),
    diferenciadores: toSentenceList(diferenciadoresList, 'Diferenciadores a validar: plataforma, soporte, cobertura, alertas, reportes y capacidad de integracion con procesos operativos.'),
    pruebas_confianza: toSentenceList(pruebasList, 'No se detectan pruebas de confianza explicitas; validar clientes, certificaciones, casos de exito, soporte y garantias comerciales.'),
    precios,
    argumentos_comerciales: toSentenceList(argumentosList, 'Argumentos comerciales a validar: control operativo, trazabilidad, prevencion, reportes ejecutivos y reduccion de costos evitables.'),
    oportunidades_geosatelital: [
      'Convertir mensajes genericos del mercado en una oferta consultiva basada en KPIs de riesgo, continuidad operativa y costo evitable.',
      'Diferenciar Geosatelital con rastreo satelital, telemetria, alertas preventivas, evidencia operativa y seguimiento ejecutivo.',
      'Proponer pilotos por tipo de flota con linea base, indicadores semanales y cierre comercial por impacto medible.',
      'Atacar cuentas B2B donde la pagina revele flotas, seguridad, distribucion, transporte o activos moviles criticos.',
    ].join('\n'),
    pitch_por_decisor: {
      'Gerencia General': 'Geosatelital ayuda a convertir la operacion de flota en control ejecutivo: menos puntos ciegos, mejor trazabilidad, alertas oportunas y evidencia para decidir con impacto en continuidad, riesgo y rentabilidad.',
      Operaciones: 'Para Operaciones, Geosatelital prioriza visibilidad en tiempo real, telemetria, alertas y reportes que permiten reducir desvios, reaccionar antes ante incidentes y sostener disciplina operativa en campo.',
      Finanzas: 'Para Finanzas, la propuesta se centra en reducir costos evitables, sustentar ROI con indicadores de uso, incidentes y productividad, y proteger activos mediante informacion verificable.',
      Compras: 'Para Compras, Geosatelital ofrece una alternativa evaluable por cobertura, soporte, plataforma, evidencia de servicio y capacidad de acompanar pilotos con metricas claras antes de escalar.',
    },
    score_comercial: 0,
  }

  ai_summary.score_comercial = buildCommercialScore({
    services: serviciosList,
    pains: doloresList,
    differentiators: diferenciadoresList,
    trustProofs: pruebasList,
    prices: precios,
  })

  return {
    ai_summary,
    propuesta_valor: ai_summary.propuesta_valor,
    precios: ai_summary.precios,
    servicios: ai_summary.servicios,
    dolores_atacados: ai_summary.dolores_atacados,
    argumentos_comerciales: ai_summary.argumentos_comerciales,
    oportunidades_geosatelital: ai_summary.oportunidades_geosatelital,
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

    const item = {
      ...rows[0],
      ai_summary: summary.ai_summary,
    }

    return res.status(200).json({ ok: true, item })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}

export { buildStructuredSummary }
