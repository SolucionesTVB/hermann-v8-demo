// Seguridad de NOA: usuarios, claves (scrypt), sesiones firmadas y bitácora.
// El archivo empieza con _ para que Vercel no lo publique como ruta.
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
export const run = (texto, params = []) => (sql.query ? sql.query(texto, params) : sql(texto, params));

const VIDA_MS = 12 * 3600 * 1000;

function llave() {
  const base = process.env.AUTH_SECRET || (process.env.BACKUP_KEY ? 'derivado|' + process.env.BACKUP_KEY + '|' + (process.env.CRON_SECRET || '') : '');
  return base ? crypto.createHash('sha256').update('noa-auth|' + base).digest() : null;
}

const b64 = b => Buffer.from(b).toString('base64url');

export function firmar(nombre, rol, vida, tipo) {
  const k = llave();
  if (!k) throw new Error('SIN_SECRETO');
  const cuerpo = b64(JSON.stringify({ u: nombre, r: rol, e: Date.now() + (vida || VIDA_MS), t: tipo || 's' }));
  const firma = crypto.createHmac('sha256', k).update(cuerpo).digest('base64url');
  return cuerpo + '.' + firma;
}

export function verificar(token, tipo) {
  const k = llave();
  if (!k || typeof token !== 'string') return null;
  const [cuerpo, firma] = token.split('.');
  if (!cuerpo || !firma) return null;
  const esperada = crypto.createHmac('sha256', k).update(cuerpo).digest('base64url');
  const a = Buffer.from(firma), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (!p.e || p.e < Date.now()) return null;
    if ((p.t || 's') !== (tipo || 's')) return null;
    return { nombre: p.u, rol: p.r };
  } catch (e) { return null; }
}

export function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + sal + '$' + crypto.scryptSync(String(clave), sal, 32).toString('hex');
}

export function claveCorrecta(clave, guardado) {
  try {
    const [t, sal, h] = String(guardado || '').split('$');
    if (t !== 'scrypt' || !sal || !h) return false;
    const calc = crypto.scryptSync(String(clave), sal, 32);
    const real = Buffer.from(h, 'hex');
    return calc.length === real.length && crypto.timingSafeEqual(calc, real);
  } catch (e) { return false; }
}

const PALABRAS = ['Cielo', 'Monte', 'Rio', 'Sol', 'Luna', 'Cafe', 'Roble', 'Nube', 'Flor', 'Lago'];
export function claveTemporal() {
  const p = () => PALABRAS[crypto.randomInt(PALABRAS.length)];
  return p() + '-' + String(crypto.randomInt(10000)).padStart(4, '0') + '-' + p();
}

let listo = null;
export function prepararAuth() {
  if (!listo) {
    listo = (async () => {
      await run('CREATE TABLE IF NOT EXISTS usuarios (nombre TEXT PRIMARY KEY, rol TEXT NOT NULL DEFAULT \'oficina\', hash TEXT NOT NULL, debe_cambiar BOOLEAN NOT NULL DEFAULT TRUE, activo BOOLEAN NOT NULL DEFAULT TRUE, fallos INTEGER NOT NULL DEFAULT 0, bloqueado_hasta TIMESTAMPTZ, creado TIMESTAMPTZ DEFAULT NOW())');
      await run('CREATE TABLE IF NOT EXISTS bitacora (id SERIAL PRIMARY KEY, fecha TIMESTAMPTZ DEFAULT NOW(), usuario TEXT, accion TEXT, detalle TEXT)');
    })().catch(e => { listo = null; throw e; });
  }
  return listo;
}

export async function anotar(usuario, accion, detalle) {
  try {
    await prepararAuth();
    await run('INSERT INTO bitacora (usuario, accion, detalle) VALUES ($1, $2, $3)', [String(usuario || '').slice(0, 60), String(accion || '').slice(0, 80), String(detalle || '').slice(0, 300)]);
  } catch (e) { /* la bitácora nunca debe tumbar una operación */ }
}

function detalleDe(req) {
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const q = req.query || {};
  const p = [];
  if (b.id !== undefined) p.push('id ' + b.id);
  if (b.cliente_id !== undefined) p.push('cliente ' + b.cliente_id);
  else if (q.cliente_id) p.push('cliente ' + q.cliente_id);
  if (Array.isArray(b.clientes)) p.push(b.clientes.length + ' cliente(s)');
  if (b.cambios && typeof b.cambios === 'object') p.push('campos: ' + Object.keys(b.cambios).join(','));
  if (b.canal) p.push('canal ' + b.canal);
  return p.join(' · ');
}

// Permiso corto (5 min) que se gana escribiendo la clave de seguridad. Viaja en el encabezado X-Permiso.
export function permisoValido(req) {
  const t = String((req.headers && req.headers['x-permiso']) || '');
  return !!verificar(t, 'p');
}

// Guardia de cada api: devuelve el usuario, o responde 401 y devuelve null.
export async function exigir(req, res, modulo) {
  if (!llave()) { res.status(500).json({ error: 'Falta configurar la seguridad del sistema' }); return null; }
  const h = String((req.headers && req.headers.authorization) || '');
  let token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token && req.method === 'GET' && req.query && req.query.action === 'abrir') token = String(req.query.t || '');
  const u = verificar(token);
  if (!u) { res.status(401).json({ error: 'No autorizado', login: true }); return null; }
  if (req.method !== 'GET' && modulo !== 'asistente') {
    await anotar(u.nombre, modulo + ':' + ((req.query && req.query.action) || req.method), detalleDe(req));
  }
  return u;
}
