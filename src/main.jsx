import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CalendarDays, LayoutDashboard, Users, Target, Settings, LogOut, Plus, Save, Search, Trash2, CheckCircle2, NotebookPen, Cloud, Upload } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
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
      <div className="statusBar cloud"><Cloud size={16}/> Supabase conectado: datos en nube {cloudError && <span className="errorInline">{cloudError}</span>} {loadingCloud && <span>Cargando...</span>} <button className="btn small" onClick={()=>refreshCloud(false)}>Actualizar nube</button></div>
      {view==='home' && <Home db={db} pipelineData={pipelineData} setView={setView}/>}
      {view==='crm' && <CRM db={db} query={query} setQuery={setQuery} selectedCompany={selectedCompany} setSelectedCompanyId={setSelectedCompanyId} saveCompany={saveCompany} addCompany={addCompany} deleteCompany={deleteCompany} addContact={addContact} updateContact={updateContact} deleteContact={deleteContact} addTaskFromCompany={addTaskFromCompany} importClientBase={importClientBase}/>}
      {view==='business' && <BusinessPlan db={db} updateBP={updateBP}/>}
      {view==='calendar' && <CalendarView db={db} addTask={addTask} updateTask={updateTask} deleteTask={deleteTask} month={month} setMonth={setMonth}/>}
      {view==='notes' && <Notes db={db} saveNotes={saveNotes}/>}
      {view==='settings' && <SettingsPanel db={db} exportBackup={exportBackup}/>}
    </main></div>
}

function Home({ db, pipelineData, setView }){
  const hot = db.companies.filter(c => Number(c.probability) >= 75).length
  const avg = Math.round(db.companies.reduce((s,c)=>s+Number(c.probability||0),0)/Math.max(db.companies.length,1))
  return <section className="homeGrid"><div className="heroPanel">
      <img className="geoLogoHero" src="/assets/geosatelital-logo.webp" alt="Geosatelital" />
      <div className="heroContent">
        <div className="miniK">Canal Corporativo B2B</div>
        <h1>Ruta 360°</h1>
        <p>Centro de control comercial para gestionar cuentas, oportunidades y seguimiento corporativo con visión operativa.</p>
        <div className="heroActions"><button className="bigAction dark" onClick={()=>setView('crm')}>CRM</button><button className="bigAction gold" onClick={()=>setView('business')}>Business Plan</button></div>
      </div>
    </div>
    <div className="metricCard"><span>Empresas</span><b>{db.companies.length}</b></div><div className="metricCard"><span>Contactos</span><b>{db.contacts.length}</b></div><div className="metricCard"><span>Probabilidad media</span><b>{avg}%</b></div><div className="metricCard"><span>Cuentas calientes</span><b>{hot}</b></div>
    <section className="panel wide"><div className="panelHead"><h2>Pipeline comercial</h2><span>Etapas activas</span></div><div className="chartBox"><ResponsiveContainer width="100%" height={250}><BarChart data={pipelineData}><XAxis dataKey="name" tick={{fontSize:11}} interval={0} angle={-15} textAnchor="end" height={70}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="cuentas" fill="#C9A227" radius={[8,8,0,0]}/></BarChart></ResponsiveContainer></div></section>
    <section className="panel"><div className="panelHead"><h2>Próximas tareas</h2><span>{db.tasks.length} registradas</span></div><div className="list">{db.tasks.slice(0,5).map(t=><div className="listItem" key={t.id}><b>{t.title}</b><span>{t.due_date} · {t.due_time}</span></div>)}{!db.tasks.length && <p>No hay tareas registradas todavía.</p>}</div></section></section>
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
