import { exigir } from './_auth.js';
import { neon } from '@neondatabase/serverless';
import { put, get } from '@vercel/blob';
import { Readable } from 'node:stream';

const sql = neon(process.env.DATABASE_URL);
const run = (texto, params = []) => (sql.query ? sql.query(texto, params) : sql(texto, params));

// Crea (o completa) lo que necesita el expediente. Corre una sola vez por arranque y no toca lo que ya existe.
let listo = null;
function prepararTablas() {
  if (!listo) {
    listo = (async () => {
      await run('CREATE TABLE IF NOT EXISTS gestion_notas (id SERIAL PRIMARY KEY, user_id TEXT, cliente_id TEXT, nota TEXT, created_at TIMESTAMPTZ DEFAULT NOW())');
      await run('CREATE TABLE IF NOT EXISTS comprobantes_pago (id SERIAL PRIMARY KEY, user_id TEXT, cliente_id TEXT, storage_path TEXT, nombre_archivo TEXT, created_at TIMESTAMPTZ DEFAULT NOW())');
      await run('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS poliza_no_renueva BOOLEAN DEFAULT FALSE');
    })().catch(e => { listo = null; throw e; });
  }
  return listo;
}

async function handlerOriginal(req, res) {
  try {
    await prepararTablas();
    const { action } = req.query;

    // GET: notas de un cliente
    if (req.method === 'GET' && action === 'notas') {
      const { cliente_id } = req.query;
      if (!cliente_id) return res.status(400).json({ success: false, error: 'Falta cliente_id' });
      const notas = await run('SELECT id, cliente_id, nota, created_at FROM gestion_notas WHERE cliente_id = $1 ORDER BY created_at DESC', [String(cliente_id)]);
      return res.status(200).json({ success: true, notas });
    }

    // POST: agregar una nota (nunca se sobreescribe ni se borra)
    if (req.method === 'POST' && action === 'nota') {
      const { user_id, cliente_id, nota } = req.body || {};
      const texto = String(nota || '').trim();
      if (!cliente_id || !texto) return res.status(400).json({ success: false, error: 'Falta cliente o nota' });
      await run('INSERT INTO gestion_notas (user_id, cliente_id, nota) VALUES ($1, $2, $3)', [String(user_id || ''), String(cliente_id), texto]);
      return res.status(200).json({ success: true });
    }

    // POST: marcar / desmarcar "Poliza no renueva"
    if (req.method === 'POST' && action === 'no-renueva') {
      const { cliente_id, valor } = req.body || {};
      if (!cliente_id) return res.status(400).json({ success: false, error: 'Falta cliente_id' });
      await run('UPDATE clientes SET poliza_no_renueva = $1, updated_at = NOW() WHERE id = $2', [valor === true, String(cliente_id)]);
      return res.status(200).json({ success: true });
    }

    // GET: comprobantes de un cliente
    if (req.method === 'GET' && action === 'comprobantes') {
      const { cliente_id } = req.query;
      if (!cliente_id) return res.status(400).json({ success: false, error: 'Falta cliente_id' });
      const comprobantes = await run('SELECT id, cliente_id, storage_path, nombre_archivo, created_at FROM comprobantes_pago WHERE cliente_id = $1 ORDER BY created_at DESC', [String(cliente_id)]);
      return res.status(200).json({ success: true, comprobantes });
    }

    // POST: subir un comprobante (el archivo llega como bytes; datos por la direccion)
    if (req.method === 'POST' && action === 'comprobante') {
      const { cliente_id, user_id, nombre, tipo } = req.query;
      if (!cliente_id || !nombre) return res.status(400).json({ success: false, error: 'Falta cliente o nombre del archivo' });
      const cuerpo = req.body;
      if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) return res.status(400).json({ success: false, error: 'Archivo vacio o ilegible' });
      const limpio = String(nombre).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      const ruta = 'comprobantes/' + String(user_id || 'sin-usuario') + '/' + String(cliente_id) + '/' + Date.now() + '_' + limpio;
      const blob = await put(ruta, cuerpo, { access: 'private', contentType: tipo || 'application/octet-stream', addRandomSuffix: false });
      await run('INSERT INTO comprobantes_pago (user_id, cliente_id, storage_path, nombre_archivo) VALUES ($1, $2, $3, $4)', [String(user_id || ''), String(cliente_id), blob.pathname, String(nombre)]);
      return res.status(200).json({ success: true, pathname: blob.pathname });
    }

    // GET: abrir un comprobante (solo los que estan registrados)
    if (req.method === 'GET' && action === 'abrir') {
      const ruta = String(req.query.path || '');
      const existe = await run('SELECT nombre_archivo FROM comprobantes_pago WHERE storage_path = $1 LIMIT 1', [ruta]);
      if (!existe.length) return res.status(404).json({ success: false, error: 'Comprobante no encontrado' });
      const resultado = await get(ruta, { access: 'private' });
      if (!resultado || !resultado.stream) return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
      res.setHeader('Content-Type', (resultado.blob && resultado.blob.contentType) || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=60');
      const flujo = typeof resultado.stream.getReader === 'function' ? Readable.fromWeb(resultado.stream) : resultado.stream;
      flujo.pipe(res);
      return;
    }

    return res.status(405).json({ success: false, error: 'Accion no reconocida' });
  } catch (error) {
    console.error('Error en API expediente:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default async function handler(req, res) {
  const usuario = await exigir(req, res, 'expediente');
  if (!usuario) return;
  return handlerOriginal(req, res);
}
