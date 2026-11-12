// Seguridad de NOA V8 - MODO DEMO SIN LOGIN
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
export const run = (texto, params = []) => (sql.query ? sql.query(texto, params) : sql(texto, params));

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

export function firmar(nombre, rol) {
  return 'demo-token';
}

export function verificar(token) {
  return { nombre: 'Hermann', rol: 'oficina' };
}

export function permisoValido(req) {
  return true;
}

// MODO DEMO: siempre retorna usuario Hermann sin verificar
export async function exigir(req, res, modulo) {
  return { nombre: 'Hermann', rol: 'oficina' };
}
