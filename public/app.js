

const API = ''; // vacío = mismo servidor; en dev: 'http://localhost:3001'

// ── FETCH HELPER ────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('bp_token');
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: 'Error de servidor' }));
    throw new Error(e.error || 'Error de servidor');
  }
  return res.json();
}

// ── ESTADO GLOBAL ────────────────────────────────────────
let session     = null;
let serviciosDB = [];
let barberosDB  = [];
let horariosDB  = [];

// ── UTILS ────────────────────────────────────────────────
const gs = n => `${parseInt(n||0).toLocaleString('es-PY')} Gs`;
const hoy = () => new Date().toISOString().split('T')[0];
const fechaLinda = f => new Date(f+'T12:00:00').toLocaleDateString('es-PY',{weekday:'long',day:'numeric',month:'long'});

// ══════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function showPage(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  const el = document.getElementById('page-'+p);
  if (el) el.classList.add('active');

  const isPanel = p === 'panel';
  const isLogin = p === 'login';
  document.getElementById('main-nav').style.display    = (isPanel||isLogin) ? 'none' : 'flex';
  document.getElementById('main-footer').style.display = (isPanel||isLogin) ? 'none' : 'block';

  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const nl = document.getElementById('nl-'+p);
  if (nl) nl.classList.add('active');

  if (p === 'inicio')    {} // estático
  if (p === 'barberos')  loadBarberos();
  if (p === 'servicios') loadServicios();
  if (p === 'reservar')  initReservar();
  if (p === 'ubicacion') loadUbicacion();
  if (p === 'login')     resetLogin();
  window.scrollTo(0,0);
}

// ══════════════════════════════════════════════════════════
//  BARBEROS (página pública)
// ══════════════════════════════════════════════════════════
async function loadBarberos() {
  const grid = document.getElementById('barberos-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Cargando barberos...</div>';
  try {
    barberosDB = await apiFetch('/api/barberos');
    const iniciales = n => n.split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
    grid.innerHTML = barberosDB.map(b => `
      <div class="barbero-card">
        ${b.es_principal ? '<div class="badge-principal">Principal</div>' : ''}
        <div class="barbero-avatar">${iniciales(b.apodo)}</div>
        <div class="barbero-name">${b.apodo}</div>
        <div class="barbero-esp">${b.especialidad || 'Barbero profesional'}</div>
      </div>
    `).join('');
  } catch(e) {
    grid.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════
//  SERVICIOS
// ══════════════════════════════════════════════════════════
async function loadServicios() {
  const grid = document.getElementById('services-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Cargando servicios...</div>';
  try {
    serviciosDB = await apiFetch('/api/servicios');
    const sc = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    grid.innerHTML = serviciosDB.map(s => `
      <div class="svc-card">
        ${s.es_premium ? '<div class="badge-premium">Premium</div>' : ''}
        <div class="svc-cat">${s.icono||'✂'} ${s.categoria||''}</div>
        <div class="svc-name">${s.nombre}</div>
        <div class="svc-desc">${s.descripcion||''}</div>
        <div class="svc-time">${sc} ${s.duracion_min} min</div>
        <div class="svc-footer">
          <div class="svc-price">${gs(s.precio_gs)}</div>
          <button class="btn-svc" onclick="irReservar(${s.id})">Reservar</button>
        </div>
      </div>
    `).join('');
  } catch(e) {
    grid.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function irReservar(sid) {
  showPage('reservar');
  setTimeout(() => {
    const s = document.getElementById('r-servicio');
    if (s) { s.value = sid; onFechaChange(); }
  }, 150);
}

// ══════════════════════════════════════════════════════════
//  RESERVAR 
// ══════════════════════════════════════════════════════════
async function initReservar() {
  try {
    if (!serviciosDB.length) serviciosDB = await apiFetch('/api/servicios');
    if (!barberosDB.length)  barberosDB  = await apiFetch('/api/barberos');
    horariosDB = await apiFetch('/api/horarios');

    const selS = document.getElementById('r-servicio');
    if (selS) {
      selS.innerHTML = '<option value="">Selecciona un servicio</option>' +
        serviciosDB.map(s => `<option value="${s.id}">${s.nombre} — ${gs(s.precio_gs)}</option>`).join('');
    }
    const selB = document.getElementById('r-barbero');
    if (selB) {
      selB.innerHTML = '<option value="">Selecciona un barbero</option>' +
        barberosDB.map(b => `<option value="${b.id}">${b.apodo}</option>`).join('');
    }

    renderHorariosList();
    const fi = document.getElementById('r-fecha');
    if (fi) fi.min = hoy();
  } catch(e) { toast('Error al cargar datos: '+e.message, 'error'); }
}

function renderHorariosList() {
  const el = document.getElementById('horarios-lista');
  if (!el) return;
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const d = new Date().getDay();
  el.innerHTML = horariosDB.map(h => `
    <div class="hor-row ${h.dia_semana===d?'hor-today':''}">
      <span class="hor-dia">${dias[h.dia_semana]}</span>
      <span class="hor-hrs">${h.hora_apertura.slice(0,5)} - ${h.hora_cierre.slice(0,5)}</span>
    </div>`).join('');
}

async function onFechaChange() {
  const fecha = document.getElementById('r-fecha')?.value;
  const bid   = document.getElementById('r-barbero')?.value;
  const sid   = document.getElementById('r-servicio')?.value;
  const sel   = document.getElementById('r-hora');
  if (!sel) return;
  if (!fecha || !bid || !sid) {
    sel.innerHTML = '<option>Selecciona barbero, servicio y fecha</option>'; return;
  }
  sel.innerHTML = '<option>Buscando horarios...</option>';
  try {
    const slots = await apiFetch(`/api/disponibilidad?barbero_id=${bid}&fecha=${fecha}&servicio_id=${sid}`);
    sel.innerHTML = slots.length
      ? slots.map(s => `<option value="${s}">${s}</option>`).join('')
      : '<option>Sin disponibilidad este día</option>';
  } catch(e) { sel.innerHTML = '<option>Error al cargar</option>'; }
}

async function confirmarReserva() {
  const nombre   = document.getElementById('r-nombre')?.value.trim();
  const telefono = document.getElementById('r-tel')?.value.trim();
  const sid      = document.getElementById('r-servicio')?.value;
  const bid      = document.getElementById('r-barbero')?.value;
  const fecha    = document.getElementById('r-fecha')?.value;
  const hora     = document.getElementById('r-hora')?.value;

  if (!nombre||!telefono||!sid||!bid||!fecha||!hora) {
    toast('Completá todos los campos obligatorios','error'); return;
  }
  const btn = document.getElementById('btn-confirmar');
  if (btn) { btn.disabled=true; btn.textContent='Enviando...'; }
  try {
    const r = await apiFetch('/api/reservas', {
      method:'POST',
      body: JSON.stringify({ nombre_completo:nombre, telefono, servicio_id:sid,
        barbero_id:bid, fecha, hora_inicio:hora }),
    });
    toast('✓ '+r.mensaje, 'success');
    ['r-nombre','r-tel'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    ['r-servicio','r-barbero'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const fh = document.getElementById('r-fecha'); if(fh) fh.value='';
    const rh = document.getElementById('r-hora'); if(rh) rh.innerHTML='<option>Primero selecciona una fecha</option>';
  } catch(e) { toast('Error: '+e.message,'error'); }
  finally { if(btn) { btn.disabled=false; btn.textContent='Confirmar Reserva'; } }
}

// ══════════════════════════════════════════════════════════
//  UBICACION
// ══════════════════════════════════════════════════════════
async function loadUbicacion() {
  try {
    if (!horariosDB.length) horariosDB = await apiFetch('/api/horarios');
    const d = new Date().getDay();
    const h = horariosDB.find(x => x.dia_semana === d);
    const el = document.getElementById('horario-hoy');
    if (el && h) el.textContent = `${h.hora_apertura.slice(0,5)} - ${h.hora_cierre.slice(0,5)}`;
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════
function resetLogin() {
  document.getElementById('login-selector').style.display = 'block';
  document.querySelectorAll('.lf').forEach(f => { f.classList.remove('show'); f.style.display='none'; });
}

function showLoginForm(tipo) {
  document.getElementById('login-selector').style.display = 'none';
  const f = document.getElementById('lf-'+tipo);
  if (f) { f.style.display='block'; setTimeout(() => f.classList.add('show'), 10); }
  const e = document.getElementById('err-'+tipo);
  if (e) e.style.display='none';
}

async function doLogin(tipo) {
  const uEl  = document.getElementById(tipo==='admin'?'a-user':tipo==='recep'?'rc-user':'b-user');
  const pEl  = document.getElementById(tipo==='admin'?'a-pass':tipo==='recep'?'rc-pass':'b-pass');
  const errEl= document.getElementById('err-'+tipo);
  const btn  = document.getElementById('btn-login-'+tipo);

  if (!uEl||!pEl) return;
  if (btn) { btn.disabled=true; btn.textContent='Ingresando...'; }
  if (errEl) errEl.style.display='none';

  try {
    const data = await apiFetch('/api/auth/login', {
      method:'POST',
      body: JSON.stringify({ username: uEl.value.trim(), password: pEl.value }),
    });
    localStorage.setItem('bp_token',  data.token);
    localStorage.setItem('bp_rol',    data.rol);
    localStorage.setItem('bp_nombre', data.nombre);
    localStorage.setItem('bp_bid',    data.barbero_id||'');
    session = data;
    showPanel();
  } catch(e) {
    if (errEl) { errEl.textContent=e.message; errEl.style.display='block'; }
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Ingresar'; }
  }
}

function doLogout() {
  ['bp_token','bp_rol','bp_nombre','bp_bid'].forEach(k => localStorage.removeItem(k));
  session = null;
  showPage('inicio');
}

// ══════════════════════════════════════════════════════════
//  PANEL
// ══════════════════════════════════════════════════════════
async function showPanel() {
  showPage('panel');
  document.getElementById('main-nav').style.display    = 'none';
  document.getElementById('main-footer').style.display = 'none';

  const rol    = localStorage.getItem('bp_rol')    || session?.rol    || '';
  const nombre = localStorage.getItem('bp_nombre') || session?.nombre || '';

  const rolLabels = {
    admin:'Panel Administrador', recepcionista:'Panel Recepción',
    barbero:'Panel Barbero', cliente:'Mi Cuenta'
  };
  document.getElementById('panel-title').textContent  = rolLabels[rol]||'Panel';
  document.getElementById('panel-nombre').textContent = nombre;
  document.getElementById('panel-fecha').textContent  = new Date().toLocaleDateString('es-PY',
    {weekday:'long',year:'numeric',month:'long',day:'numeric'});

  const tabsEl = document.getElementById('panel-tabs');

  // Construir tabs según rol
  if (rol === 'admin') {
    tabsEl.innerHTML = `
      <button class="ptab active" onclick="setPTab('agenda',this)">Agenda</button>
      <button class="ptab" onclick="setPTab('metricas',this)">Métricas</button>
      <button class="ptab" onclick="setPTab('reservas',this)">Reservas</button>
      <button class="ptab" onclick="setPTab('servicios-adm',this)">Servicios</button>
      <button class="ptab" onclick="setPTab('horarios-adm',this)">Horarios</button>
      <button class="ptab" onclick="setPTab('barberos-adm',this)">Barberos</button>
      <button class="ptab" onclick="setPTab('clientes-adm',this)">Clientes</button>
    `;
  } else if (rol === 'recepcionista') {
    tabsEl.innerHTML = `
      <button class="ptab active" onclick="setPTab('agenda',this)">Agenda del Día</button>
      <button class="ptab" onclick="setPTab('nueva-reserva',this)">Nueva Reserva</button>
      <button class="ptab" onclick="setPTab('caja',this)">Caja</button>
      <button class="ptab" onclick="setPTab('clientes-recep',this)">Clientes</button>
    `;
  } else if (rol === 'barbero') {
    tabsEl.innerHTML = `
      <button class="ptab active" onclick="setPTab('agenda',this)">Mi Agenda</button>
      <button class="ptab" onclick="setPTab('mis-clientes',this)">Mis Clientes</button>
    `;
  } else {
    tabsEl.innerHTML = `<button class="ptab active" onclick="setPTab('mis-reservas',this)">Mis Reservas</button>`;
  }

  setPTab('agenda', tabsEl.querySelector('.ptab'));
}

function setPTab(tab, btn) {
  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const body = document.getElementById('panel-content');
  body.innerHTML = '<div class="loading">Cargando...</div>';

  const rol = localStorage.getItem('bp_rol');

  if (tab === 'agenda')          loadAgenda(rol);
  else if (tab === 'metricas')   loadMetricas();
  else if (tab === 'reservas')   loadTodasReservas();
  else if (tab === 'servicios-adm') loadServiciosAdmin();
  else if (tab === 'horarios-adm')  loadHorariosAdmin();
  else if (tab === 'barberos-adm')  loadBarberosAdmin();
  else if (tab === 'clientes-adm')  loadClientesAdmin();
  else if (tab === 'nueva-reserva') renderNuevaReservaForm();
  else if (tab === 'caja')          loadCaja();
  else if (tab === 'clientes-recep')loadClientesRecep();
  else if (tab === 'mis-clientes')  loadMisClientes();
  else if (tab === 'mis-reservas')  loadMisReservas();
}

// ══════════════════════════════════════════════════════════
//  AGENDA 
// ══════════════════════════════════════════════════════════
async function loadAgenda(rol) {
  const body = document.getElementById('panel-content');
  const fecha = hoy();
  try {
    let turnos;
    if (rol === 'barbero') {
      turnos = await apiFetch(`/api/barbero/agenda?fecha=${fecha}`);
    } else {
      turnos = await apiFetch(`/api/recep/agenda?fecha=${fecha}`);
    }
    renderAgenda(turnos, rol, body);
  } catch(e) {
    body.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function renderAgenda(turnos, rol, container) {
  if (!turnos.length) {
    container.innerHTML = '<div class="empty">No hay turnos para hoy</div>'; return;
  }
  container.innerHTML = `<div class="agenda-grid">${turnos.map(t => turnoHTML(t, rol)).join('')}</div>`;
}

function turnoHTML(t, rol) {
  const esAdmin = rol==='admin'||rol==='recepcionista';
  const puedeAcc = t.estado!=='completada'&&t.estado!=='cancelada';
  const acc = puedeAcc ? `
    <div class="tac">
      ${t.estado==='pendiente'?`<button class="ta c1" onclick="cambiarEstado(${t.id},'confirmada','${rol}')">Confirmar</button>`:''}
      ${t.estado==='confirmada'?`<button class="ta c4" onclick="cambiarEstado(${t.id},'en_curso','${rol}')">Iniciar</button>`:''}
      ${t.estado!=='completada'?`<button class="ta c2" onclick="cambiarEstado(${t.id},'completada','${rol}')">Completar</button>`:''}
      <button class="ta c3" onclick="cambiarEstado(${t.id},'cancelada','${rol}')">Cancelar</button>
    </div>` : '';
  return `
    <div class="t-card" id="tc-${t.id}">
      <div class="t-hora">${t.hora_inicio.slice(0,5)}<small>${t.hora_fin.slice(0,5)}</small></div>
      <div class="t-div"></div>
      <div class="t-info">
        <div class="t-cli">${t.cliente}</div>
        <div class="t-svc">${t.servicio}${t.barbero?' · '+t.barbero:''}</div>
        <div class="t-tel">${t.telefono} · ${t.origen||'web'}</div>
      </div>
      <span class="est est-${t.estado}">${t.estado}</span>
      <div class="t-precio">${gs(t.precio_gs)}</div>
      ${acc}
    </div>`;
}

async function cambiarEstado(id, estado, rol) {
  try {
    const ep = (rol==='barbero') ? '/api/barbero' : '/api/recep';
    await apiFetch(`${ep}/reservas/${id}/estado`, {
      method:'PATCH', body: JSON.stringify({ estado }),
    });
    toast(`Estado: ${estado}`, 'success');
    loadAgenda(rol);
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ══════════════════════════════════════════════════════════
//  MÉTRICAS
// ══════════════════════════════════════════════════════════
async function loadMetricas() {
  const body = document.getElementById('panel-content');
  try {
    const { mesActual: m, porBarbero, porServicio, porMes, cajaHoy } = await apiFetch('/api/admin/metricas');
    body.innerHTML = `
      <div class="met-grid">
        <div class="met-card"><div class="met-lbl">Reservas del mes</div><div class="met-val">${m.total}</div><div class="met-sub">en total</div></div>
        <div class="met-card"><div class="met-lbl">Completadas</div><div class="met-val">${m.completadas}</div><div class="met-sub">${m.total>0?Math.round(m.completadas/m.total*100):0}% asistencia</div></div>
        <div class="met-card"><div class="met-lbl">Canceladas</div><div class="met-val">${m.canceladas}</div><div class="met-sub">este mes</div></div>
        <div class="met-card"><div class="met-lbl">Ingresos del mes</div>
          <div class="met-val" style="font-size:17px">${Number(m.ingresos).toLocaleString('es-PY')}</div>
          <div class="met-sub">Guaraníes</div></div>
      </div>
      <div class="adm-grid">
        <div class="adm-sec"><h4>Por Barbero</h4>
          ${porBarbero.map(b=>`<div class="prow"><span>${b.apodo}</span><span style="font-family:var(--serif);color:var(--gold)">${gs(b.ingresos)}</span></div>`).join('')}
        </div>
        <div class="adm-sec"><h4>Servicios más pedidos</h4>
          ${porServicio.map(s=>`<div class="prow"><span>${s.nombre}</span><span style="color:var(--muted)">${s.veces} veces</span></div>`).join('')}
        </div>
        <div class="adm-sec"><h4>Caja de hoy</h4>
          <div class="prow"><span>Total cobrado</span><span style="font-family:var(--serif);color:var(--green)">${gs(cajaHoy.total)}</span></div>
          <div class="prow"><span>Ventas</span><span>${cajaHoy.ventas}</span></div>
          <div class="prow"><span>Efectivo</span><span>${gs(cajaHoy.efectivo)}</span></div>
          <div class="prow"><span>Transferencia</span><span>${gs(cajaHoy.transfer)}</span></div>
        </div>
        <div class="adm-sec"><h4>Historial mensual</h4>
          ${porMes.map(m=>`<div class="prow"><span>${m.mes}</span><span style="font-family:var(--serif);color:var(--gold)">${gs(m.ingresos)}</span></div>`).join('')}
        </div>
      </div>`;
  } catch(e) { document.getElementById('panel-content').innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

// ══════════════════════════════════════════════════════════
//  TODAS LAS RESERVAS 
// ══════════════════════════════════════════════════════════
async function loadTodasReservas() {
  const body = document.getElementById('panel-content');
  try {
    const data = await apiFetch('/api/admin/reservas');
    if (!data.length) { body.innerHTML='<div class="empty">No hay reservas</div>'; return; }
    body.innerHTML = `<div class="agenda-grid">${data.map(t=>turnoHTML(t,'admin')).join('')}</div>`;
  } catch(e) { body.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

// ══════════════════════════════════════════════════════════
//  SERVICIOS ADMIN 
// ══════════════════════════════════════════════════════════
async function loadServiciosAdmin() {
  const body = document.getElementById('panel-content');
  try {
    const svcs = await apiFetch('/api/admin/servicios');
    body.innerHTML = `
      <div class="adm-sec" style="max-width:700px">
        <h4>Gestionar Servicios y Precios</h4>
        <div id="svcs-lista">
          ${svcs.map(s=>`
            <div class="prow" style="flex-wrap:wrap;gap:8px">
              <span style="flex:1;min-width:140px">${s.nombre}</span>
              <span style="color:var(--muted);font-size:11px">${s.duracion_min} min</span>
              <input class="pinp" data-id="${s.id}" data-obj='${JSON.stringify(s)}'
                value="${s.precio_gs}" type="number" min="0" style="width:100px"/>
              <span style="font-size:10px;color:var(--muted)">Gs</span>
            </div>`).join('')}
        </div>
        <button class="btn-save" onclick="savePrecios()">Guardar Precios</button>
      </div>`;
  } catch(e) { body.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

async function savePrecios() {
  try {
    for (const inp of document.querySelectorAll('.pinp')) {
      const obj = JSON.parse(inp.dataset.obj);
      await apiFetch(`/api/admin/servicios/${inp.dataset.id}`, {
        method:'PUT', body: JSON.stringify({...obj, precio_gs: parseInt(inp.value)})
      });
    }
    toast('Precios actualizados','success');
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ══════════════════════════════════════════════════════════
//  HORARIOS ADMIN
// ══════════════════════════════════════════════════════════
async function loadHorariosAdmin() {
  const body = document.getElementById('panel-content');
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  try {
    const hs = await apiFetch('/api/horarios');
    body.innerHTML = `
      <div class="adm-sec" style="max-width:500px">
        <h4>Horarios de Atención</h4>
        ${hs.map(h=>`
          <div class="herow">
            <span class="hdl">${dias[h.dia_semana].slice(0,3)}</span>
            <input class="hinp" data-dia="${h.dia_semana}" data-t="a" value="${h.hora_apertura.slice(0,5)}"/>
            <span style="color:var(--muted);font-size:11px">—</span>
            <input class="hinp" data-dia="${h.dia_semana}" data-t="c" value="${h.hora_cierre.slice(0,5)}"/>
          </div>`).join('')}
        <button class="btn-save" onclick="saveHorarios()">Guardar Horarios</button>
      </div>`;
  } catch(e) { body.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

async function saveHorarios() {
  try {
    const map = {};
    document.querySelectorAll('.hinp').forEach(i => {
      if (!map[i.dataset.dia]) map[i.dataset.dia]={};
      map[i.dataset.dia][i.dataset.t] = i.value;
    });
    for (const [dia,v] of Object.entries(map)) {
      await apiFetch(`/api/admin/horarios/${dia}`, {
        method:'PUT', body: JSON.stringify({ hora_apertura:v.a, hora_cierre:v.c, activo:true })
      });
    }
    toast('Horarios actualizados','success');
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ══════════════════════════════════════════════════════════
//  BARBEROS ADMIN
// ══════════════════════════════════════════════════════════
async function loadBarberosAdmin() {
  const body = document.getElementById('panel-content');
  try {
    const bs = await apiFetch('/api/admin/barberos');
    body.innerHTML = `
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Barbero</th><th>Usuario</th><th>Especialidad</th><th>Teléfono</th><th>Estado</th><th>Orden</th></tr></thead>
          <tbody>
            ${bs.map(b=>`
              <tr>
                <td><strong>${b.apodo}</strong></td>
                <td style="color:var(--muted)">${b.username}</td>
                <td>${b.especialidad||'—'}</td>
                <td>${b.telefono||'—'}</td>
                <td><span class="est ${b.activo?'est-confirmada':'est-cancelada'}">${b.activo?'Activo':'Inactivo'}</span></td>
                <td>${b.orden}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) { body.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

// ══════════════════════════════════════════════════════════
//  CLIENTES ADMIN
// ══════════════════════════════════════════════════════════
async function loadClientesAdmin() {
  const body = document.getElementById('panel-content');
  try {
    const cs = await apiFetch('/api/admin/clientes');
    body.innerHTML = `
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>Visitas</th><th>Reservas</th></tr></thead>
          <tbody>
            ${cs.map(c=>`
              <tr>
                <td><strong>${c.nombre_completo}</strong></td>
                <td>${c.telefono}</td>
                <td style="color:var(--muted)">${c.email||'—'}</td>
                <td style="font-family:var(--serif);color:var(--gold)">${c.total_visitas}</td>
                <td>${c.reservas_total}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) { body.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

// ══════════════════════════════════════════════════════════
//  NUEVA RESERVA 
// ══════════════════════════════════════════════════════════
async function renderNuevaReservaForm() {
  const body = document.getElementById('panel-content');
  if (!serviciosDB.length) serviciosDB = await apiFetch('/api/servicios');
  if (!barberosDB.length)  barberosDB  = await apiFetch('/api/barberos');
  body.innerHTML = `
    <div class="form-card" style="max-width:600px">
      <h3>Nueva Reserva — Recepción</h3>
      <div class="fg"><label>Nombre del Cliente *</label><input class="fi" id="nr-nombre" type="text" placeholder="Nombre completo"/></div>
      <div class="fg"><label>Teléfono *</label><input class="fi" id="nr-tel" type="tel" placeholder="0981 000000"/></div>
      <div class="fg"><label>Servicio *</label>
        <div class="sel-wrap">
          <select class="fs" id="nr-srv" onchange="nrFechaChange()">
            <option value="">Selecciona servicio</option>
            ${serviciosDB.map(s=>`<option value="${s.id}">${s.nombre} — ${gs(s.precio_gs)}</option>`).join('')}
          </select>
          <span class="sel-arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
      </div>
      <div class="fg"><label>Barbero *</label>
        <div class="sel-wrap">
          <select class="fs" id="nr-barb" onchange="nrFechaChange()">
            <option value="">Selecciona barbero</option>
            ${barberosDB.map(b=>`<option value="${b.id}">${b.apodo}</option>`).join('')}
          </select>
          <span class="sel-arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
      </div>
      <div class="fg"><label>Fecha *</label><input class="fi" id="nr-fecha" type="date" min="${hoy()}" onchange="nrFechaChange()"/></div>
      <div class="fg"><label>Hora *</label>
        <div class="sel-wrap">
          <select class="fs" id="nr-hora"><option>Selecciona fecha primero</option></select>
          <span class="sel-arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
      </div>
      <div class="fg"><label>Origen</label>
        <div class="sel-wrap">
          <select class="fs" id="nr-origen">
            <option value="presencial">Presencial</option>
            <option value="telefono">Teléfono</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <span class="sel-arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
      </div>
      <div class="fg"><label>Notas</label><input class="fi" id="nr-notas" type="text" placeholder="Observaciones internas..."/></div>
      <button class="btn-confirm" onclick="crearReservaRecep()">Confirmar Reserva</button>
    </div>`;
}

async function nrFechaChange() {
  const fecha = document.getElementById('nr-fecha')?.value;
  const bid   = document.getElementById('nr-barb')?.value;
  const sid   = document.getElementById('nr-srv')?.value;
  const sel   = document.getElementById('nr-hora');
  if (!sel) return;
  if (!fecha||!bid||!sid) { sel.innerHTML='<option>Selecciona barbero, servicio y fecha</option>'; return; }
  sel.innerHTML='<option>Cargando...</option>';
  try {
    const slots = await apiFetch(`/api/disponibilidad?barbero_id=${bid}&fecha=${fecha}&servicio_id=${sid}`);
    sel.innerHTML = slots.length
      ? slots.map(s=>`<option value="${s}">${s}</option>`).join('')
      : '<option>Sin disponibilidad</option>';
  } catch(e) { sel.innerHTML='<option>Error</option>'; }
}

async function crearReservaRecep() {
  const nombre   = document.getElementById('nr-nombre')?.value.trim();
  const telefono = document.getElementById('nr-tel')?.value.trim();
  const sid      = document.getElementById('nr-srv')?.value;
  const bid      = document.getElementById('nr-barb')?.value;
  const fecha    = document.getElementById('nr-fecha')?.value;
  const hora     = document.getElementById('nr-hora')?.value;
  const origen   = document.getElementById('nr-origen')?.value;
  const notas    = document.getElementById('nr-notas')?.value;

  if (!nombre||!telefono||!sid||!bid||!fecha||!hora) {
    toast('Completá los campos obligatorios','error'); return;
  }
  try {
    const r = await apiFetch('/api/recep/reservas', {
      method:'POST',
      body: JSON.stringify({ nombre_completo:nombre, telefono, servicio_id:sid,
        barbero_id:bid, fecha, hora_inicio:hora, origen, notas }),
    });
    toast('✓ '+r.mensaje,'success');
    renderNuevaReservaForm();
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ══════════════════════════════════════════════════════════
//  CAJA 
// ══════════════════════════════════════════════════════════
async function loadCaja() {
  const body = document.getElementById('panel-content');
  try {
    const { ventas, total_hoy } = await apiFetch('/api/recep/caja/hoy');
    body.innerHTML = `
      <div class="caja-grid">
        <div class="caja-form">
          <h4>Registrar Pago</h4>
          <div class="fg"><label>Reserva ID (opcional)</label><input class="fi" id="cj-rid" type="number" placeholder="ID de la reserva"/></div>
          <div class="fg"><label>Total (Gs) *</label><input class="fi" id="cj-total" type="number" placeholder="0"/></div>
          <div class="fg"><label>Método de pago</label>
            <div class="sel-wrap">
              <select class="fs" id="cj-metodo">
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
              <span class="sel-arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>
            </div>
          </div>
          <div class="fg"><label>Notas</label><input class="fi" id="cj-notas" type="text" placeholder="Observación..."/></div>
          <button class="btn-confirm" onclick="registrarPago()">Registrar Pago</button>
        </div>
        <div class="caja-hist">
          <h4>Caja de Hoy — Total: <span style="color:var(--green)">${gs(total_hoy)}</span></h4>
          ${ventas.length ? ventas.map(v=>`
            <div class="venta-row">
              <span>${new Date(v.creado_en).toLocaleTimeString('es-PY',{hour:'2-digit',minute:'2-digit'})}</span>
              <span style="color:var(--muted)">${v.metodo_pago}</span>
              <span class="venta-total">${gs(v.total_gs)}</span>
            </div>`).join('')
            : '<div style="color:var(--muted);font-size:12px;padding:12px 0">Sin ventas registradas hoy</div>'}
        </div>
      </div>`;
  } catch(e) { body.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

async function registrarPago() {
  const total = parseInt(document.getElementById('cj-total')?.value);
  if (!total||total<=0) { toast('Ingresá el monto','error'); return; }
  try {
    await apiFetch('/api/recep/caja', {
      method:'POST',
      body: JSON.stringify({
        reserva_id: parseInt(document.getElementById('cj-rid')?.value)||null,
        total_gs: total,
        metodo_pago: document.getElementById('cj-metodo')?.value,
        notas: document.getElementById('cj-notas')?.value,
      })
    });
    toast('Pago registrado','success');
    loadCaja();
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ══════════════════════════════════════════════════════════
//  CLIENTES 
// ══════════════════════════════════════════════════════════
async function loadClientesRecep() {
  const body = document.getElementById('panel-content');
  body.innerHTML = `
    <div style="margin-bottom:14px">
      <div class="search-bar" style="max-width:300px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="cli-search" placeholder="Buscar por nombre o teléfono..."
          oninput="buscarClientes(this.value)"/>
      </div>
    </div>
    <div id="cli-results"><div class="loading">Cargando clientes...</div></div>`;
  buscarClientes('');
}

async function buscarClientes(q) {
  const el = document.getElementById('cli-results');
  if (!el) return;
  try {
    const cs = await apiFetch(`/api/recep/clientes?q=${encodeURIComponent(q)}`);
    if (!cs.length) { el.innerHTML='<div class="empty">Sin resultados</div>'; return; }
    el.innerHTML = `
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Teléfono</th><th>Visitas</th><th>Notas</th></tr></thead>
          <tbody>
            ${cs.map(c=>`
              <tr>
                <td><strong>${c.nombre_completo}</strong></td>
                <td>${c.telefono}</td>
                <td style="font-family:var(--serif);color:var(--gold)">${c.total_visitas}</td>
                <td style="color:var(--muted);font-size:11px">${c.notas_internas||'—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) { el.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

// ══════════════════════════════════════════════════════════
//  MIS CLIENTES
// ══════════════════════════════════════════════════════════
async function loadMisClientes() {
  const body = document.getElementById('panel-content');
  try {
    const cs = await apiFetch('/api/barbero/clientes');
    if (!cs.length) { body.innerHTML='<div class="empty">Aún no tenés clientes registrados</div>'; return; }
    body.innerHTML = `
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Teléfono</th><th>Visitas</th><th>Última visita</th></tr></thead>
          <tbody>
            ${cs.map(c=>`
              <tr>
                <td><strong>${c.nombre_completo}</strong></td>
                <td>${c.telefono}</td>
                <td style="font-family:var(--serif);color:var(--gold)">${c.visitas}</td>
                <td style="color:var(--muted)">${c.ultima_visita?new Date(c.ultima_visita).toLocaleDateString('es-PY'):'—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) { body.innerHTML=`<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

// ══════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════
function toast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('bp_token');
  if (token) session = { token, rol: localStorage.getItem('bp_rol'), nombre: localStorage.getItem('bp_nombre') };
  showPage('inicio');
});