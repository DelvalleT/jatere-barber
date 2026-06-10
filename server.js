// server.js — Jatere Barber — PostgreSQL Railway compatible
require('dotenv').config();
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

let DB;
let dbReady = false;

// ── HELPERS ──────────────────────────────────────────────
function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total  = h * 60 + m + mins;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
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

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    const user = await DB.get('SELECT * FROM usuarios WHERE username=$1 AND activo=1', [username]);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    let barbero_id = null;
    if (user.rol === 'barbero') {
      const b = await DB.get('SELECT id FROM barberos WHERE usuario_id=$1', [user.id]);
      barbero_id = b?.id || null;
    }
    const token = jwt.sign({ id: user.id, rol: user.rol, nombre: user.nombre, barbero_id }, SECRET, { expiresIn: '8h' });
    res.json({ token, rol: user.rol, nombre: user.nombre, barbero_id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// BARBEROS
app.get('/api/barberos', async (req, res) => {
  try {
    res.json(await DB.all('SELECT id,apodo,especialidad,es_principal FROM barberos WHERE activo=1 ORDER BY orden ASC'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SERVICIOS
app.get('/api/servicios', async (req, res) => {
  try {
    res.json(await DB.all('SELECT id,nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium FROM servicios WHERE activo=1 ORDER BY categoria,nombre'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// HORARIOS
app.get('/api/horarios', async (req, res) => {
  try {
    res.json(await DB.all('SELECT dia_semana,hora_apertura,hora_cierre FROM horarios WHERE activo=1 ORDER BY dia_semana'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DISPONIBILIDAD
app.get('/api/disponibilidad', async (req, res) => {
  try {
    const { barbero_id, fecha, servicio_id } = req.query;
    if (!barbero_id || !fecha || !servicio_id) return res.status(400).json({ error: 'Faltan parámetros' });
    const svc = await DB.get('SELECT duracion_min FROM servicios WHERE id=$1', [servicio_id]);
    if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });
    const diaSemana = new Date(fecha + 'T12:00:00').getDay();
    const horario = await DB.get('SELECT * FROM horarios WHERE dia_semana=$1 AND activo=1', [diaSemana]);
    if (!horario) return res.json([]);
    const ocupadas = await DB.all(
      `SELECT hora_inicio,hora_fin FROM reservas WHERE barbero_id=$1 AND fecha=$2 AND estado NOT IN ('cancelada','no_asistio')`,
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CREAR RESERVA (público)
app.post('/api/reservas', async (req, res) => {
  try {
    const { nombre_completo, telefono, servicio_id, barbero_id, fecha, hora_inicio } = req.body;
    if (!nombre_completo||!telefono||!servicio_id||!barbero_id||!fecha||!hora_inicio)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    const svc = await DB.get('SELECT * FROM servicios WHERE id=$1', [servicio_id]);
    if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });
    const hora_fin = addMinutes(hora_inicio, svc.duracion_min);
    // Buscar o crear cliente
    let cli = await DB.get('SELECT * FROM clientes WHERE telefono=$1', [telefono]);
    if (!cli) {
      const r = await DB.run(
        'INSERT INTO clientes (nombre_completo,telefono) VALUES ($1,$2) RETURNING id',
        [nombre_completo, telefono]
      );
      cli = { id: r.lastInsertRowid };
    }
    const conflicto = await DB.get(
      `SELECT id FROM reservas WHERE barbero_id=$1 AND fecha=$2 AND estado NOT IN ('cancelada','no_asistio') AND hora_inicio < $3 AND hora_fin > $4`,
      [barbero_id, fecha, hora_fin, hora_inicio]
    );
    if (conflicto) return res.status(409).json({ error: 'Ese horario ya no está disponible' });
    await DB.run(
      `INSERT INTO reservas (cliente_id,barbero_id,servicio_id,fecha,hora_inicio,hora_fin,precio_gs,origen) VALUES ($1,$2,$3,$4,$5,$6,$7,'web')`,
      [cli.id, barbero_id, servicio_id, fecha, hora_inicio, hora_fin, svc.precio_gs]
    );
    res.json({ mensaje: `Reserva confirmada para el ${fecha} a las ${hora_inicio}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  RECEPCIÓN
// ══════════════════════════════════════════════════════════

app.get('/api/recep/agenda', auth, rol('recepcionista','admin'), async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    res.json(await DB.all(
      `SELECT r.id,r.hora_inicio,r.hora_fin,r.estado,r.precio_gs,r.origen,
       c.nombre_completo AS cliente,c.telefono,s.nombre AS servicio,b.apodo AS barbero
       FROM reservas r JOIN clientes c ON c.id=r.cliente_id
       JOIN servicios s ON s.id=r.servicio_id JOIN barberos b ON b.id=r.barbero_id
       WHERE r.fecha=$1 ORDER BY r.hora_inicio`, [fecha]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/recep/reservas', auth, rol('recepcionista','admin'), async (req, res) => {
  try {
    const { nombre_completo,telefono,servicio_id,barbero_id,fecha,hora_inicio,origen,notas } = req.body;
    if (!nombre_completo||!telefono||!servicio_id||!barbero_id||!fecha||!hora_inicio)
      return res.status(400).json({ error: 'Campos obligatorios faltantes' });
    const svc = await DB.get('SELECT * FROM servicios WHERE id=$1', [servicio_id]);
    if (!svc) return res.status(404).json({ error: 'Servicio no encontrado' });
    const hora_fin = addMinutes(hora_inicio, svc.duracion_min);
    let cli = await DB.get('SELECT * FROM clientes WHERE telefono=$1', [telefono]);
    if (!cli) {
      const r = await DB.run(
        'INSERT INTO clientes (nombre_completo,telefono) VALUES ($1,$2) RETURNING id',
        [nombre_completo, telefono]
      );
      cli = { id: r.lastInsertRowid };
    }
    const conflicto = await DB.get(
      `SELECT id FROM reservas WHERE barbero_id=$1 AND fecha=$2 AND estado NOT IN ('cancelada','no_asistio') AND hora_inicio < $3 AND hora_fin > $4`,
      [barbero_id, fecha, hora_fin, hora_inicio]
    );
    if (conflicto) return res.status(409).json({ error: 'Horario ocupado' });
    await DB.run(
      `INSERT INTO reservas (cliente_id,barbero_id,servicio_id,fecha,hora_inicio,hora_fin,precio_gs,origen,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cli.id,barbero_id,servicio_id,fecha,hora_inicio,hora_fin,svc.precio_gs,origen||'presencial',notas||null]
    );
    res.json({ mensaje: `Reserva creada para ${nombre_completo} el ${fecha} a las ${hora_inicio}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/recep/reservas/:id/estado', auth, rol('recepcionista','admin'), async (req, res) => {
  try {
    const { estado } = req.body;
    await DB.run('UPDATE reservas SET estado=$1 WHERE id=$2', [estado, req.params.id]);
    if (estado === 'completada') {
      const r = await DB.get('SELECT cliente_id FROM reservas WHERE id=$1', [req.params.id]);
      if (r) await DB.run('UPDATE clientes SET total_visitas=total_visitas+1 WHERE id=$1', [r.cliente_id]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/recep/clientes', auth, rol('recepcionista','admin'), async (req, res) => {
  try {
    const q = `%${req.query.q || ''}%`;
    res.json(await DB.all(
      `SELECT id,nombre_completo,telefono,total_visitas,notas_internas FROM clientes
       WHERE nombre_completo ILIKE $1 OR telefono ILIKE $1 ORDER BY total_visitas DESC LIMIT 50`, [q]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/recep/caja/hoy', auth, rol('recepcionista','admin'), async (req, res) => {
  try {
    const ventas = await DB.all(`SELECT * FROM caja WHERE DATE(creado_en)=CURRENT_DATE ORDER BY creado_en DESC`);
    res.json({ ventas, total_hoy: ventas.reduce((s,v) => s + v.total_gs, 0) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/recep/caja', auth, rol('recepcionista','admin'), async (req, res) => {
  try {
    const { reserva_id, total_gs, metodo_pago, notas } = req.body;
    if (!total_gs || total_gs <= 0) return res.status(400).json({ error: 'Monto inválido' });
    await DB.run(
      'INSERT INTO caja (reserva_id,total_gs,metodo_pago,notas) VALUES ($1,$2,$3,$4)',
      [reserva_id||null, total_gs, metodo_pago||'efectivo', notas||null]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  BARBERO
// ══════════════════════════════════════════════════════════

app.get('/api/barbero/agenda', auth, rol('barbero','admin'), async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    const bid = req.user.barbero_id;
    if (!bid) return res.status(400).json({ error: 'Sin barbero asociado' });
    res.json(await DB.all(
      `SELECT r.id,r.hora_inicio,r.hora_fin,r.estado,r.precio_gs,r.origen,
       c.nombre_completo AS cliente,c.telefono,s.nombre AS servicio,b.apodo AS barbero
       FROM reservas r JOIN clientes c ON c.id=r.cliente_id
       JOIN servicios s ON s.id=r.servicio_id JOIN barberos b ON b.id=r.barbero_id
       WHERE r.barbero_id=$1 AND r.fecha=$2 ORDER BY r.hora_inicio`, [bid, fecha]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/barbero/reservas/:id/estado', auth, rol('barbero','admin'), async (req, res) => {
  try {
    const { estado } = req.body;
    await DB.run('UPDATE reservas SET estado=$1 WHERE id=$2', [estado, req.params.id]);
    if (estado === 'completada') {
      const r = await DB.get('SELECT cliente_id FROM reservas WHERE id=$1', [req.params.id]);
      if (r) await DB.run('UPDATE clientes SET total_visitas=total_visitas+1 WHERE id=$1', [r.cliente_id]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/barbero/clientes', auth, rol('barbero','admin'), async (req, res) => {
  try {
    const bid = req.user.barbero_id;
    res.json(await DB.all(
      `SELECT c.nombre_completo,c.telefono,COUNT(r.id) AS visitas,MAX(r.fecha) AS ultima_visita
       FROM reservas r JOIN clientes c ON c.id=r.cliente_id
       WHERE r.barbero_id=$1 AND r.estado='completada' GROUP BY c.id ORDER BY visitas DESC`, [bid]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════

app.get('/api/admin/reservas', auth, rol('admin'), async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    res.json(await DB.all(
      `SELECT r.id,r.hora_inicio,r.hora_fin,r.estado,r.precio_gs,r.origen,
       c.nombre_completo AS cliente,c.telefono,s.nombre AS servicio,b.apodo AS barbero
       FROM reservas r JOIN clientes c ON c.id=r.cliente_id
       JOIN servicios s ON s.id=r.servicio_id JOIN barberos b ON b.id=r.barbero_id
       WHERE r.fecha=$1 ORDER BY r.hora_inicio`, [fecha]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/metricas', auth, rol('admin'), async (req, res) => {
  try {
    const mes = new Date().toISOString().slice(0,7);
    const all_mes = await DB.all(
      `SELECT estado,precio_gs FROM reservas WHERE TO_CHAR(creado_en,'YYYY-MM')=$1`, [mes]
    );
    const mesActual = {
      total:       all_mes.length,
      completadas: all_mes.filter(r=>r.estado==='completada').length,
      canceladas:  all_mes.filter(r=>r.estado==='cancelada').length,
      ingresos:    all_mes.filter(r=>r.estado==='completada').reduce((s,r)=>s+(r.precio_gs||0),0)
    };
    const porBarbero = await DB.all(
      `SELECT b.apodo,COALESCE(SUM(r.precio_gs),0) AS ingresos FROM reservas r
       JOIN barberos b ON b.id=r.barbero_id
       WHERE r.estado='completada' AND TO_CHAR(r.creado_en,'YYYY-MM')=$1
       GROUP BY b.apodo ORDER BY ingresos DESC`, [mes]
    );
    const porServicio = await DB.all(
      `SELECT s.nombre,COUNT(*) AS veces FROM reservas r JOIN servicios s ON s.id=r.servicio_id
       WHERE TO_CHAR(r.creado_en,'YYYY-MM')=$1 GROUP BY s.nombre ORDER BY veces DESC LIMIT 5`, [mes]
    );
    const porMes = await DB.all(
      `SELECT TO_CHAR(creado_en,'YYYY-MM') AS mes,
       COALESCE(SUM(CASE WHEN estado='completada' THEN precio_gs ELSE 0 END),0) AS ingresos
       FROM reservas GROUP BY TO_CHAR(creado_en,'YYYY-MM') ORDER BY mes DESC LIMIT 6`
    );
    const cajaRows = await DB.all(
      `SELECT total_gs,metodo_pago FROM caja WHERE DATE(creado_en)=CURRENT_DATE`
    );
    const cajaHoy = {
      total:    cajaRows.reduce((s,v)=>s+v.total_gs,0),
      ventas:   cajaRows.length,
      efectivo: cajaRows.filter(v=>v.metodo_pago==='efectivo').reduce((s,v)=>s+v.total_gs,0),
      transfer: cajaRows.filter(v=>v.metodo_pago==='transferencia').reduce((s,v)=>s+v.total_gs,0),
    };
    res.json({ mesActual, porBarbero, porServicio, porMes, cajaHoy });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/servicios', auth, rol('admin'), async (req, res) => {
  try {
    res.json(await DB.all('SELECT * FROM servicios ORDER BY categoria,nombre'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/servicios/:id', auth, rol('admin'), async (req, res) => {
  try {
    const { nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium,activo } = req.body;
    await DB.run(
      `UPDATE servicios SET nombre=$1,descripcion=$2,precio_gs=$3,duracion_min=$4,categoria=$5,icono=$6,es_premium=$7,activo=$8 WHERE id=$9`,
      [nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium?1:0,activo?1:0,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/horarios', auth, rol('admin'), async (req, res) => {
  try {
    res.json(await DB.all('SELECT * FROM horarios ORDER BY dia_semana'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/horarios/:dia', auth, rol('admin'), async (req, res) => {
  try {
    const { hora_apertura, hora_cierre, activo } = req.body;
    const existe = await DB.get('SELECT id FROM horarios WHERE dia_semana=$1', [req.params.dia]);
    if (existe) {
      await DB.run(
        'UPDATE horarios SET hora_apertura=$1,hora_cierre=$2,activo=$3 WHERE dia_semana=$4',
        [hora_apertura, hora_cierre, activo?1:0, req.params.dia]
      );
    } else {
      await DB.run(
        'INSERT INTO horarios (dia_semana,hora_apertura,hora_cierre,activo) VALUES ($1,$2,$3,$4)',
        [req.params.dia, hora_apertura, hora_cierre, activo?1:0]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/barberos', auth, rol('admin'), async (req, res) => {
  try {
    res.json(await DB.all(
      `SELECT b.*,u.username FROM barberos b LEFT JOIN usuarios u ON u.id=b.usuario_id ORDER BY b.orden`
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/clientes', auth, rol('admin'), async (req, res) => {
  try {
    res.json(await DB.all(
      `SELECT c.*,COUNT(r.id) AS reservas_total FROM clientes c
       LEFT JOIN reservas r ON r.cliente_id=c.id GROUP BY c.id ORDER BY c.total_visitas DESC`
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SPA fallback
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
    console.log(`\n✂  Jatere Barber corriendo en http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('❌ Error al iniciar:', err.message);
  process.exit(1);
});