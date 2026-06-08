// server.js — Backend Jatere Barber con sql.js (sin compilación)
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const { initDb } = require('./db');

const app    = express();
const PORT   = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || 'jatere_secret_2024';

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// db se inicializa de forma asíncrona
let dbReady = false;
let DB;

// ── HELPERS ──────────────────────────────────────────────
function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total  = h * 60 + m + mins;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}

function getOrCreateCliente(nombre_completo, telefono) {
  let cli = DB.get('SELECT * FROM clientes WHERE telefono=?', [telefono]);
  if (!cli) {
    const r = DB.run('INSERT INTO clientes (nombre_completo,telefono) VALUES (?,?)', [nombre_completo, telefono]);
    cli = DB.get('SELECT * FROM clientes WHERE id=?', [r.lastInsertRowid]);
  } else if (cli.nombre_completo !== nombre_completo) {
    DB.run('UPDATE clientes SET nombre_completo=? WHERE id=?', [nombre_completo, cli.id]);
    cli.nombre_completo = nombre_completo;
  }
  return cli;
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────
function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr) return res.status(401).json({ error: 'No autorizado' });
  try { req.user = jwt.verify(hdr.replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
}
function rol(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.rol)) return res.status(403).json({ error: 'Sin permisos' });
    next();
  };
}

// ── MIDDLEWARE: esperar DB ────────────────────────────────
app.use((req, res, next) => {
  if (!dbReady && req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'Base de datos iniciando, reintentá en 2 segundos' });
  }
  next();
});

// ══════════════════════════════════════════════════════════
//  RUTAS PÚBLICAS
// ══════════════════════════════════════════════════════════

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const user = DB.get('SELECT * FROM usuarios WHERE username=? AND activo=1', [username]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  let barbero_id = null;
  if (user.rol === 'barbero') {
    const b = DB.get('SELECT id FROM barberos WHERE usuario_id=?', [user.id]);
    barbero_id = b?.id || null;
  }
  const token = jwt.sign({ id: user.id, rol: user.rol, nombre: user.nombre, barbero_id }, SECRET, { expiresIn: '8h' });
  res.json({ token, rol: user.rol, nombre: user.nombre, barbero_id });
});

app.get('/api/barberos', (req, res) => {
  res.json(DB.all('SELECT id,apodo,especialidad,es_principal FROM barberos WHERE activo=1 ORDER BY orden ASC'));
});

app.get('/api/servicios', (req, res) => {
  res.json(DB.all('SELECT id,nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium FROM servicios WHERE activo=1 ORDER BY categoria,nombre'));
});

app.get('/api/horarios', (req, res) => {
  res.json(DB.all('SELECT dia_semana,hora_apertura,hora_cierre FROM horarios WHERE activo=1 ORDER BY dia_semana'));
});

app.get('/api/disponibilidad', (req, res) => {
  const { barbero_id, fecha, servicio_id } = req.query;
  if (!barbero_id || !fecha || !servicio_id) return res.status(400).json({ error: 'Faltan parámetros' });
  const svc = DB.get('SELECT duracion_min FROM servicios WHERE id=?', [servicio_id]);
  if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });
  const diaSemana = new Date(fecha + 'T12:00:00').getDay();
  const horario = DB.get('SELECT * FROM horarios WHERE dia_semana=? AND activo=1', [diaSemana]);
  if (!horario) return res.json([]);
  const ocupadas = DB.all(
    `SELECT hora_inicio,hora_fin FROM reservas WHERE barbero_id=? AND fecha=? AND estado NOT IN ('cancelada','no_asistio')`,
    [barbero_id, fecha]
  );
  const slots = [];
  const [hA, mA] = horario.hora_apertura.split(':').map(Number);
  const [hC, mC] = horario.hora_cierre.split(':').map(Number);
  let cur = hA * 60 + mA;
  const fin = hC * 60 + mC;
  const dur = svc.duracion_min;
  while (cur + dur <= fin) {
    const startStr = `${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`;
    const endStr   = addMinutes(startStr, dur);
    const choca = ocupadas.some(r => startStr < r.hora_fin.slice(0,5) && endStr > r.hora_inicio.slice(0,5));
    if (!choca) slots.push(startStr);
    cur += 30;
  }
  res.json(slots);
});

app.post('/api/reservas', (req, res) => {
  const { nombre_completo, telefono, servicio_id, barbero_id, fecha, hora_inicio } = req.body;
  if (!nombre_completo||!telefono||!servicio_id||!barbero_id||!fecha||!hora_inicio)
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  const svc = DB.get('SELECT * FROM servicios WHERE id=?', [servicio_id]);
  if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });
  const hora_fin = addMinutes(hora_inicio, svc.duracion_min);
  const cli = getOrCreateCliente(nombre_completo, telefono);
  const conflicto = DB.get(
    `SELECT id FROM reservas WHERE barbero_id=? AND fecha=? AND estado NOT IN ('cancelada','no_asistio') AND hora_inicio < ? AND hora_fin > ?`,
    [barbero_id, fecha, hora_fin, hora_inicio]
  );
  if (conflicto) return res.status(409).json({ error: 'Ese horario ya no está disponible' });
  DB.run(`INSERT INTO reservas (cliente_id,barbero_id,servicio_id,fecha,hora_inicio,hora_fin,precio_gs,origen) VALUES (?,?,?,?,?,?,?,'web')`,
    [cli.id, barbero_id, servicio_id, fecha, hora_inicio, hora_fin, svc.precio_gs]);
  DB.saveDb();
  res.json({ mensaje: `Reserva confirmada para el ${fecha} a las ${hora_inicio}` });
});

// ══════════════════════════════════════════════════════════
//  RECEPCION
// ══════════════════════════════════════════════════════════
app.get('/api/recep/agenda', auth, rol('recepcionista','admin'), (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
  res.json(DB.all(
    `SELECT r.id,r.hora_inicio,r.hora_fin,r.estado,r.precio_gs,r.origen,
     c.nombre_completo AS cliente,c.telefono,s.nombre AS servicio,b.apodo AS barbero
     FROM reservas r JOIN clientes c ON c.id=r.cliente_id
     JOIN servicios s ON s.id=r.servicio_id JOIN barberos b ON b.id=r.barbero_id
     WHERE r.fecha=? ORDER BY r.hora_inicio`, [fecha]
  ));
});

app.post('/api/recep/reservas', auth, rol('recepcionista','admin'), (req, res) => {
  const { nombre_completo,telefono,servicio_id,barbero_id,fecha,hora_inicio,origen,notas } = req.body;
  if (!nombre_completo||!telefono||!servicio_id||!barbero_id||!fecha||!hora_inicio)
    return res.status(400).json({ error: 'Campos obligatorios faltantes' });
  const svc = DB.get('SELECT * FROM servicios WHERE id=?', [servicio_id]);
  if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });
  const hora_fin = addMinutes(hora_inicio, svc.duracion_min);
  const cli = getOrCreateCliente(nombre_completo, telefono);
  const conflicto = DB.get(
    `SELECT id FROM reservas WHERE barbero_id=? AND fecha=? AND estado NOT IN ('cancelada','no_asistio') AND hora_inicio < ? AND hora_fin > ?`,
    [barbero_id, fecha, hora_fin, hora_inicio]
  );
  if (conflicto) return res.status(409).json({ error: 'Horario ocupado' });
  DB.run(`INSERT INTO reservas (cliente_id,barbero_id,servicio_id,fecha,hora_inicio,hora_fin,precio_gs,origen,notas) VALUES (?,?,?,?,?,?,?,?,?)`,
    [cli.id,barbero_id,servicio_id,fecha,hora_inicio,hora_fin,svc.precio_gs,origen||'presencial',notas||null]);
  DB.saveDb();
  res.json({ mensaje: `Reserva creada para ${nombre_completo} el ${fecha} a las ${hora_inicio}` });
});

app.patch('/api/recep/reservas/:id/estado', auth, rol('recepcionista','admin'), (req, res) => {
  const { estado } = req.body;
  DB.run('UPDATE reservas SET estado=? WHERE id=?', [estado, req.params.id]);
  if (estado === 'completada') {
    const r = DB.get('SELECT cliente_id FROM reservas WHERE id=?', [req.params.id]);
    if (r) DB.run('UPDATE clientes SET total_visitas=total_visitas+1 WHERE id=?', [r.cliente_id]);
  }
  DB.saveDb();
  res.json({ ok: true });
});

app.get('/api/recep/clientes', auth, rol('recepcionista','admin'), (req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(DB.all(
    `SELECT id,nombre_completo,telefono,total_visitas,notas_internas FROM clientes
     WHERE nombre_completo LIKE ? OR telefono LIKE ? ORDER BY total_visitas DESC LIMIT 50`, [q, q]
  ));
});

app.get('/api/recep/caja/hoy', auth, rol('recepcionista','admin'), (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const ventas = DB.all(`SELECT * FROM caja WHERE date(creado_en)=? ORDER BY creado_en DESC`, [hoy]);
  res.json({ ventas, total_hoy: ventas.reduce((s,v) => s + v.total_gs, 0) });
});

app.post('/api/recep/caja', auth, rol('recepcionista','admin'), (req, res) => {
  const { reserva_id, total_gs, metodo_pago, notas } = req.body;
  if (!total_gs || total_gs <= 0) return res.status(400).json({ error: 'Monto inválido' });
  DB.run('INSERT INTO caja (reserva_id,total_gs,metodo_pago,notas) VALUES (?,?,?,?)',
    [reserva_id||null, total_gs, metodo_pago||'efectivo', notas||null]);
  DB.saveDb();
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════
//  BARBERO
// ══════════════════════════════════════════════════════════
app.get('/api/barbero/agenda', auth, rol('barbero','admin'), (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
  const bid = req.user.barbero_id;
  if (!bid) return res.status(400).json({ error: 'Sin barbero asociado' });
  res.json(DB.all(
    `SELECT r.id,r.hora_inicio,r.hora_fin,r.estado,r.precio_gs,r.origen,
     c.nombre_completo AS cliente,c.telefono,s.nombre AS servicio,b.apodo AS barbero
     FROM reservas r JOIN clientes c ON c.id=r.cliente_id
     JOIN servicios s ON s.id=r.servicio_id JOIN barberos b ON b.id=r.barbero_id
     WHERE r.barbero_id=? AND r.fecha=? ORDER BY r.hora_inicio`, [bid, fecha]
  ));
});

app.patch('/api/barbero/reservas/:id/estado', auth, rol('barbero','admin'), (req, res) => {
  const { estado } = req.body;
  DB.run('UPDATE reservas SET estado=? WHERE id=?', [estado, req.params.id]);
  if (estado === 'completada') {
    const r = DB.get('SELECT cliente_id FROM reservas WHERE id=?', [req.params.id]);
    if (r) DB.run('UPDATE clientes SET total_visitas=total_visitas+1 WHERE id=?', [r.cliente_id]);
  }
  DB.saveDb();
  res.json({ ok: true });
});

app.get('/api/barbero/clientes', auth, rol('barbero','admin'), (req, res) => {
  const bid = req.user.barbero_id;
  res.json(DB.all(
    `SELECT c.nombre_completo,c.telefono,COUNT(r.id) AS visitas,MAX(r.fecha) AS ultima_visita
     FROM reservas r JOIN clientes c ON c.id=r.cliente_id
     WHERE r.barbero_id=? AND r.estado='completada' GROUP BY c.id ORDER BY visitas DESC`, [bid]
  ));
});

// ══════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════
app.get('/api/admin/reservas', auth, rol('admin'), (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
  res.json(DB.all(
    `SELECT r.id,r.hora_inicio,r.hora_fin,r.estado,r.precio_gs,r.origen,
     c.nombre_completo AS cliente,c.telefono,s.nombre AS servicio,b.apodo AS barbero
     FROM reservas r JOIN clientes c ON c.id=r.cliente_id
     JOIN servicios s ON s.id=r.servicio_id JOIN barberos b ON b.id=r.barbero_id
     WHERE r.fecha=? ORDER BY r.hora_inicio`, [fecha]
  ));
});

app.get('/api/admin/metricas', auth, rol('admin'), (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const mes = hoy.slice(0,7);
  const all_mes = DB.all(`SELECT estado,precio_gs,fecha FROM reservas WHERE substr(fecha,1,7)=?`, [mes]);
  const mesActual = {
    total:      all_mes.length,
    completadas:all_mes.filter(r=>r.estado==='completada').length,
    canceladas: all_mes.filter(r=>r.estado==='cancelada').length,
    ingresos:   all_mes.filter(r=>r.estado==='completada').reduce((s,r)=>s+(r.precio_gs||0),0)
  };
  const porBarbero = DB.all(
    `SELECT b.apodo,SUM(r.precio_gs) AS ingresos FROM reservas r JOIN barberos b ON b.id=r.barbero_id
     WHERE r.estado='completada' AND substr(r.fecha,1,7)=? GROUP BY b.id ORDER BY ingresos DESC`, [mes]
  );
  const porServicio = DB.all(
    `SELECT s.nombre,COUNT(*) AS veces FROM reservas r JOIN servicios s ON s.id=r.servicio_id
     WHERE substr(r.fecha,1,7)=? GROUP BY s.id ORDER BY veces DESC LIMIT 5`, [mes]
  );
  const porMes = DB.all(
    `SELECT substr(fecha,1,7) AS mes,SUM(CASE WHEN estado='completada' THEN precio_gs ELSE 0 END) AS ingresos
     FROM reservas GROUP BY substr(fecha,1,7) ORDER BY mes DESC LIMIT 6`
  );
  const cajaRows = DB.all(`SELECT total_gs,metodo_pago FROM caja WHERE date(creado_en)=?`, [hoy]);
  const cajaHoy = {
    total:    cajaRows.reduce((s,v)=>s+v.total_gs,0),
    ventas:   cajaRows.length,
    efectivo: cajaRows.filter(v=>v.metodo_pago==='efectivo').reduce((s,v)=>s+v.total_gs,0),
    transfer: cajaRows.filter(v=>v.metodo_pago==='transferencia').reduce((s,v)=>s+v.total_gs,0),
  };
  res.json({ mesActual, porBarbero, porServicio, porMes, cajaHoy });
});

app.get('/api/admin/servicios', auth, rol('admin'), (req, res) => {
  res.json(DB.all('SELECT * FROM servicios ORDER BY categoria,nombre'));
});

app.put('/api/admin/servicios/:id', auth, rol('admin'), (req, res) => {
  const { nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium,activo } = req.body;
  DB.run(`UPDATE servicios SET nombre=?,descripcion=?,precio_gs=?,duracion_min=?,categoria=?,icono=?,es_premium=?,activo=? WHERE id=?`,
    [nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium?1:0,activo?1:0,req.params.id]);
  DB.saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/horarios', auth, rol('admin'), (req, res) => {
  res.json(DB.all('SELECT * FROM horarios ORDER BY dia_semana'));
});

app.put('/api/admin/horarios/:dia', auth, rol('admin'), (req, res) => {
  const { hora_apertura, hora_cierre, activo } = req.body;
  const existe = DB.get('SELECT id FROM horarios WHERE dia_semana=?', [req.params.dia]);
  if (existe) {
    DB.run('UPDATE horarios SET hora_apertura=?,hora_cierre=?,activo=? WHERE dia_semana=?',
      [hora_apertura, hora_cierre, activo?1:0, req.params.dia]);
  } else {
    DB.run('INSERT INTO horarios (dia_semana,hora_apertura,hora_cierre,activo) VALUES (?,?,?,?)',
      [req.params.dia, hora_apertura, hora_cierre, activo?1:0]);
  }
  DB.saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/barberos', auth, rol('admin'), (req, res) => {
  res.json(DB.all(
    `SELECT b.*,u.username FROM barberos b LEFT JOIN usuarios u ON u.id=b.usuario_id ORDER BY b.orden`
  ));
});

app.get('/api/admin/clientes', auth, rol('admin'), (req, res) => {
  res.json(DB.all(
    `SELECT c.*,COUNT(r.id) AS reservas_total FROM clientes c
     LEFT JOIN reservas r ON r.cliente_id=c.id GROUP BY c.id ORDER BY c.total_visitas DESC`
  ));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════════════════════════════════════════════════════
//  ARRANQUE
// ══════════════════════════════════════════════════════════
initDb().then(dbInstance => {
  DB = dbInstance;
  dbReady = true;
  app.listen(PORT, () => {
    console.log(`\n🪒 Jatere Barber corriendo en http://localhost:${PORT}`);
    console.log(`📁 Base de datos: jatere.db\n`);
  });
}).catch(err => {
  console.error('❌ Error al iniciar la base de datos:', err);
  process.exit(1);
});
