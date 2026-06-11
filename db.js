// db.js — PostgreSQL (Railway compatible)
require('dotenv').config();
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');
const fs        = require('fs');
const path      = require('path');

// ── CONEXIÓN ─────────────────────────────────────────────
const connString = process.env.DATABASE_URL;
console.log('🔌 Conectando a:', connString?.slice(0, 50) + '...');

const pool = new Pool({
  connectionString: connString,
  ssl: { rejectUnauthorized: false },
  family: 4,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 5,
});

// ══════════════════════════════════════════════════════════
//  HELPERS — misma API que antes para no romper server.js
// ══════════════════════════════════════════════════════════

// Equivale a all() — devuelve array de objetos
async function all(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// Equivale a get() — devuelve primer resultado
async function get(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

// Equivale a run() — INSERT/UPDATE/DELETE
async function run(sql, params = []) {
  const result = await pool.query(sql, params);
  return {
    lastInsertRowid: result.rows[0]?.id || null,
    changes: result.rowCount
  };
}

// ══════════════════════════════════════════════════════════
//  CREAR TABLAS
// ══════════════════════════════════════════════════════════
async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         SERIAL PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      rol        TEXT NOT NULL,
      nombre     TEXT NOT NULL,
      activo     INTEGER DEFAULT 1,
      creado_en  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS barberos (
      id           SERIAL PRIMARY KEY,
      usuario_id   INTEGER,
      apodo        TEXT NOT NULL,
      especialidad TEXT,
      telefono     TEXT,
      instagram    TEXT,
      es_principal INTEGER DEFAULT 0,
      activo       INTEGER DEFAULT 1,
      orden        INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS servicios (
      id           SERIAL PRIMARY KEY,
      nombre       TEXT NOT NULL,
      descripcion  TEXT,
      precio_gs    INTEGER NOT NULL,
      duracion_min INTEGER NOT NULL DEFAULT 30,
      categoria    TEXT DEFAULT 'Corte',
      icono        TEXT DEFAULT '✂',
      es_premium   INTEGER DEFAULT 0,
      activo       INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS horarios (
      id            SERIAL PRIMARY KEY,
      dia_semana    INTEGER NOT NULL,
      hora_apertura TEXT NOT NULL,
      hora_cierre   TEXT NOT NULL,
      activo        INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id              SERIAL PRIMARY KEY,
      nombre_completo TEXT NOT NULL,
      telefono        TEXT NOT NULL,
      email           TEXT,
      total_visitas   INTEGER DEFAULT 0,
      notas_internas  TEXT,
      creado_en       TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reservas (
      id           SERIAL PRIMARY KEY,
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
      creado_en    TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS caja (
      id           SERIAL PRIMARY KEY,
      reserva_id   INTEGER,
      total_gs     INTEGER NOT NULL,
      metodo_pago  TEXT DEFAULT 'efectivo',
      notas        TEXT,
      creado_en    TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Tablas creadas');
}

// ══════════════════════════════════════════════════════════
//  SEED — datos iniciales
// ══════════════════════════════════════════════════════════
async function seed() {
  const existe = await get('SELECT COUNT(*) as n FROM usuarios');
  if (parseInt(existe?.n) > 0) return;

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
  for (const u of users) {
    await pool.query(
      'INSERT INTO usuarios (username,password,rol,nombre) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING',
      u
    );
  }

  // Barberos
  const getUid = async name => {
    const r = await get('SELECT id FROM usuarios WHERE username=$1', [name]);
    return r?.id;
  };

  const barberos = [
    ['rafael',   'Rafael',   'Cortes de calidad y estilo',  '0981 000001', 0, 1],
    ['axel',     'Axel',     'Cortes de calidad y estilo',   '0981 000002', 1, 2],
    ['benjamin', 'Benjamín', 'Cortes de calidad y estilo',    '0981 000003', 0, 3],
    ['gonzalo',  'Gonzalo',  'Cortes de calidad y estilo',       '0981 000004', 0, 4],
    ['navid',    'Navid',    'Cortes de calidad y estilo',  '0981 000005', 0, 5],
  ];
  for (const [username, apodo, esp, tel, principal, orden] of barberos) {
    const uid = await getUid(username);
    await pool.query(
      'INSERT INTO barberos (usuario_id,apodo,especialidad,telefono,es_principal,activo,orden) VALUES ($1,$2,$3,$4,$5,1,$6)',
      [uid, apodo, esp, tel, principal, orden]
    );
  }

  // Servicios
  const svcs = [
    ['Corte Clásico',        'Corte tradicional con tijera y máquina',            35000,  30, 'Corte', '✂',  0],
    ['Corte + Barba',        'Corte completo con arreglo de barba',              120000,  50, 'Combo', '🪒', 0],
    ['Cejas',     'Perfilacion y estilización de cejas',            10000,  40, 'Corte', '✂',  0],
    ['Corte + cejas/Lavado',     'Corte completo para un estilo de calidad',            45000,  40, 'Corte', '✂',  0],
    ['Corte moderno',     'Estilo moderno, tu decides cual',            40000,  40, 'Corte', '✂',  0],
    ['Corte + cejas + Barba', 'Servicio completo: corte, cejas y barba',           130000,  70, 'Combo', '⭐', 1],
  ];
  for (const s of svcs) {
    await pool.query(
      'INSERT INTO servicios (nombre,descripcion,precio_gs,duracion_min,categoria,icono,es_premium) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      s
    );
  }

  // Horarios
  const hors = [
    [0, '12:00', '18:30'],
    [1, '09:00', '21:00'],
    [2, '09:00', '21:00'],
    [3, '09:00', '21:00'],
    [4, '09:00', '21:00'],
    [5, '09:00', '21:00'],
    [6, '09:00', '21:00'],
  ];
  for (const h of hors) {
    await pool.query(
      'INSERT INTO horarios (dia_semana,hora_apertura,hora_cierre,activo) VALUES ($1,$2,$3,1)',
      h
    );
  }

  console.log('✅ Datos iniciales cargados');
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
async function initDb() {
  await pool.connect()
    .then(c => { console.log('✅ PostgreSQL conectado'); c.release(); })
    .catch(e => { console.error('❌ PostgreSQL error:', e.message); throw e; });

  await createTables();
  await seed();

  return { all, get, run };
}

module.exports = { initDb };