export const pipelineStages = [
  { id: 'prospeccion', name: 'Prospección', range: '0 - 10%', min: 0, max: 10 },
  { id: 'cualificacion', name: 'Cualificación', range: '10 - 25%', min: 10, max: 25 },
  { id: 'contactado', name: 'Contactado', range: '25 - 40%', min: 25, max: 40 },
  { id: 'piloto', name: 'Piloto', range: '40 - 55%', min: 40, max: 55 },
  { id: 'envio_propuesta', name: 'Envío de propuesta', range: '50 - 75%', min: 50, max: 75 },
  { id: 'negociacion', name: 'Negociación', range: '75 - 90%', min: 75, max: 90 },
  { id: 'cierre_perdido', name: 'Cierre perdido', range: '0%', min: 0, max: 0 }
]

export const sampleCompanies = [
  { id:'demo-1', ruc:'20123456789', legal_name:'Transportes Andinos S.A.C.', commercial_name:'Transportes Andinos', category:'Transporte', department:'Lima', opportunity_stage:'contactado', probability:36, close_date:'2026-08-20', heat:'Tibio' },
  { id:'demo-2', ruc:'20456789123', legal_name:'Operador Logístico Norte S.A.', commercial_name:'OL Norte', category:'Distribución', department:'La Libertad', opportunity_stage:'piloto', probability:54, close_date:'2026-09-12', heat:'Caliente' },
  { id:'demo-3', ruc:'20678912345', legal_name:'Flota Industrial Sur S.A.C.', commercial_name:'Flota Industrial Sur', category:'Minería', department:'Arequipa', opportunity_stage:'negociacion', probability:82, close_date:'2026-10-02', heat:'Muy caliente' }
]

export const sampleContacts = [
  { id:'c1', company_id:'demo-1', name:'María Torres', role:'Operaciones', email:'maria.torres@demo.pe', phone:'+51 999 111 222', influence:'Champion' },
  { id:'c2', company_id:'demo-1', name:'Carlos Ríos', role:'Gerencia General', email:'carlos.rios@demo.pe', phone:'+51 999 333 444', influence:'Decisor' },
  { id:'c3', company_id:'demo-2', name:'Andrea Salinas', role:'Compras', email:'andrea.salinas@demo.pe', phone:'+51 999 555 666', influence:'Evaluador' }
]

export const bpSections = {
  proposito: {
    title:'Propósito',
    body:'Crear control donde antes había puntos ciegos. Ayudar a empresas con flotas a pasar de la reacción operativa a la gestión preventiva y medible.'
  },
  objeciones: [
    { decisor:'Gerencia General', mensaje:'Visibilidad ejecutiva para proteger continuidad y reducir riesgo operativo.', objecion:'Ya tenemos GPS.', respuesta:'El objetivo no es solo ubicación, es evidencia, prevención y decisión.' },
    { decisor:'CFO', mensaje:'Control del gasto operativo, pérdidas ocultas y costos evitables.', objecion:'El presupuesto está cerrado.', respuesta:'El caso debe medirse por pérdidas evitadas y TCO, no por costo unitario.' },
    { decisor:'Operaciones', mensaje:'Menos puntos ciegos, más control diario y trazabilidad accionable.', objecion:'Mi equipo ya controla rutas.', respuesta:'El portal refuerza control con alertas, registros y trazabilidad verificable.' }
  ],
  plan90: [
    { accion:'Depurar base de clientes', dias:7, detalle:'Normalizar RUC, contactos, sector y etapa comercial.', responsable:'Team Leader B2B' },
    { accion:'Priorizar cuentas calientes', dias:10, detalle:'Aplicar heat score y seleccionar top cuentas por potencial.', responsable:'KAM' },
    { accion:'Activar agenda de pilotos', dias:21, detalle:'Definir empresas para piloto, condiciones, indicadores y cierre esperado.', responsable:'Equipo Comercial' },
    { accion:'Revisión ejecutiva de pipeline', dias:15, detalle:'Medir avance por etapa, probabilidad y fecha estimada de cierre.', responsable:'Team Leader B2B' }
  ],
  pendientes: [
    { pendiente:'Definir presupuesto Y26', especificacion:'Cargar meta mensual hasta diciembre 2026.', solicitud:'2026-05-21', responsable:'Jose Barrantes', estado:'Pendiente' }
  ],
  proyectos: [
    { nombre:'CRM por RUC', estado:'Activo', detalle:'Ficha cliente, contactos múltiples, pipeline y tareas.' },
    { nombre:'Brand Guidelines', estado:'Activo', detalle:'Uso visual y verbal del Canal Corporativo B2B.' }
  ],
  presupuesto: {}
}
