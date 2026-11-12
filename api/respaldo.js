import { neon } from '@neondatabase/serverless';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
// Cifrado AES-256-GCM. Formato: "NOAR1" + iv(12) + etiqueta(16) + datos. Se abre con scripts/descifrar-respaldo.mjs
function cifrar(buffer, clave) {
  const k = crypto.scryptSync(String(clave), 'noa-respaldo-v1', 32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(buffer), c.final()]);
  return Buffer.concat([Buffer.from('NOAR1'), iv, c.getAuthTag(), datos]);
}

// RESPALDO DIARIO DEL SISTEMA COMPLETO (se ejecuta solo, todos los dias a las 6 pm de Costa Rica)
// Copia 1: tabla "respaldos" de Neon (CSV de la cartera, 30 dias).
// Copia 2: repositorio privado de GitHub, con TODAS las tablas, comprimido y CIFRADO (diario 30 dias + uno mensual).
// Copia 3: correo con el Excel de la cartera (si esta configurado Resend).
// Cada copia es independiente: si una falla, las otras se hacen igual y el resultado dice cual fallo.
const sql = neon(process.env.DATABASE_URL);
const run = (t, p = []) => (sql.query ? sql.query(t, p) : sql(t, p));
const GUARDAR = 30;
const COLS = [['asegurado','Cliente'],['poliza','Póliza'],['acreedor','Acreedor'],['aseguradora','Aseguradora'],['tipo_seguro','Línea'],['periodicidad','Forma de pago'],['desde_cobro','Vencimiento'],['prima','Prima'],['moneda','Moneda'],['objeto_asegurado','Objeto Asegurado'],['anio','Año'],['placa','Placa'],['hasta','Próx Pago'],['medio_cobro','Medio de cobro'],['identificacion','Identificación'],['telefono','Tel / WA'],['telefonos_extra','Otros tel.'],['correo','Email'],['correos_extra','Otros correos'],['direccion','Dirección'],['planillas','Planillas'],['desde','Inicio'],['vence_contrato','Vence'],['pagado','Pagado'],['borrado','En papelera']];
const FECHAS = ['desde_cobro','hasta','desde','vence_contrato'];
const hoyCR = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
function celda(k, v) {
  if (v === null || v === undefined) return '';
  if (FECHAS.indexOf(k) >= 0) { const m = (v instanceof Date ? v.toISOString() : String(v)).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(v); }
  if (typeof v === 'boolean') return v ? 'Sí' : '';
  return String(v);
}
const esc = s => '"' + String(s).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
export function armarCsv(filas) {
  const lineas = [COLS.map(c => esc(c[1])).join(';')];
  filas.forEach(r => lineas.push(COLS.map(c => esc(celda(c[0], r[c[0]]))).join(';')));
  return '\uFEFF' + lineas.join('\r\n') + '\r\n';
}

// ---- Copia completa de TODAS las tablas (las nuevas que se creen en el futuro entran solas)
async function leerTodo() {
  const lista = await run("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
  const tablas = {};
  for (const t of lista) {
    const n = t.table_name;
    if (n === 'respaldos' || !/^[A-Za-z0-9_]+$/.test(n)) continue;
    tablas[n] = await run('SELECT * FROM "' + n + '"');
  }
  return tablas;
}
function resumenTexto(fecha, tablas) {
  const l = ['Respaldo del ' + fecha, 'Solo conteos, sin datos personales.', ''];
  Object.keys(tablas).forEach(n => l.push(n + ': ' + tablas[n].length + ' filas'));
  const c = tablas.clientes || [];
  l.push('', 'clientes en papelera: ' + c.filter(r => r.borrado === true).length, 'clientes marcados pagados: ' + c.filter(r => r.pagado === true).length);
  return l.join('\n') + '\n';
}

// ---- GitHub (API de contenidos)
const GH = 'https://api.github.com';
const ghHeaders = () => ({ Authorization: 'Bearer ' + process.env.GITHUB_BACKUP_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'noa-respaldo', 'Content-Type': 'application/json' });
async function ghSha(repo, ruta) {
  const r = await fetch(GH + '/repos/' + repo + '/contents/' + ruta, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub leer ' + r.status);
  const j = await r.json();
  return j.sha || null;
}
async function ghPonerArchivo(repo, ruta, buffer, mensaje) {
  const sha = await ghSha(repo, ruta);
  const body = { message: mensaje, content: buffer.toString('base64') };
  if (sha) body.sha = sha;
  const r = await fetch(GH + '/repos/' + repo + '/contents/' + ruta, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error('GitHub escribir ' + ruta + ' ' + r.status);
}
async function ghLimpiarViejos(repo, fecha) {
  const r = await fetch(GH + '/repos/' + repo + '/contents/diario', { headers: ghHeaders() });
  if (!r.ok) return 0;
  const lista = await r.json();
  const limite = new Date(fecha + 'T00:00:00Z').getTime() - GUARDAR * 86400e3;
  let borrados = 0;
  for (const f of lista) {
    const m = /^(\d{4}-\d{2}-\d{2})\./.exec(f.name || '');
    if (!m || new Date(m[1] + 'T00:00:00Z').getTime() >= limite || borrados >= 10) continue;
    const d = await fetch(GH + '/repos/' + repo + '/contents/' + f.path, { method: 'DELETE', headers: ghHeaders(), body: JSON.stringify({ message: 'Limpieza: respaldo de más de ' + GUARDAR + ' días', sha: f.sha }) });
    if (d.ok) borrados++;
  }
  return borrados;
}
async function respaldarEnGitHub(fecha, tablas) {
  const repo = process.env.GITHUB_BACKUP_REPO, token = process.env.GITHUB_BACKUP_TOKEN, clave = process.env.BACKUP_KEY;
  if (!repo || !token) return 'sin GitHub configurado';
  if (!clave) return 'falta BACKUP_KEY (no se sube nada sin cifrar)';
  const snapshot = JSON.stringify({ version: 1, fecha, creado: new Date().toISOString(), tablas });
  const archivo = cifrar(zlib.gzipSync(Buffer.from(snapshot, 'utf8')), clave);
  const filas = Object.keys(tablas).reduce((a, n) => a + tablas[n].length, 0);
  const msg = 'Respaldo ' + fecha + ' (' + filas + ' filas)';
  await ghPonerArchivo(repo, 'diario/' + fecha + '.json.gz.enc', archivo, msg);
  await ghPonerArchivo(repo, 'diario/' + fecha + '.txt', Buffer.from(resumenTexto(fecha, tablas), 'utf8'), msg + ' · resumen');
  let extra = '';
  if (fecha.slice(8, 10) === '01') { await ghPonerArchivo(repo, 'mensual/' + fecha.slice(0, 7) + '.json.gz.enc', archivo, 'Respaldo mensual ' + fecha.slice(0, 7)); extra = ' + mensual'; }
  const borrados = await ghLimpiarViejos(repo, fecha);
  return 'subido (' + Math.round(archivo.length / 1024) + ' KB)' + extra + (borrados ? ', ' + borrados + ' viejos limpiados' : '');
}

async function enviarCorreo(fecha, csv, filas) {
  const key = process.env.RESEND_API_KEY, para = process.env.RESPALDO_EMAIL;
  if (key === undefined || para === undefined) return 'sin correo configurado';
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESPALDO_FROM || 'onboarding@resend.dev', to: para.split(','), subject: 'Respaldo diario de la cartera ' + fecha,
      text: 'Adjunto el respaldo de la cartera (' + filas + ' clientes) al ' + fecha + '.', attachments: [{ filename: 'cartera_' + fecha + '.csv', content: Buffer.from(csv, 'utf8').toString('base64') }] }) });
  return r.ok ? 'enviado' : 'error correo ' + r.status;
}

export default async function handler(req, res) {
  const secreto = process.env.CRON_SECRET;
  if (secreto === undefined || secreto === '' || (req.headers.authorization === 'Bearer ' + secreto) === false) return res.status(401).json({ error: 'No autorizado' });
  try {
    await run('CREATE TABLE IF NOT EXISTS respaldos (fecha DATE PRIMARY KEY, creado TIMESTAMPTZ DEFAULT now(), filas INT, contenido TEXT)');
    const q = req.query || {};
    if (q.accion === 'lista') return res.status(200).json(await run('SELECT fecha, creado, filas FROM respaldos ORDER BY fecha DESC'));
    if (q.accion === 'bajar') {
      const d = await run('SELECT contenido FROM respaldos WHERE fecha = $1', [q.fecha]);
      if (d.length === 0) return res.status(404).json({ error: 'No hay respaldo de esa fecha' });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="cartera_' + q.fecha + '.csv"');
      return res.status(200).send(d[0].contenido);
    }
    const tablas = await leerTodo();
    const filas = tablas.clientes || await run('SELECT * FROM clientes ORDER BY id');
    const csv = armarCsv(filas), fecha = hoyCR();
    await run('INSERT INTO respaldos (fecha, filas, contenido) VALUES ($1, $2, $3) ON CONFLICT (fecha) DO UPDATE SET creado = now(), filas = $2, contenido = $3', [fecha, filas.length, csv]);
    await run('DELETE FROM respaldos WHERE fecha < $1::date - ' + GUARDAR, [fecha]);
    let github = 'sin GitHub configurado', correo = 'sin correo configurado';
    try { github = await respaldarEnGitHub(fecha, tablas); } catch (e) { github = 'ERROR GitHub: ' + String(e && e.message || e); }
    try { correo = await enviarCorreo(fecha, csv, filas.length); } catch (e) { correo = 'error correo'; }
    return res.status(200).json({ ok: true, fecha, filas: filas.length, tablas: Object.keys(tablas), neon: 'guardado', github, correo });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
