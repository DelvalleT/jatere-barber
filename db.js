// db.js — Base de datos con sql.js (no requiere compilación en Windows)
const initSqlJs = require('sql.js');
const bcrypt    = require('bcryptjs');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, 'jatere.db');

let db; // instancia global

// ══════════════════════════════════════════════════════════
//  HELPERS SÍNCRONOS que imitan la API de better-sqlite3
// ══════════════════════════════════════════════════════════
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Devuelve TODOS los resultados como array de objetos
function all(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch(e) {
    throw new Error(`SQL Error (all): ${e.message}\nSQL: ${sql}`);
  }
}

// Devuelve el primer resultado o undefined
function get(sql, params = []) {
  return all(sql, params)[0];
}

// Ejecuta INSERT/UPDATE/DELETE, devuelve { lastInsertRowid, changes }
function run(sql, params = []) {
  try {
    db.run(sql, params);
    const lastInsertRowid = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] || 0;
    return { lastInsertRowid };
  } catch(e) {
    throw new Error(`SQL Error (run): ${e.message}\nSQL: ${sql}`);
  }
}

// ══════════════════════════════════════════════════════════
//  CREAR TABLAS
// ══════════════════════════════════════════════════════════
function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    rol        TEXT NOT NULL,
    nombre     TEXT NOT NULL,
    activo     INTEGER DEFAULT 1,
    creado_en  TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS barberos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id   INTEGER,
    apodo        TEXT NOT NULL,
    especialidad TEXT,
    telefono     TEXT,
    instagram    TEXT,
    es_principal INTEGER DEFAULT 0,
    activo       INTEGER DEFAULT 1,
    orden        INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS servicios (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre       TEXT NOT NULL,
    descripcion  TEXT,
    precio_gs    INTEGER NOT NULL,
    duracion_min INTEGER NOT NULL DEFAULT 30,
    categoria    TEXT DEFAULT 'Corte',
    icono        TEXT DEFAULT '✂',
    es_premium   INTEGER DEFAULT 0,
    activo       INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS horarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dia_semana    INTEGER NOT NULL,
    hora_apertura TEXT NOT NULL,
    hora_cierre   TEXT NOT NULL,
    activo        INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_completo TEXT NOT NULL,
    telefono        TEXT NOT NULL,
    email           TEXT,
    total_visitas   INTEGER DEFAULT 0,
    notas_internas  TEXT,
    creado_en       TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reservas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id   INTEGER,
    barbero_id   INTEGER,
    servicio_id  INTEGER,
    fecha        TEXT NOT NULL,
    hora_inicio  TEXT NOT NULL,
    hora_fin     TEXT NOT NULL,
    estado       TEXT DEFAULT 'pendiente',
    origen       TEXT DEFAULT 'web',
    notas        TEXT,
    precio_gs    INTEGER,
    creado_en    TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS caja (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reserva_id   INTEGER,
    total_gs     INTEGER NOT NULL,
    metodo_pago  TEXT DEFAULT 'efectivo',
    notas        TEXT,
    creado_en    TEXT DEFAULT (datetime('now'))
  )`);
}

// ══════════════════════════════════════════════════════════
//  SEED
// ══════════════════════════════════════════════════════════
function seed() {
  const yaHay = get('SELECT COUNT(*) as n FROM usuarios');
  if (yaHay && yaHay.n > 0) return;

  console.log('🌱 Insertando datos iniciales...');
  const hash = p => bcrypt.hashSync(p, 10);

  // Usuarios
  const users = [
    ['admin',     hash('admin123'),  'admin',         'Administrador'],
    ['recepcion', hash('recep123'),  'recepcionista', 'Recepción'],
    ['rafael',    hash('barber123'), 'barbero',       'Rafael'],
    ['axel',      hash('barber123'), 'barbero',       'Axel'],
    ['benjamin',  hash('barber123'), 'barbero',       'Benjamín'],
    ['gonzalo',   hash('barber123'), 'barbero',       'Gonzalo'],
    ['navid',     hash('barber123'), 'barbero',       'Navid'],
  ];
  users.forEach(u => run('INSERT INTO usuarios (username,password,rol,nombre) VALUES (?,?,?,?)', u));

  // Barberos — buscar IDs de usuarios barberos
  const getUid = name => get('SELECT id FROM usuarios WHERE username=?', [name])?.id;
  const barberos = [
    [getUid('rafael'),   'Rafael',   'Cortes de calidad y estilo','0981 000001', 0, 1],
    [getUid('axel'),     'Axel',     'Cortes de calidad y estilo','0981 000002', 1, 2],
    [getUid('benjamin'), 'Benjamín', 'Cortes de calidad y estilo','0981 000003', 0, 3],
    [getUid('gonzalo'),  'Gonzalo',  'Cortes de calidad y estilo','0981 000004', 0, 4],
    [getUid('navid'),    'Navid',    'Cortes de calidad y estilo','0981 000005', 0, 5],
  ];
  barberos.forEach(b =>
    run('INSERT INTO barberos (usuario_id,apodo,especialidad,telefono,es_principal,activo,orden) VALUES (?,?,?,?,?,1,?)', b)
  );

  // Servicios
  const svcs = [
    ['Corte Clásico',       'Corte tradicional con tijera y máquina',             80000,  30, 'Corte',   '✂',  0],
    ['Corte + Barba',       'Corte completo con arreglo de barba',               120000,  50, 'Combo',   '🪒', 0],
    ['Fade / Degradado',    'Degradado suave o skin fade con diseño',             90000,  40, 'Corte',   '✂',  0],
    ['Arreglo de Barba',    'Perfilado y delineado completo de barba',            60000,  25, 'Barba',   '🪒', 0],
    ['Corte + Fade + Barba','Servicio completo: corte, fade y barba',            150000,  70, 'Combo',   '⭐', 1],
  ];
  svcs.forEach(s =>
    run('INSERT INTO servicios (nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium) VALUES (?,?,?,?,?,?,?)', s)
  );

  // Horarios
  const hors = [
    [0, '12:00:00', '18:30:00'], // Domingo
    [1, '09:00:00', '21:00:00'], // Lunes
    [2, '09:00:00', '21:00:00'], // Martes
    [3, '09:00:00', '21:00:00'], // Miércoles
    [4, '09:00:00', '21:00:00'], // Jueves
    [5, '09:00:00', '21:00:00'], // Viernes
    [6, '09:00:00', '21:00:00'], // Sábado
  ];
  hors.forEach(h =>
    run('INSERT INTO horarios (dia_semana,hora_apertura,hora_cierre,activo) VALUES (?,?,?,1)', h)
  );

  saveDb();
  console.log('✅ Datos iniciales cargados');
}

// ══════════════════════════════════════════════════════════
//  INIT ASÍNCRONO
// ══════════════════════════════════════════════════════════
async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('📂 Base de datos cargada desde', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('🆕 Nueva base de datos creada');
  }

  createTables();
  seed();
  return { all, get, run, saveDb };
}

module.exports = { initDb };
