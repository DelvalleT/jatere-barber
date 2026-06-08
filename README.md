# 🪒 Jatere Barber — Backend

Backend completo en **Node.js + SQLite** para el sistema de Jatere Barber.

---

## 📁 Estructura de archivos

```
jatere-backend/
├── server.js        ← servidor Express con todas las rutas API
├── db.js            ← base de datos SQLite + datos iniciales
├── package.json     ← dependencias
├── jatere.db        ← se crea automáticamente al iniciar
└── public/          ← PON AQUÍ tus archivos del frontend
    ├── index.html
    ├── main.css
    └── app.js
```

---

## 🚀 Instalación y arranque

### 1. Instalar Node.js
Descargá Node.js desde: https://nodejs.org (versión 18 o superior)

### 2. Instalar dependencias
```bash
cd jatere-backend
npm install
```

### 3. Copiar archivos del frontend
Creá la carpeta `public/` dentro de `jatere-backend/` y copiá ahí:
- `index.html`
- `main.css`
- `app.js`

### 4. Configurar el frontend para usar el backend

En tu archivo `app.js`, la línea:
```js
const API = ''; // vacío = mismo servidor
```
Dejala vacía `''` si el frontend está en la carpeta `public/` del mismo servidor.

Si estás probando en desarrollo con Live Server u otro servidor local, cambiala a:
```js
const API = 'http://localhost:3001';
```

### 5. Iniciar el servidor
```bash
node server.js
```

Abrí: http://localhost:3001

---

## 🔐 Credenciales de acceso

| Tipo          | Usuario     | Contraseña  |
|---------------|-------------|-------------|
| Administrador | admin       | admin123    |
| Recepcionista | recepcion   | recep123    |
| Barbero       | rafael      | barber123   |
| Barbero       | axel        | barber123   |
| Barbero       | benjamin    | barber123   |
| Barbero       | gonsalo     | barber123   |
| Barbero       | navid       | barber123   |

---

## ✂️ Barberos cargados

| Nombre    | Especialidad                    |
|-----------|---------------------------------|
| Rafael    | Cortes clásicos y fade          |
| Axel      | Degradados y diseños            |
| Benjamín  | Barba y afeitado clásico        |
| Gonzalo   | Cortes modernos y coloración    |
| Navid     | Keratina y tratamientos         |

---

## 💈 Servicios cargados

| Servicio              | Precio      | Duración |
|-----------------------|-------------|----------|
| Corte Clásico         | 80.000 Gs   | 30 min   |
| Corte + Barba         | 120.000 Gs  | 50 min   |
| Fade / Degradado      | 90.000 Gs   | 40 min   |
| Arreglo de Barba      | 60.000 Gs   | 25 min   |
| Afeitado Clásico      | 70.000 Gs   | 30 min   |
| Corte Niños           | 60.000 Gs   | 25 min   |
| Keratina Express      | 180.000 Gs  | 60 min   |
| Coloración            | 200.000 Gs  | 90 min   |
| Corte + Fade + Barba  | 150.000 Gs  | 70 min   |

---

## ⏰ Horarios configurados

| Día       | Apertura | Cierre |
|-----------|----------|--------|
| Domingo   | 12:00    | 18:30  |
| Lun – Sáb | 09:00    | 21:00  |

Podés cambiar los horarios desde el **Panel Admin → Horarios**.

---

## 🌐 Rutas API

### Público (sin token)
```
GET  /api/barberos
GET  /api/servicios
GET  /api/horarios
GET  /api/disponibilidad?barbero_id=X&fecha=YYYY-MM-DD&servicio_id=Y
POST /api/reservas
POST /api/auth/login
```

### Recepcionista / Admin
```
GET   /api/recep/agenda?fecha=
POST  /api/recep/reservas
PATCH /api/recep/reservas/:id/estado
GET   /api/recep/clientes?q=
GET   /api/recep/caja/hoy
POST  /api/recep/caja
```

### Admin
```
GET /api/admin/reservas
GET /api/admin/metricas
GET /api/admin/servicios
PUT /api/admin/servicios/:id
PUT /api/admin/horarios/:dia
GET /api/admin/barberos
GET /api/admin/clientes
```

---

## 🛠️ Modificar datos

Para **agregar barberos**, editá `db.js` en la sección `seed()`.
Para **cambiar precios** en vivo, entrá al Panel Admin → Servicios.
Para **cambiar horarios** en vivo, entrá al Panel Admin → Horarios.

---

## 📦 Deploy en producción

Para subir a un servidor (Railway, Render, VPS):
1. Subí todos los archivos
2. Configurá `JWT_SECRET` y `PORT` como variables de entorno
3. `npm start`

```bash
JWT_SECRET=mi_clave_segura PORT=80 node server.js
```
