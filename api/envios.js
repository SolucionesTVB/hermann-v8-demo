import { exigir, verificar } from './_auth.js';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const run = (texto, params = []) => (sql.query ? sql.query(texto, params) : sql(texto, params));

// Crea (o completa) la tabla de envios. No toca lo que ya existe.
let listo = null;
function prepararTablas() {
  if (!listo) {
    listo = (async () => {
      await run('CREATE TABLE IF NOT EXISTS historial_envios (id SERIAL PRIMARY KEY)');
      const columnas = [
        'user_id TEXT', 'cliente_id TEXT', 'cliente_nombre TEXT', 'tipo_envio INTEGER', 'canal TEXT',
        'estado TEXT', 'mensaje TEXT', 'fecha_envio TIMESTAMPTZ DEFAULT NOW()', 'created_at TIMESTAMPTZ DEFAULT NOW()'
      ];
      for (const c of columnas) await run('ALTER TABLE historial_envios ADD COLUMN IF NOT EXISTS ' + c);
    })().catch(e => { listo = null; throw e; });
  }
  return listo;
}

const CAMPOS = "id, cliente_id::text AS cliente_id, cliente_nombre, tipo_envio, canal, estado, mensaje, COALESCE(fecha_envio, created_at) AS fecha_envio";

async function handlerOriginal(req, res) {
  try {
    await prepararTablas();
    const { action } = req.query;

    // Limite diario de WhatsApp (el mismo para toda la oficina)
    if (action === 'limite' && (req.method === 'GET' || req.method === 'POST')) {
      await run('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
      if (req.method === 'POST') {
        const v = parseInt((req.body || {}).limite_diario_wa, 10);
        if (!(v >= 1 && v <= 1000)) return res.status(400).json({ success: false, error: 'El limite debe estar entre 1 y 1000' });
        await run("INSERT INTO ajustes (clave, valor) VALUES ('limite_diario_wa', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [String(v)]);
      }
      const f = await run("SELECT valor FROM ajustes WHERE clave = 'limite_diario_wa'");
      return res.status(200).json({ success: true, limite_diario_wa: f[0] ? parseInt(f[0].valor, 10) : null });
    }

    // Configuracion compartida por toda la oficina: datos del corredor, intervalos de recordatorio y API Key de Wasender
    if (action === 'config' && (req.method === 'GET' || req.method === 'POST')) {
      /*NOA_CONFIG_API*/
      await run('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
      const cab = String((req.headers && req.headers.authorization) || '');
      const ses = verificar(cab.startsWith('Bearer ') ? cab.slice(7) : '');
      const esRobot = !ses || ses.rol === 'robot';
      const leer = async clave => { const f = await run('SELECT valor FROM ajustes WHERE clave = $1', [clave]); return f[0] ? f[0].valor : null; };
      const poner = (clave, valor) => run('INSERT INTO ajustes (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [clave, valor]);
      if (req.method === 'POST') {
        const b = req.body || {};
        if (b.corredor !== undefined) {
          const c = b.corredor || {}; const limpio = {};
          for (const k of ['nombre', 'whatsapp', 'email', 'agencia']) limpio[k] = String(c[k] || '').trim().slice(0, 120);
          await poner('config_corredor', JSON.stringify(limpio));
        }
        if (b.intervalos !== undefined) {
          const iv = b.intervalos || {}; const limpio = {};
          const num = v => { const k = Number(v); return Number.isInteger(k) && k >= 0 && k <= 365 ? k : null; };
          for (const p of ['mensual', 'trimestral', 'semestral', 'anual']) {
            const x = iv[p] || {};
            if (num(x.r1) === null || num(x.r2) === null || num(x.r3) === null) return res.status(400).json({ success: false, error: 'Intervalo no valido en ' + p + ' (de 0 a 365 dias)' });
            limpio[p] = { r1: num(x.r1), r2: num(x.r2), r3: num(x.r3) };
          }
          await poner('config_intervalos', JSON.stringify(limpio));
        }
        if (b.wasender_api_key !== undefined) {
          if (esRobot) return res.status(403).json({ success: false, error: 'Sin permiso' });
          await poner('wasender_api_key', String(b.wasender_api_key || '').trim().slice(0, 300));
        }
      }
      const leerJson = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
      const key = await leer('wasender_api_key');
      return res.status(200).json({ success: true, corredor: leerJson(await leer('config_corredor')), intervalos: leerJson(await leer('config_intervalos')), wasender_api_key: esRobot ? null : (key || null), hay_wasender_key: !!key });
    }

    // POST: registrar un envio (WhatsApp o email)
    if (req.method === 'POST' && action === 'guardar') {
      const e = req.body || {};
      if (!e.cliente_id) return res.status(400).json({ success: false, error: 'Falta cliente_id' });
      const tipo = Number(e.tipo_envio);
      await run(
        'INSERT INTO historial_envios (user_id, cliente_id, cliente_nombre, tipo_envio, canal, estado, mensaje) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [String(e.user_id || ''), String(e.cliente_id), e.cliente_nombre || '', isNaN(tipo) ? 0 : tipo, e.canal || '', e.estado || 'enviado', e.mensaje || '']
      );
      return res.status(200).json({ success: true });
    }

    // GET: envios de un cliente
    if (req.method === 'GET' && action === 'cliente') {
      const { cliente_id } = req.query;
      if (!cliente_id) return res.status(400).json({ success: false, error: 'Falta cliente_id' });
      const envios = await run('SELECT ' + CAMPOS + ' FROM historial_envios WHERE cliente_id::text = $1 ORDER BY COALESCE(fecha_envio, created_at) DESC', [String(cliente_id)]);
      return res.status(200).json({ success: true, envios });
    }

    // GET: los ultimos 100 envios
    if (req.method === 'GET' && action === 'todos') {
      const envios = await run('SELECT ' + CAMPOS + ' FROM historial_envios ORDER BY COALESCE(fecha_envio, created_at) DESC LIMIT 100');
      return res.status(200).json({ success: true, envios });
    }

    // GET: envios exitosos (para los contadores de Cartera)
    if (req.method === 'GET' && action === 'contador') {
      const envios = await run("SELECT cliente_id::text AS cliente_id, canal, COALESCE(fecha_envio, created_at) AS fecha FROM historial_envios WHERE estado = 'enviado'");
      return res.status(200).json({ success: true, envios });
    }

    // DIAGNOSTICO (solo lectura): tablas y columnas. Quitar antes de cargar datos reales.
    if (req.method === 'GET' && action === 'esquema') {
      const filas = await run("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position");
      const tablas = {};
      filas.forEach(f => { (tablas[f.table_name] = tablas[f.table_name] || []).push(f.column_name + ':' + f.data_type); });
      return res.status(200).json({ success: true, tablas });
    }

    // DIAGNOSTICO: inserta un envio de prueba y lo borra al instante. Quitar antes de cargar datos reales.
    if (req.method === 'GET' && action === 'autoprueba') {
      const fila = await run("INSERT INTO historial_envios (user_id, cliente_id, cliente_nombre, tipo_envio, canal, estado, mensaje) SELECT 'autoprueba', id, 'Autoprueba', 1, 'prueba', 'enviado', '[PRUEBA] se borra sola' FROM clientes LIMIT 1 RETURNING id");
      if (!fila.length) return res.status(200).json({ success: true, nota: 'No hay clientes para probar' });
      await run('DELETE FROM historial_envios WHERE id = $1', [fila[0].id]);
      return res.status(200).json({ success: true, insertado: true, borrado: true });
    }

    return res.status(405).json({ success: false, error: 'Accion no reconocida' });
  } catch (error) {
    console.error('Error en API envios:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default async function handler(req, res) {
  const usuario = await exigir(req, res, 'envios');
  if (!usuario) return;
  return handlerOriginal(req, res);
}
