import { supabase, hasSupabase } from './supabaseClient'
import { sampleCompanies, sampleContacts, bpSections } from '../data/seed'

const STORAGE_KEY = 'b2b-command-center-local-v1'

export function readLocal(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if(raw) return JSON.parse(raw)
  } catch {}
  return {
    companies: sampleCompanies,
    contacts: sampleContacts,
    tasks: [],
    notes: '',
    bp: bpSections,
    user: { name: 'Jose Barrantes de la Puente', role: 'Team Leader' },
    organizationId: null,
    cloudReady: false
  }
}

export function writeLocal(data){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export async function getProfile(){
  if(!hasSupabase) return null
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if(userError || !userData?.user) throw userError || new Error('Usuario no autenticado')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id, full_name, role')
    .eq('id', userData.user.id)
    .single()

  if(error) throw error
  return data
}

export async function loadCloudData(){
  const profile = await getProfile()
  const organizationId = profile.organization_id

  const [
    companiesRes,
    contactsRes,
    tasksRes,
    notesRes,
    bpRes,
    pendingRes,
    projectsRes,
    budgetRes
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('organization_id', organizationId).order('created_at', { ascending:false }),
    supabase.from('contacts').select('*').eq('organization_id', organizationId).order('created_at', { ascending:false }),
    supabase.from('tasks').select('*').eq('organization_id', organizationId).order('due_date', { ascending:true }),
    supabase.from('notes').select('*').eq('organization_id', organizationId).order('updated_at', { ascending:false }).limit(1),
    supabase.from('business_plan_sections').select('*').eq('organization_id', organizationId),
    supabase.from('pending_items').select('*').eq('organization_id', organizationId).order('created_at', { ascending:false }),
    supabase.from('projects').select('*').eq('organization_id', organizationId).order('created_at', { ascending:false }),
    supabase.from('budget_y26').select('*').eq('organization_id', organizationId).order('month', { ascending:true })
  ])

  const errors = [companiesRes, contactsRes, tasksRes, notesRes, bpRes, pendingRes, projectsRes, budgetRes]
    .filter(r => r.error)
    .map(r => r.error.message)

  if(errors.length) throw new Error(errors.join(' | '))

  return {
    companies: (companiesRes.data || []).map(normalizeCompany),
    contacts: (contactsRes.data || []).map(normalizeContact),
    tasks: tasksRes.data || [],
    notes: notesRes.data?.[0]?.body || '',
    bp: normalizeBusinessPlan(bpRes.data || [], pendingRes.data || [], projectsRes.data || [], budgetRes.data || []),
    user: { name: profile.full_name, role: profile.role },
    organizationId,
    cloudReady: true
  }
}

export async function seedCloudIfEmpty(){
  const profile = await getProfile()
  const organizationId = profile.organization_id

  const { count, error: countError } = await supabase
    .from('companies')
    .select('id', { count:'exact', head:true })
    .eq('organization_id', organizationId)

  if(countError) throw countError
  if(count && count > 0) return

  const companies = sampleCompanies.map(c => ({
    organization_id: organizationId,
    ruc: c.ruc,
    legal_name: c.legal_name,
    commercial_name: c.commercial_name,
    category: c.category,
    department: c.department,
    opportunity_stage: c.opportunity_stage,
    probability: c.probability,
    close_date: c.close_date,
    heat_score: c.heat
  }))

  const { data: insertedCompanies, error: companyError } = await supabase
    .from('companies')
    .insert(companies)
    .select('id, ruc')

  if(companyError) throw companyError

  const byRuc = Object.fromEntries((insertedCompanies || []).map(c => [c.ruc, c.id]))
  const demoCompanyMap = { 'demo-1': byRuc['20123456789'], 'demo-2': byRuc['20456789123'], 'demo-3': byRuc['20678912345'] }

  const contacts = sampleContacts
    .filter(c => demoCompanyMap[c.company_id])
    .map(c => ({
      organization_id: organizationId,
      company_id: demoCompanyMap[c.company_id],
      full_name: c.name,
      position: c.role,
      email: c.email,
      cel_1: c.phone,
      influence: c.influence
    }))

  if(contacts.length){
    const { error: contactError } = await supabase.from('contacts').insert(contacts)
    if(contactError) throw contactError
  }

  await upsertBusinessPlanDefaults(organizationId)
}

export async function upsertBusinessPlanDefaults(organizationId){
  const rows = [
    { organization_id: organizationId, section_key:'proposito', title:'Propósito', content: bpSections.proposito },
    { organization_id: organizationId, section_key:'objeciones', title:'Objeciones + Mensajes', content: { rows: bpSections.objeciones } },
    { organization_id: organizationId, section_key:'plan90', title:'Plan 90 días', content: { rows: bpSections.plan90 } },
    { organization_id: organizationId, section_key:'presupuesto', title:'Presupuesto Y26', content: { months:{} } }
  ]

  const { error } = await supabase
    .from('business_plan_sections')
    .upsert(rows, { onConflict:'organization_id,section_key' })

  if(error) throw error
}

export async function saveCompanyCloud(company, organizationId){
  const payload = {
    organization_id: organizationId,
    ruc: company.ruc || '',
    legal_name: company.legal_name || '',
    commercial_name: company.commercial_name || '',
    category: company.category || '',
    department: company.department || '',
    address: company.address || '',
    phone_1: company.phone_1 || '',
    corporate_email: company.corporate_email || '',
    website: company.website || '',
    opportunity_stage: company.opportunity_stage || 'prospeccion',
    probability: Number(company.probability || 0),
    close_date: company.close_date || null,
    heat_score: company.heat || company.heat_score || null,
    updated_at: new Date().toISOString()
  }

  if(company.id && !String(company.id).startsWith('local-') && !String(company.id).startsWith('demo-')){
    const { data, error } = await supabase.from('companies').update(payload).eq('id', company.id).select('*').single()
    if(error) throw error
    return normalizeCompany(data)
  }

  const { data, error } = await supabase.from('companies').insert(payload).select('*').single()
  if(error) throw error
  return normalizeCompany(data)
}

export async function upsertCompanyByRucCloud(company, organizationId){
  const payload = {
    organization_id: organizationId,
    ruc: company.ruc || '',
    legal_name: company.legal_name || '',
    commercial_name: company.commercial_name || '',
    category: company.category || '',
    department: company.department || '',
    address: company.address || '',
    phone_1: company.phone_1 || '',
    corporate_email: company.corporate_email || '',
    website: company.website || '',
    opportunity_stage: company.opportunity_stage || 'prospeccion',
    probability: Number(company.probability || 0),
    close_date: company.close_date || null,
    heat_score: company.heat_score || null,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('companies')
    .upsert(payload, { onConflict:'organization_id,ruc' })
    .select('*')
    .single()

  if(error) throw error
  return normalizeCompany(data)
}

export async function deleteCompanyCloud(id){
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if(error) throw error
}

export async function saveContactCloud(contact, organizationId){
  const payload = {
    organization_id: organizationId,
    company_id: contact.company_id,
    full_name: contact.name || contact.full_name || '',
    position: contact.role || contact.position || '',
    email: contact.email || '',
    cel_1: contact.phone || contact.cel_1 || '',
    influence: contact.influence || 'Evaluador'
  }

  if(contact.id && !String(contact.id).startsWith('local-') && !String(contact.id).startsWith('c')){
    const { data, error } = await supabase.from('contacts').update(payload).eq('id', contact.id).select('*').single()
    if(error) throw error
    return normalizeContact(data)
  }

  const { data, error } = await supabase.from('contacts').insert(payload).select('*').single()
  if(error) throw error
  return normalizeContact(data)
}

export async function insertImportedContactCloud(contact, organizationId, companyId){
  const payload = {
    organization_id: organizationId,
    company_id: companyId,
    full_name: contact.full_name || '',
    position: contact.position || '',
    email: contact.email || '',
    cel_1: contact.cel_1 || '',
    influence: contact.influence || 'Evaluador'
  }

  // Si ya existe un contacto con mismo nombre en la empresa, actualiza teléfono/email en vez de duplicar.
  if(payload.full_name){
    const { data: existing, error: findError } = await supabase
      .from('contacts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('company_id', companyId)
      .ilike('full_name', payload.full_name)
      .limit(1)

    if(findError) throw findError

    if(existing?.[0]?.id){
      const merged = {
        ...payload,
        position: payload.position || existing[0].position || '',
        email: payload.email || existing[0].email || '',
        cel_1: payload.cel_1 || existing[0].cel_1 || '',
        influence: payload.influence || existing[0].influence || 'Evaluador'
      }

      const { data, error } = await supabase
        .from('contacts')
        .update(merged)
        .eq('id', existing[0].id)
        .select('*')
        .single()

      if(error) throw error
      return normalizeContact(data)
    }
  }

  const { data, error } = await supabase.from('contacts').insert(payload).select('*').single()
  if(error) throw error
  return normalizeContact(data)
}

export async function deleteContactCloud(id){
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if(error) throw error
}

export async function saveTaskCloud(task, organizationId){
  const payload = {
    organization_id: organizationId,
    company_id: task.company_id || null,
    title: task.title || '',
    type: task.type || 'CRM',
    description: task.description || '',
    due_date: task.due_date,
    due_time: task.due_time || null,
    status: task.status || 'vigente'
  }

  if(task.id && !String(task.id).startsWith('local-')){
    const { data, error } = await supabase.from('tasks').update(payload).eq('id', task.id).select('*').single()
    if(error) throw error
    return data
  }

  const { data, error } = await supabase.from('tasks').insert(payload).select('*').single()
  if(error) throw error
  return data
}

export async function deleteTaskCloud(id){
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if(error) throw error
}

export async function saveNotesCloud(body, organizationId){
  const { data: existing, error: readError } = await supabase
    .from('notes')
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1)

  if(readError) throw readError

  if(existing?.[0]?.id){
    const { error } = await supabase.from('notes').update({ body, updated_at:new Date().toISOString() }).eq('id', existing[0].id)
    if(error) throw error
    return
  }

  const { error } = await supabase.from('notes').insert({ organization_id: organizationId, title:'Notas rápidas', body })
  if(error) throw error
}

export async function saveBusinessPlanSection(sectionKey, value, organizationId){
  const titleMap = { proposito:'Propósito', objeciones:'Objeciones + Mensajes', plan90:'Plan 90 días', presupuesto:'Presupuesto Y26' }
  const content = sectionKey === 'proposito' ? value : sectionKey === 'presupuesto' ? { months:value } : { rows:value }

  const { error } = await supabase
    .from('business_plan_sections')
    .upsert({ organization_id: organizationId, section_key: sectionKey, title: titleMap[sectionKey] || sectionKey, content, updated_at: new Date().toISOString() }, { onConflict:'organization_id,section_key' })

  if(error) throw error
}

function normalizeBusinessPlan(sections, pendingRows, projectRows, budgetRows){
  const base = JSON.parse(JSON.stringify(bpSections))
  for(const s of sections){
    if(s.section_key === 'proposito') base.proposito = s.content
    if(s.section_key === 'objeciones') base.objeciones = s.content?.rows || []
    if(s.section_key === 'plan90') base.plan90 = s.content?.rows || []
    if(s.section_key === 'presupuesto') base.presupuesto = s.content?.months || {}
  }
  if(pendingRows?.length) base.pendientes = pendingRows.map(p => ({ pendiente:p.pending, especificacion:p.specification, solicitud:p.requested_at, responsable:p.responsible, estado:p.status }))
  if(projectRows?.length) base.proyectos = projectRows.map(p => ({ nombre:p.name, estado:p.status, detalle:p.detail }))
  if(budgetRows?.length){
    const months = {}
    for(const row of budgetRows){
      const d = new Date(row.month)
      const key = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()]
      months[key] = row.target_amount || 0
    }
    base.presupuesto = months
  }
  return base
}

function normalizeCompany(c){
  return { ...c, heat: c.heat_score, opportunity_stage: c.opportunity_stage || 'prospeccion', probability: Number(c.probability || 0) }
}

function normalizeContact(c){
  return { ...c, name: c.full_name || [c.first_name, c.paternal_last_name, c.maternal_last_name].filter(Boolean).join(' '), role: c.position || c.role_area || '', phone: c.cel_1 || '', influence: c.influence || 'Evaluador' }
}
