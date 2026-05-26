import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CalendarDays, LayoutDashboard, Users, Target, Settings, LogOut, Plus, Save, Search, Trash2, CheckCircle2, NotebookPen, Cloud, Upload } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, Cell } from 'recharts'
import { supabase, hasSupabase } from './lib/supabaseClient'
import { pipelineStages } from './data/seed'
import { parseClientFile } from './lib/importer'
import {
  readLocal, writeLocal, loadCloudData, seedCloudIfEmpty, saveCompanyCloud, upsertCompanyByRucCloud, deleteCompanyCloud,
  saveContactCloud, insertImportedContactCloud, deleteContactCloud, saveTaskCloud, deleteTaskCloud, saveNotesCloud, saveBusinessPlanSection
} from './lib/cloudStore'
import './styles.css'

function heatLabel(prob){ if(prob >= 75) return 'Muy caliente'; if(prob >= 50) return 'Caliente'; if(prob >= 25) return 'Tibio'; return 'Frío' }
function stageName(id){ return pipelineStages.find(s => s.id === id)?.name || id }

function AuthGate({ children }){
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(hasSupabase)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if(!hasSupabase){ setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(e){
    e.preventDefault(); setError('')
    if(!hasSupabase){ setError('Supabase no está configurado. Revise el archivo .env.'); return }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if(error) setError(error.message)
  }
  async function signOut(){ if(hasSupabase) await supabase.auth.signOut(); setSession(null) }

  if(loading) return <div className="loading">Cargando Command Center...</div>
  if(!session){
    return <main className="authPage"><section className="authCard">
      <div className="miniK">B2B Command Center · Barrantes Co.</div>
      <h1>Acceso corporativo privado</h1>
      <p>Ingreso conectado a Supabase Auth. Modo nube obligatorio.</p>
      <form onSubmit={signIn} className="authForm">
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="correo corporativo" type="email" />
        <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="contraseña" type="password" />
        {error && <div className="error">{error}</div>}
        <button className="btn dark">Ingresar</button>
      </form>
    </section></main>
  }
  return children({ signOut })
}

function App(){ return <AuthGate>{({ signOut }) => <CommandCenter signOut={signOut} />}</AuthGate> }

function CommandCenter({ signOut }){
  const [db, setDb] = useState(readLocal)
  const [view, setView] = useState('home')
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)
  const [query, setQuery] = useState('')
  const [month, setMonth] = useState(new Date())
  const [loadingCloud, setLoadingCloud] = useState(true)
  const [cloudError, setCloudError] = useState('')

  async function refreshCloud(seed=false){
    setLoadingCloud(true); setCloudError('')
    try{
      if(seed) await seedCloudIfEmpty()
      const data = await loadCloudData()
      setDb(data)
      setSelectedCompanyId(data.companies?.[0]?.id || null)
    }catch(err){ setCloudError(err.message || 'Error cargando Supabase') }
    finally{ setLoadingCloud(false) }
  }

  useEffect(() => { refreshCloud(true) }, [])
  useEffect(() => { if(!db.cloudReady) writeLocal(db) }, [db])
  useEffect(() => { if(!selectedCompanyId && db.companies?.[0]?.id) setSelectedCompanyId(db.companies[0].id) }, [db.companies, selectedCompanyId])

  const selectedCompany = db.companies.find(c => c.id === selectedCompanyId) || db.companies[0]
  const pipelineData = pipelineStages.map(stage => ({ name: stage.name, cuentas: db.companies.filter(c => c.opportunity_stage === stage.id).length }))

  async function importClientBase(file){
    if(!file) return
    try{
      const parsed = await parseClientFile(file)
      const rucToCompanyId = {}
      for(const company of parsed.companies){
        const saved = await upsertCompanyByRucCloud({ ...company, heat_score: heatLabel(Number(company.probability || 0)) }, db.organizationId)
        rucToCompanyId[company.ruc] = saved.id
      }
      let importedContacts = 0
      for(const contact of parsed.contacts){
        const companyId = rucToCompanyId[contact.ruc]
        if(companyId){
          await insertImportedContactCloud(contact, db.organizationId, companyId)
          importedContacts++
        }
      }
      await refreshCloud(false)
      alert(`Importación completa: ${parsed.companies.length} empresas y ${importedContacts} contactos.`)
    }catch(err){
      alert(`Error importando base: ${err.message}`)
    }
  }

  async function saveCompany(updated){
    const normalized = { ...updated, heat: heatLabel(Number(updated.probability || 0)), heat_score: heatLabel(Number(updated.probability || 0)) }
    const saved = await saveCompanyCloud(normalized, db.organizationId)
    setDb(prev => ({ ...prev, companies: prev.companies.some(c => c.id === updated.id) ? prev.companies.map(c => c.id === updated.id ? saved : c) : [saved, ...prev.companies] }))
    setSelectedCompanyId(saved.id)
  }
  function addCompany(){
    const newCompany = { id:`local-${crypto.randomUUID()}`, ruc:'', legal_name:'Nueva empresa', commercial_name:'', category:'', department:'', opportunity_stage:'prospeccion', probability:5, close_date:new Date().toISOString().slice(0,10), heat:'Frío' }
    setDb(prev => ({ ...prev, companies:[newCompany, ...prev.companies] })); setSelectedCompanyId(newCompany.id); setView('crm')
  }
  async function deleteCompany(id){ if(!String(id).startsWith('local-')) await deleteCompanyCloud(id); setDb(prev => ({ ...prev, companies:prev.companies.filter(c=>c.id!==id), contacts:prev.contacts.filter(c=>c.company_id!==id) })) }
  function addContact(companyId){ setDb(prev => ({ ...prev, contacts:[...prev.contacts, { id:`local-${crypto.randomUUID()}`, company_id:companyId, name:'Nuevo contacto', role:'Pendiente', email:'', phone:'', influence:'Evaluador' }] })) }
  async function updateContact(contact){ const saved = await saveContactCloud(contact, db.organizationId); setDb(prev => ({ ...prev, contacts:prev.contacts.map(c => c.id === contact.id ? saved : c) })) }
  async function deleteContact(id){ if(!String(id).startsWith('local-')) await deleteContactCloud(id); setDb(prev => ({ ...prev, contacts:prev.contacts.filter(c=>c.id!==id) })) }
  async function addTask(task){ const saved = await saveTaskCloud({ ...task, status:'vigente' }, db.organizationId); setDb(prev => ({ ...prev, tasks:[...prev.tasks, saved] })) }
  async function updateTask(task){ const saved = await saveTaskCloud(task, db.organizationId); setDb(prev => ({ ...prev, tasks:prev.tasks.map(t => t.id === task.id ? saved : t) })) }
  async function deleteTask(id){ await deleteTaskCloud(id); setDb(prev => ({ ...prev, tasks:prev.tasks.filter(t=>t.id!==id) })) }
  async function addTaskFromCompany(company){ await addTask({ title:`Seguimiento: ${company?.commercial_name || company?.legal_name || 'cliente'}`, type:'CRM', due_date:new Date().toISOString().slice(0,10), due_time:'09:00', company_id:company?.id || null }); setView('calendar') }
  async function saveNotes(body){ setDb(prev => ({ ...prev, notes:body })); await saveNotesCloud(body, db.organizationId) }
  async function updateBP(section, value){ setDb(prev => ({ ...prev, bp:{ ...prev.bp, [section]:value } })); if(['proposito','objeciones','plan90','presupuesto'].includes(section)) await saveBusinessPlanSection(section, value, db.organizationId) }
  function exportBackup(){ const blob = new Blob([JSON.stringify(db,null,2)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`b2b-command-center-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href) }

  return <div>
    <header className="topbar"><div><div className="brandTitle">B2B Command Center</div><div className="brandSub">Barrantes Co. · Plataforma privada corporativa</div></div>
      <nav className="nav">
        <button className={view==='home'?'navBtn active':'navBtn'} onClick={()=>setView('home')}><LayoutDashboard size={16}/>Portada</button>
        <button className={view==='crm'?'navBtn active':'navBtn'} onClick={()=>setView('crm')}><Users size={16}/>CRM</button>
        <button className={view==='business'?'navBtn active':'navBtn'} onClick={()=>setView('business')}><Target size={16}/>Business Plan</button>
        <button className={view==='calendar'?'navBtn active':'navBtn'} onClick={()=>setView('calendar')}><CalendarDays size={16}/>Calendario</button>
        <button className={view==='notes'?'navBtn active':'navBtn'} onClick={()=>setView('notes')}><NotebookPen size={16}/>Notas</button>
        <button className={view==='settings'?'navBtn active':'navBtn'} onClick={()=>setView('settings')}><Settings size={16}/>Config.</button>
        <button className="navBtn" onClick={signOut}><LogOut size={16}/>Salir</button>
      </nav></header>
    <main className="shell">
      <div className={`statusBar cloud ${view==='home' ? 'statusBarExec' : ''}`}><Cloud size={16}/> Supabase conectado: datos en nube {cloudError && <span className="errorInline">{cloudError}</span>} {loadingCloud && <span>Cargando...</span>} <button className="btn small" onClick={()=>refreshCloud(false)}>Actualizar nube</button></div>
      {view==='home' && <Home db={db} pipelineData={pipelineData} setView={setView}/>}
      {view==='crm' && <CRM db={db} query={query} setQuery={setQuery} selectedCompany={selectedCompany} setSelectedCompanyId={setSelectedCompanyId} saveCompany={saveCompany} addCompany={addCompany} deleteCompany={deleteCompany} addContact={addContact} updateContact={updateContact} deleteContact={deleteContact} addTaskFromCompany={addTaskFromCompany} importClientBase={importClientBase}/>}
      {view==='business' && <BusinessPlan db={db} updateBP={updateBP}/>}
      {view==='calendar' && <CalendarView db={db} addTask={addTask} updateTask={updateTask} deleteTask={deleteTask} month={month} setMonth={setMonth}/>}
      {view==='notes' && <Notes db={db} saveNotes={saveNotes}/>}
      {view==='settings' && <SettingsPanel db={db} exportBackup={exportBackup}/>}
    </main></div>
}

function Home({ db, pipelineData, setView }){
  const companies = db.companies || []
  const contacts = db.contacts || []
  const tasks = db.tasks || []

  function safeNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0 }
  function localISODate(d){
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    return x.toISOString().slice(0, 10)
  }
  function parseISODate(s){
    if(!s) return null
    const d = new Date(`${s}T00:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  function daysDiff(from, to){
    return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
  }
  function addDays(d, days){
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
  }

  const today = new Date()
  const todayStr = localISODate(today)
  const activeOppsCount = companies.filter(c => c.opportunity_stage !== 'cierre_perdido').length
  const avgProb = Math.round(companies.reduce((s, c) => s + safeNum(c.probability), 0) / Math.max(companies.length, 1))
  const hotAccounts = companies.filter(c => safeNum(c.probability) >= 75).length
  const tasksToday = tasks.filter(t => t.status !== 'hecha' && t.due_date === todayStr).length

  const totalCompanies = Math.max(companies.length, 1)
  const maxProb = Math.max(...companies.map(c => safeNum(c.probability)), 100)

  const pipelineChartData = pipelineStages.map(s => {
    const cuentas = companies.filter(c => c.opportunity_stage === s.id).length
    return { id: s.id, name: s.name, cuentas }
  })
  const stageCounts = pipelineChartData.reduce((acc, s) => { acc[s.id] = s.cuentas; return acc }, {})
  const maxStageCount = Math.max(...pipelineChartData.map(s => s.cuentas), 1)

  const topOpportunities = [...companies]
    .sort((a, b) => safeNum(b.probability) - safeNum(a.probability))
    .slice(0, 6)

  const upcomingTasks = [...tasks]
    .filter(t => t.status !== 'hecha')
    .filter(t => t.due_date && t.due_date >= todayStr)
    .sort((a, b) =>
      (a.due_date || '').localeCompare(b.due_date || '') ||
      (a.due_time || '').localeCompare(b.due_time || '')
    )
    .slice(0, 6)

  const overdueTasks = [...tasks]
    .filter(t => t.status !== 'hecha')
    .filter(t => t.due_date && t.due_date < todayStr)
    .sort((a, b) =>
      (a.due_date || '').localeCompare(b.due_date || '') ||
      (a.due_time || '').localeCompare(b.due_time || '')
    )

  const companyTaskCounts = tasks.reduce((acc, t) => {
    if(t.company_id){ acc[t.company_id] = (acc[t.company_id] || 0) + 1 }
    return acc
  }, {})

  const companiesWithoutFollowUp = companies
    .filter(c => (companyTaskCounts[c.id] || 0) === 0)

  const criticalWindowEnd = addDays(today, 30)
  const criticalOpps = companies.filter(c =>
    c.opportunity_stage !== 'cierre_perdido' &&
    safeNum(c.probability) >= 80
  ).filter(c => {
    const cd = parseISODate(c.close_date)
    return cd ? cd <= criticalWindowEnd : false
  })

  const conversionEstimated = (() => {
    const first = stageCounts['prospeccion'] || 0
    const end = stageCounts['negociacion'] || 0
    if(first <= 0) return 0
    return Math.round((end / first) * 100)
  })()

  const avgDaysByStage = pipelineStages.map(s => {
    const stageCompanies = companies
      .filter(c => c.opportunity_stage === s.id)
      .map(c => parseISODate(c.close_date))
      .filter(Boolean)
    if(!stageCompanies.length) return null
    const days = stageCompanies.map(d => daysDiff(today, d))
    const avg = Math.round(days.reduce((a, b) => a + b, 0) / days.length)
    return { id: s.id, etapa: s.name, dias: avg }
  }).filter(Boolean)

  const byCategory = companies.reduce((acc, c) => {
    const k = c.category || 'Sin categoría'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  const categoryData = Object.entries(byCategory)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const closeByMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    return { monthIdx: i, label: monthNames[d.getMonth()], cierres: 0 }
  })
  companies.forEach(c => {
    const cd = parseISODate(c.close_date)
    if(!cd) return
    const diffMonths = (cd.getFullYear() - today.getFullYear()) * 12 + (cd.getMonth() - today.getMonth())
    if(diffMonths >= 0 && diffMonths < 12) closeByMonth[diffMonths].cierres += 1
  })

  const contactsByCompany = contacts.reduce((acc, ct) => {
    const cid = ct.company_id
    if(!cid) return acc
    acc[cid] = (acc[cid] || 0) + 1
    return acc
  }, {})
  const topAccounts = Object.entries(contactsByCompany)
    .map(([company_id, count]) => {
      const comp = companies.find(c => c.id === company_id)
      return {
        company_id,
        count,
        name: comp?.commercial_name || comp?.legal_name || 'Cliente'
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  function makeSpark(value, seed){
    const base = Math.max(0, value)
    const points = Array.from({ length: 10 }, (_, i) => {
      const t = i / 9
      const trend = base * (0.62 + 0.46 * t)
      const wobble = Math.sin(t * Math.PI * 2 + seed * 1.37) * Math.max(1, base * 0.08)
      const v = Math.max(0, Math.round(trend + wobble))
      return { v }
    })
    return points
  }

  function ExecTooltip({ active, payload, label }){
    if(!active || !payload || !payload.length) return null
    const v = payload[0]?.value ?? 0
    return (
      <div className="execTooltip">
        <div className="execTooltipTitle">{label}</div>
        <div className="execTooltipValue">{v}</div>
      </div>
    )
  }

  const statusPill = (txt, accent) => (
    <span className="execPill" style={{ '--accent': accent }}>{txt}</span>
  )

  function KpiCard({ value, label, Icon, accent, indicator, sparkSeed, delay }){
    const numericValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0
    const meter = (() => {
      if(label === 'Empresas') return Math.round((activeOppsCount / totalCompanies) * 100)
      if(label === 'Contactos'){
        const avg = contacts.length / Math.max(companies.length, 1)
        return Math.round(Math.min(100, (avg / 8) * 100))
      }
      if(label === 'Oportunidades activas') return Math.round((activeOppsCount / totalCompanies) * 100)
      if(label === 'Probabilidad media') return Math.round(avgProb)
      if(label === 'Cuentas calientes') return Math.round((hotAccounts / Math.max(activeOppsCount, 1)) * 100)
      if(label === 'Tareas hoy') return Math.round((tasksToday / Math.max(tasks.filter(t => t.status !== 'hecha').length, 1)) * 100)
      return 50
    })()
    const spark = makeSpark(numericValue, sparkSeed)

    return (
      <div className="execCard execFadeIn" style={{ '--delay': `${delay}ms` }}>
        <div className="execKpiTop">
          <div className="execKpiIcon" style={{ '--accent': accent }}>
            <Icon size={18} />
          </div>
          <div className="execKpiValue">{value}</div>
        </div>
        <div className="execKpiLabel">{label}</div>
        <div className="execKpiFoot">
          <div className="execKpiMeta">
            <div className="execKpiIndicator">{indicator}</div>
            <div className="execKpiMiniMeter">
              <div className="execKpiMiniMeterFill" style={{ width: `${meter}%`, background: accent }} />
            </div>
          </div>
          <div className="execKpiSpark" aria-hidden="true">
            <AreaChart width={118} height={28} data={spark} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} isAnimationActive animationDuration={1150}>
              <defs>
                <linearGradient id={`spark-${sparkSeed}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={accent} strokeWidth={2} fill={`url(#spark-${sparkSeed})`} fillOpacity={1} />
            </AreaChart>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="execHome">
      <div className="execHeader">
        <div>
          <div className="execMiniK">Command Center · B2B</div>
          <h2 className="execTitle">Ruta 360°</h2>
          <p className="execSubtitle">Vista ejecutiva: pipeline, tareas, conversión y cierres estimados.</p>
        </div>
        <img className="execLogo" src="/assets/geosatelital-logo.webp" alt="Geosatelital" />
      </div>

      <div className="execKpis">
        <KpiCard
          value={companies.length}
          label="Empresas"
          Icon={LayoutDashboard}
          accent="#caa52e"
          indicator={`${activeOppsCount} activas`}
          sparkSeed={11}
          delay={0}
        />
        <KpiCard
          value={contacts.length}
          label="Contactos"
          Icon={Users}
          accent="#2ec5ff"
          indicator={`${Math.round(contacts.length / Math.max(companies.length, 1))} por empresa`}
          sparkSeed={22}
          delay={90}
        />
        <KpiCard
          value={activeOppsCount}
          label="Oportunidades activas"
          Icon={Target}
          accent="#22c55e"
          indicator={`${Math.round((activeOppsCount / totalCompanies) * 100)}% del total`}
          sparkSeed={33}
          delay={180}
        />
        <KpiCard
          value={`${avgProb}%`}
          label="Probabilidad media"
          Icon={Settings}
          accent="#caa52e"
          indicator={heatLabel(avgProb)}
          sparkSeed={44}
          delay={270}
        />
        <KpiCard
          value={hotAccounts}
          label="Cuentas calientes"
          Icon={NotebookPen}
          accent="#caa52e"
          indicator={`${Math.round((hotAccounts / Math.max(activeOppsCount, 1)) * 100)}% >= 75`}
          sparkSeed={55}
          delay={360}
        />
        <KpiCard
          value={tasksToday}
          label="Tareas hoy"
          Icon={CalendarDays}
          accent="#ef4444"
          indicator={tasksToday ? 'Pendientes' : 'OK'}
          sparkSeed={66}
          delay={450}
        />
      </div>

      <div className="execMainRow">
        <div className="execCard execChartCard execFadeIn" style={{ '--delay': `540ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Pipeline comercial</h3>
              <div className="execCardSub">Etapas por cantidad de cuentas</div>
            </div>
            {statusPill('Vivo', '#2ec5ff')}
          </div>

          <div className="execChartWrap">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={pipelineChartData} isAnimationActive animationDuration={1150} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(34,48,66,.9)" strokeDasharray="6 7" />
                <XAxis
                  dataKey="name"
                  stroke="#223042"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={70}
                />
                <YAxis stroke="#223042" tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  content={ExecTooltip}
                  cursor={{ fill: 'rgba(46,197,255,.10)' }}
                />
                <Bar dataKey="cuentas" barSize={22} radius={[10, 10, 0, 0]}>
                  {pipelineChartData.map((d, idx) => (
                    <Cell
                      key={`${d.id}-${idx}`}
                      fill={d.id === 'cierre_perdido' ? '#ef4444' : '#2ec5ff'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="execSideCol">
          <div className="execCard execSideCard execFadeIn" style={{ '--delay': `630ms` }}>
            <div className="execCardHead">
              <div>
                <h3 className="execCardTitle">Top oportunidades</h3>
                <div className="execCardSub">Orden por probabilidad</div>
              </div>
              {statusPill(`${hotAccounts} calientes`, '#caa52e')}
            </div>

            <div className="execList">
              {topOpportunities.length ? topOpportunities.map(c => {
                const prob = safeNum(c.probability)
                const pct = Math.round((prob / maxProb) * 100)
                const accent = prob >= 75 ? '#caa52e' : prob >= 50 ? '#2ec5ff' : '#94a3b8'
                return (
                  <div key={c.id} className="execListRow">
                    <div className="execListRowMain">
                      <div className="execListRowTitle">{c.commercial_name || c.legal_name}</div>
                      <div className="execListRowMeta">
                        <span className="execStage">{stageName(c.opportunity_stage)}</span>
                        <span className="execDot">•</span>
                        <span className="execProb">{prob}%</span>
                      </div>
                    </div>
                    <div className="execListRowMeter" aria-hidden="true">
                      <div className="execListRowMeterFill" style={{ width: `${pct}%`, background: accent }} />
                    </div>
                  </div>
                )
              }) : <div className="execEmpty">Sin oportunidades.</div>}
            </div>
          </div>

          <div className="execCard execSideCard execFadeIn" style={{ '--delay': `720ms` }}>
            <div className="execCardHead">
              <div>
                <h3 className="execCardTitle">Próximas tareas</h3>
                <div className="execCardSub">Pendientes desde hoy</div>
              </div>
              {statusPill(`${upcomingTasks.length}`, '#2ec5ff')}
            </div>

            <div className="execList">
              {upcomingTasks.length ? upcomingTasks.map(t => (
                <div key={t.id} className="execListRow execListRowTask">
                  <div className="execListRowMain">
                    <div className="execListRowTitle">{t.title}</div>
                    <div className="execListRowMeta">
                      <span className="execStage">{t.type || 'Tarea'}</span>
                      <span className="execDot">•</span>
                      <span className="execProb">{t.due_date} {t.due_time ? `· ${t.due_time}` : ''}</span>
                    </div>
                  </div>
                  <div className="execListRowMeter" aria-hidden="true">
                    <div className="execListRowMeterFill" style={{ width: `100%`, background: '#22c55e' }} />
                  </div>
                </div>
              )) : <div className="execEmpty">No hay tareas próximas.</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="execSecondRow">
        <div className="execCard execSecondCard execFadeIn" style={{ '--delay': `810ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Empresas por sector</h3>
              <div className="execCardSub">Top por categoría</div>
            </div>
            {statusPill(`${categoryData.length}`, '#2ec5ff')}
          </div>
          <div className="execChartWrap execChartWrapSmall">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryData} layout="vertical" isAnimationActive animationDuration={1100} margin={{ top: 10, right: 10, left: 40, bottom: 0 }}>
                <CartesianGrid stroke="rgba(34,48,66,.9)" strokeDasharray="6 7" />
                <XAxis type="number" stroke="#223042" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis dataKey="category" type="category" stroke="none" tick={{ fill: '#94a3b8', fontSize: 11 }} width={120} />
                <Tooltip content={ExecTooltip} />
                <Bar dataKey="count" barSize={16} radius={[10, 10, 10, 10]}>
                  {categoryData.map((_, idx) => (
                    <Cell key={idx} fill="#2ec5ff" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="execCard execSecondCard execFadeIn" style={{ '--delay': `900ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Cierres estimados</h3>
              <div className="execCardSub">Próximos 12 meses</div>
            </div>
            {statusPill('Estimado', '#caa52e')}
          </div>
          <div className="execChartWrap execChartWrapSmall">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={closeByMonth} isAnimationActive animationDuration={1200} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(34,48,66,.9)" strokeDasharray="6 7" />
                <XAxis dataKey="label" stroke="#223042" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={Math.ceil(closeByMonth.length / 6) - 1 || 0} />
                <YAxis stroke="#223042" tick={{ fill: '#94a3b8', fontSize: 10 }} allowDecimals={false} />
                <Tooltip content={ExecTooltip} />
                <Area type="monotone" dataKey="cierres" stroke="#caa52e" strokeWidth={2} fill="#caa52e" fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="execCard execSecondCard execFadeIn" style={{ '--delay': `990ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Embudo de conversión</h3>
              <div className="execCardSub">Progreso por etapa</div>
            </div>
            {statusPill(`${conversionEstimated}%`, '#22c55e')}
          </div>

          <div className="execFunnel">
            {pipelineStages.map((s, idx) => {
              const count = stageCounts[s.id] || 0
              const widthPct = Math.round((count / maxStageCount) * 100)
              const isLost = s.id === 'cierre_perdido'
              return (
                <div key={s.id} className={`execFunnelStep ${isLost ? 'execFunnelLost' : ''}`}>
                  <div className="execFunnelBarWrap">
                    <div className="execFunnelBar" style={{ width: `${Math.max(6, widthPct)}%`, background: isLost ? '#ef4444' : '#2ec5ff' }} />
                  </div>
                  <div className="execFunnelMeta">
                    <span className="execFunnelStage">{s.name}</span>
                    <span className="execFunnelCount">{count}</span>
                  </div>
                  {idx === 0 && <div className="execFunnelHint">Inicio</div>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="execCard execSecondCard execFadeIn" style={{ '--delay': `1080ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Top cuentas por contactos</h3>
              <div className="execCardSub">Relacionamiento activo</div>
            </div>
            {statusPill(`${topAccounts.length}`, '#2ec5ff')}
          </div>
          <div className="execList">
            {topAccounts.length ? topAccounts.map(a => {
              const max = Math.max(...topAccounts.map(x => x.count), 1)
              const pct = Math.round((a.count / max) * 100)
              return (
                <div key={a.company_id} className="execListRow execListRowSlim">
                  <div className="execListRowMain">
                    <div className="execListRowTitle">{a.name}</div>
                    <div className="execListRowMeta">
                      <span className="execStage">{a.count} contactos</span>
                    </div>
                  </div>
                  <div className="execListRowMeter" aria-hidden="true">
                    <div className="execListRowMeterFill" style={{ width: `${pct}%`, background: '#2ec5ff' }} />
                  </div>
                </div>
              )
            }) : <div className="execEmpty">Sin contactos.</div>}
          </div>
        </div>
      </div>

      <div className="execFooterRow">
        <div className="execCard execFooterCard execFadeIn" style={{ '--delay': `1170ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Tareas vencidas</h3>
              <div className="execCardSub">Pendientes por superar fecha</div>
            </div>
            {statusPill('Alertas', '#ef4444')}
          </div>
          <div className="execKpiBig">{overdueTasks.length}</div>
          <div className="execTinyList">
            {overdueTasks.slice(0, 4).map(t => (
              <div key={t.id} className="execTinyListRow">
                <span className="execTinyTitle">{t.title}</span>
                <span className="execTinyMeta">{t.due_date}{t.due_time ? ` · ${t.due_time}` : ''}</span>
              </div>
            ))}
            {!overdueTasks.length && <div className="execEmpty execEmptySmall">Sin vencimientos.</div>}
          </div>
        </div>

        <div className="execCard execFooterCard execFadeIn" style={{ '--delay': `1260ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Empresas sin seguimiento</h3>
              <div className="execCardSub">Sin tareas vinculadas</div>
            </div>
            {statusPill('Riesgo', '#caa52e')}
          </div>
          <div className="execKpiBig">{companiesWithoutFollowUp.length}</div>
          <div className="execTinyList">
            {companiesWithoutFollowUp.slice(0, 4).map(c => (
              <div key={c.id} className="execTinyListRow">
                <span className="execTinyTitle">{c.commercial_name || c.legal_name}</span>
                <span className="execTinyMeta">{stageName(c.opportunity_stage)}</span>
              </div>
            ))}
            {!companiesWithoutFollowUp.length && <div className="execEmpty execEmptySmall">OK: todo con seguimiento.</div>}
          </div>
        </div>

        <div className="execCard execFooterCard execFadeIn" style={{ '--delay': `1350ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Oportunidades críticas</h3>
              <div className="execCardSub">Prob. alta + cierre cercano</div>
            </div>
            {statusPill('Crítico', '#ef4444')}
          </div>
          <div className="execKpiBig">{criticalOpps.length}</div>
          <div className="execTinyList">
            {criticalOpps.slice(0, 4).map(c => (
              <div key={c.id} className="execTinyListRow">
                <span className="execTinyTitle">{c.commercial_name || c.legal_name}</span>
                <span className="execTinyMeta">{safeNum(c.probability)}% · {c.close_date || 'sin fecha'}</span>
              </div>
            ))}
            {!criticalOpps.length && <div className="execEmpty execEmptySmall">Sin urgencias.</div>}
          </div>
        </div>

        <div className="execCard execFooterCard execFadeIn" style={{ '--delay': `1440ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Conversión estimada</h3>
              <div className="execCardSub">Prospección → Negociación</div>
            </div>
            {statusPill('SaaS KPI', '#22c55e')}
          </div>
          <div className="execKpiBig execKpiBigGold">{conversionEstimated}%</div>
          <div className="execConversionRow">
            <div className="execConversionMeter">
              <div className="execConversionMeterFill" style={{ width: `${Math.max(0, Math.min(100, conversionEstimated))}%` }} />
            </div>
            <div className="execConversionHint">
              {stageCounts['prospeccion'] || 0} en inicio · {stageCounts['negociacion'] || 0} en fin
            </div>
          </div>
        </div>

        <div className="execCard execFooterCard execFadeIn" style={{ '--delay': `1530ms` }}>
          <div className="execCardHead">
            <div>
              <h3 className="execCardTitle">Días promedio por etapa</h3>
              <div className="execCardSub">A partir de la fecha de cierre</div>
            </div>
            {statusPill('Time-to-close', '#2ec5ff')}
          </div>
          <div className="execChartWrap execChartWrapSmall execAvgDaysChart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={avgDaysByStage} layout="vertical" isAnimationActive animationDuration={1350} margin={{ top: 10, right: 10, left: 60, bottom: 0 }}>
                <CartesianGrid stroke="rgba(34,48,66,.9)" strokeDasharray="6 7" />
                <XAxis type="number" stroke="#223042" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis dataKey="etapa" type="category" stroke="none" tick={{ fill: '#94a3b8', fontSize: 11 }} width={160} />
                <Tooltip content={ExecTooltip} />
                <Bar dataKey="dias" barSize={18} radius={[10, 10, 10, 10]}>
                  {avgDaysByStage.map(d => (
                    <Cell key={d.id} fill={d.id === 'cierre_perdido' ? '#ef4444' : '#2ec5ff'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!avgDaysByStage.length && <div className="execEmpty execEmptySmall">Sin cierres estimados.</div>}
        </div>
      </div>
    </section>
  )
}

function CRM({ db, query, setQuery, selectedCompany, setSelectedCompanyId, saveCompany, addCompany, deleteCompany, addContact, updateContact, deleteContact, addTaskFromCompany, importClientBase }){
  const filtered = db.companies.filter(c => [c.ruc,c.legal_name,c.commercial_name,c.category,c.department].join(' ').toLowerCase().includes(query.toLowerCase()))
  const contacts = db.contacts.filter(c => c.company_id === selectedCompany?.id)
  return <section className="crmGrid"><aside className="panel companyList"><div className="panelHead"><h2>CRM</h2><div className="row"><button className="btn dark" onClick={addCompany}><Plus size={16}/>Empresa</button><label className="btn gold"><Upload size={16}/>Cargar base<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>importClientBase(e.target.files?.[0])}/></label></div></div><label className="searchBox"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por RUC, nombre, categoría..." /></label><div className="scrollList">{filtered.map(c=><button key={c.id} className={selectedCompany?.id===c.id?'companyRow active':'companyRow'} onClick={()=>setSelectedCompanyId(c.id)}><b>{c.commercial_name || c.legal_name}</b><span>{c.ruc || 'Sin RUC'} · {stageName(c.opportunity_stage)} · {c.probability}%</span></button>)}</div></aside>
    {selectedCompany && <section className="panel detail"><div className="panelHead"><div><h2>Ficha cliente</h2><span>RUC como dato diferenciador</span></div><div className="row"><button className="btn gold" onClick={()=>addTaskFromCompany(selectedCompany)}><CalendarDays size={16}/>Agendar</button><button className="btn danger" onClick={()=>deleteCompany(selectedCompany.id)}><Trash2 size={16}/>Eliminar</button></div></div><CompanyForm company={selectedCompany} onSave={saveCompany}/><div className="subPanel"><div className="panelHead"><h3>Contactos múltiples</h3><button className="btn small" onClick={()=>addContact(selectedCompany.id)}><Plus size={14}/>Contacto</button></div><div className="contactGrid">{contacts.map(contact=><ContactCard key={contact.id} contact={contact} updateContact={updateContact} deleteContact={deleteContact}/>)}{!contacts.length && <p>Sin contactos asociados.</p>}</div></div></section>}</section>
}

function CompanyForm({ company, onSave }){
  const [form, setForm] = useState(company)
  useEffect(()=>setForm(company), [company.id])
  const change=(k,v)=>setForm(prev=>({...prev,[k]:v}))
  return <div className="formGrid">{[['ruc','RUC'],['legal_name','Razón social'],['commercial_name','Nombre comercial'],['category','Categoría'],['department','Departamento']].map(([k,l])=><label key={k}>{l}<input value={form[k] || ''} onChange={e=>change(k,e.target.value)}/></label>)}<label>Etapa<select value={form.opportunity_stage || 'prospeccion'} onChange={e=>change('opportunity_stage',e.target.value)}>{pipelineStages.map(s=><option key={s.id} value={s.id}>{s.name} ({s.range})</option>)}</select></label><label>Probabilidad %<input type="number" min="0" max="100" value={form.probability || 0} onChange={e=>change('probability',e.target.value)}/></label><label>Fecha estimada de cierre<input type="date" value={form.close_date || ''} onChange={e=>change('close_date',e.target.value)}/></label><div className="heatCard"><span>Heat Score</span><b>{heatLabel(Number(form.probability || 0))}</b></div><button className="btn dark saveBtn" onClick={()=>onSave(form)}><Save size={16}/>Guardar ficha</button></div>
}

function ContactCard({ contact, updateContact, deleteContact }){
  const [form, setForm] = useState(contact)
  useEffect(()=>setForm(contact), [contact.id])
  const change=(k,v)=>setForm(prev=>({...prev,[k]:v}))
  return <div className="contactCard"><input value={form.name || ''} onChange={e=>change('name',e.target.value)} placeholder="Nombre"/><input value={form.role || ''} onChange={e=>change('role',e.target.value)} placeholder="Cargo / área"/><input value={form.email || ''} onChange={e=>change('email',e.target.value)} placeholder="Email"/><input value={form.phone || ''} onChange={e=>change('phone',e.target.value)} placeholder="Teléfono"/><select value={form.influence || 'Evaluador'} onChange={e=>change('influence',e.target.value)}><option>Decisor</option><option>Champion</option><option>Evaluador</option><option>Usuario</option><option>Bloqueador</option></select><div className="row"><button className="btn small dark" onClick={()=>updateContact(form)}>Guardar</button><button className="btn small danger" onClick={()=>deleteContact(form.id)}>Quitar</button></div></div>
}

function BusinessPlan({ db, updateBP }){
  const [tab,setTab]=useState('proposito'); const bp=db.bp
  return <section className="panel"><div className="panelHead"><div><h2>Business Plan</h2><span>Growth Command · editable y conectado</span></div></div><div className="tabs">{['proposito','pipeline','plan90','objeciones','presupuesto','pendientes','proyectos'].map(t=><button key={t} className={tab===t?'tab active':'tab'} onClick={()=>setTab(t)}>{labelTab(t)}</button>)}</div>
    {tab==='proposito' && <div className="subPanel"><h3>Propósito</h3><textarea value={bp.proposito.body} onChange={e=>updateBP('proposito',{...bp.proposito, body:e.target.value})}/></div>}
    {tab==='pipeline' && <div className="stageGrid">{pipelineStages.map(s=><div className="stageCard" key={s.id}><b>{s.name}</b><span>{s.range}</span></div>)}</div>}
    {tab==='plan90' && <EditableRows rows={bp.plan90 || []} columns={['accion','dias','detalle','responsable']} onChange={rows=>updateBP('plan90',rows)}/>}
    {tab==='objeciones' && <EditableRows rows={bp.objeciones || []} columns={['decisor','mensaje','objecion','respuesta']} onChange={rows=>updateBP('objeciones',rows)}/>}
    {tab==='presupuesto' && <BudgetEditor bp={bp} updateBP={updateBP}/>}
    {tab==='pendientes' && <EditableRows rows={bp.pendientes || []} columns={['pendiente','especificacion','solicitud','responsable','estado']} onChange={rows=>updateBP('pendientes',rows)}/>}
    {tab==='proyectos' && <EditableRows rows={bp.proyectos || []} columns={['nombre','estado','detalle']} onChange={rows=>updateBP('proyectos',rows)}/>}</section>
}
function labelTab(t){return {proposito:'Propósito',pipeline:'Pipeline',plan90:'Plan 90 días',objeciones:'Objeciones + Mensajes',presupuesto:'Presupuesto Y26',pendientes:'Pendientes',proyectos:'Proyectos'}[t]}
function EditableRows({ rows, columns, onChange }){ const update=(i,k,v)=>onChange(rows.map((r,idx)=>idx===i?{...r,[k]:v}:r)); return <div><button className="btn dark" onClick={()=>onChange([...rows,Object.fromEntries(columns.map(c=>[c,'']))])}><Plus size={16}/>Agregar fila</button><div className="editableRows">{rows.map((row,i)=><div className="editableRow" key={i}>{columns.map(c=><label key={c}>{c}<input value={row[c] || ''} onChange={e=>update(i,c,e.target.value)}/></label>)}<button className="btn danger small" onClick={()=>onChange(rows.filter((_,idx)=>idx!==i))}>Eliminar</button></div>)}</div></div> }
function BudgetEditor({ bp, updateBP }){ const months=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; const budget=bp.presupuesto || {}; return <div className="budgetGrid">{months.map(m=><label key={m}>{m.toUpperCase()} 2026<input type="number" value={budget[m] || 0} onChange={e=>updateBP('presupuesto',{...budget,[m]:Number(e.target.value)})}/></label>)}</div> }

function CalendarView({ db, addTask, updateTask, deleteTask, month, setMonth }){
  const [form,setForm]=useState({title:'',type:'CRM',due_date:new Date().toISOString().slice(0,10),due_time:'09:00'})
  const year=month.getFullYear(), monthIndex=month.getMonth(), startDay=new Date(year,monthIndex,1).getDay(), daysInMonth=new Date(year,monthIndex+1,0).getDate()
  const cells=[...Array(startDay).fill(null), ...Array.from({length:daysInMonth},(_,i)=>new Date(year,monthIndex,i+1))]
  const taskForDate=date=>db.tasks.filter(t=>t.due_date===date.toISOString().slice(0,10))
  function submit(e){e.preventDefault(); if(!form.title.trim()) return; addTask(form); setForm(prev=>({...prev,title:''}))}
  return <section className="calendarLayout"><div className="panel"><div className="panelHead"><button className="btn small" onClick={()=>setMonth(new Date(year,monthIndex-1,1))}>←</button><h2>{month.toLocaleDateString('es-PE',{month:'long',year:'numeric'})}</h2><button className="btn small" onClick={()=>setMonth(new Date(year,monthIndex+1,1))}>→</button></div><div className="calendarGrid">{['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d=><b className="dayName" key={d}>{d}</b>)}{cells.map((date,i)=><div className="dayCell" key={i}>{date && <><strong>{date.getDate()}</strong>{taskForDate(date).slice(0,3).map(t=><span key={t.id} className="taskDot">{t.title}</span>)}</>}</div>)}</div></div><aside className="panel"><h2>Nueva actividad</h2><form className="taskForm" onSubmit={submit}><input placeholder="Actividad" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option>CRM</option><option>Business Plan</option><option>KPI</option><option>Proyecto</option><option>Otro</option></select><input type="date" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/><input type="time" value={form.due_time} onChange={e=>setForm({...form,due_time:e.target.value})}/><button className="btn gold">Agendar</button></form><div className="taskList">{db.tasks.map(t=><div className="taskItem" key={t.id}><b>{t.title}</b><span>{t.type} · {t.due_date} · {t.due_time || ''} · {t.status}</span><div className="row"><button className="btn small" onClick={()=>updateTask({...t,status:t.status==='hecha'?'vigente':'hecha'})}><CheckCircle2 size={14}/>Estado</button><button className="btn small danger" onClick={()=>deleteTask(t.id)}>Eliminar</button></div></div>)}</div></aside></section>
}
function Notes({ db, saveNotes }){ return <section className="panel"><h2>Notas rápidas</h2><p>Mapa de ideas, recordatorios comerciales y observaciones del día.</p><textarea className="notesArea" value={db.notes} onChange={e=>saveNotes(e.target.value)} placeholder="Escriba aquí..." /></section> }
function SettingsPanel({ db, exportBackup }){ return <section className="panel"><h2>Configuración</h2><div className="settingsGrid"><div className="subPanel"><h3>Roles previstos</h3><p>Admin · Team Leader · KAM · Operations · Viewer</p></div><div className="subPanel"><h3>Respaldo</h3><button className="btn dark" onClick={exportBackup}>Exportar backup JSON</button></div><div className="subPanel"><h3>Modo de datos</h3><p>Supabase conectado. Datos centrales en nube.</p></div></div></section> }

createRoot(document.getElementById('root')).render(<App />)
