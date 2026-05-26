import * as XLSX from 'xlsx'

function norm(value){
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
}

function pick(row, aliases){
  const keys = Object.keys(row)
  for(const alias of aliases){
    const wanted = norm(alias)
    const key = keys.find(k => norm(k) === wanted)
    if(key && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key]
  }

  // fallback: contains match
  for(const alias of aliases){
    const wanted = norm(alias)
    const key = keys.find(k => norm(k).includes(wanted) || wanted.includes(norm(k)))
    if(key && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key]
  }

  return ''
}

function cleanRuc(v){
  const raw = String(v ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  return digits || raw
}

function cleanPhone(v){
  const raw = String(v ?? '').trim()
  if(!raw) return ''
  return raw.replace(/[^\d+]/g, '')
}

function cleanEmail(v){
  const raw = String(v ?? '').trim()
  if(!raw) return ''
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[0] : raw
}

export async function parseClientFile(file){
  const ext = file.name.split('.').pop().toLowerCase()
  let rows = []

  if(ext === 'csv'){
    const text = await file.text()
    const workbook = XLSX.read(text, { type:'string' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json(sheet, { defval:'' })
  }else{
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type:'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json(sheet, { defval:'' })
  }

  const companyByRuc = new Map()
  const contacts = []

  for(const row of rows){
    const ruc = cleanRuc(pick(row, [
      'RUC','Nro Documento','Nro. Documento','Número RUC','Numero RUC','NUMRUC','Documento','ID Cliente',
      'RUC Empresa','RUC Cliente','N° RUC','Nº RUC','N° Documento','Nº Documento'
    ]))
    if(!ruc) continue

    const company = {
      ruc,
      legal_name: pick(row, ['Razón Social','Razon Social','Empresa','Cliente','Nombre Empresa','Nombre o Razón Social','RazonSocial','RazSocial']),
      commercial_name: pick(row, ['Nombre Comercial','Comercial','Alias','Cliente Comercial','Nombre Fantasía','Nombre Fantasia']),
      category: pick(row, ['Categoría','Categoria','Sector','Rubro','Tipo de cliente','Actividad','Actividad Económica','Actividad Economica']),
      department: pick(row, ['Departamento','Región','Region','Ubicación','Ubicacion','Dpto']),
      address: pick(row, ['Dirección','Direccion','Domicilio Fiscal','Domicilio','Direccion Fiscal']),
      phone_1: cleanPhone(pick(row, ['Teléfono Empresa','Telefono Empresa','Teléfono','Telefono','Teléfono Fijo','Telefono Fijo','Central Telefónica','Central Telefonica'])),
      corporate_email: cleanEmail(pick(row, ['Correo Empresa','Email Empresa','Correo Corporativo','Email Corporativo','E-mail Empresa','Mail Empresa'])),
      website: pick(row, ['Web','Website','Página Web','Pagina Web','Sitio Web']),
      opportunity_stage: pick(row, ['Etapa','Pipeline','Estado Comercial','Estado Oportunidad']) || 'prospeccion',
      probability: Number(pick(row, ['Probabilidad','Probabilidad %','Score','Heat Score','% Probabilidad']) || 0),
      close_date: pick(row, ['Fecha Cierre','Fecha estimada de cierre','Cierre estimado','Fecha Estimada']) || null
    }

    if(!companyByRuc.has(ruc)){
      companyByRuc.set(ruc, company)
    }else{
      const current = companyByRuc.get(ruc)
      const merged = { ...current }
      for(const [k,v] of Object.entries(company)){
        if(v !== '' && v !== null && v !== 0) merged[k] = v
      }
      companyByRuc.set(ruc, merged)
    }

    const contactName = pick(row, [
      'Contacto','Nombre Contacto','Nombre Completo','Nombre','Representante','Persona de Contacto',
      'Nombre del Contacto','Contact Name','Nombres y Apellidos','Apellidos y Nombres'
    ])
    const contactEmail = cleanEmail(pick(row, [
      'Correo Contacto','Email Contacto','Email','Correo','E-mail','Mail','Correo Electrónico',
      'Correo Electronico','Email 1','Correo 1','E-mail Contacto','Mail Contacto','Correo laboral',
      'Email laboral','Email principal','Correo principal'
    ]))
    const contactPhone = cleanPhone(pick(row, [
      'Celular','Celular Contacto','Teléfono Contacto','Telefono Contacto','Móvil','Movil','WhatsApp',
      'Whatsapp','Cel','Cel.','Telefono Celular','Teléfono Celular','Movil Contacto','Móvil Contacto',
      'Phone','Mobile','Número Celular','Numero Celular','Nro Celular','Nro. Celular',
      'Celular 1','Celular1','Cel 1','Cel. 1','Teléfono 1','Telefono 1','Teléfono Móvil',
      'Telefono Movil'
    ]))
    const contactRole = pick(row, [
      'Cargo','Área','Area','Puesto','Rol','Cargo Contacto','Área Contacto','Area Contacto',
      'Posición','Posicion','Job Title'
    ])
    const influence = pick(row, ['Influencia','Tipo Contacto','Mapa de contacto','Rol de compra','Nivel de influencia']) || 'Evaluador'

    if(contactName || contactEmail || contactPhone){
      contacts.push({
        ruc,
        full_name: contactName,
        position: contactRole,
        email: contactEmail,
        cel_1: contactPhone,
        influence
      })
    }
  }

  return { companies: Array.from(companyByRuc.values()), contacts, totalRows: rows.length }
}
