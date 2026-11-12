import { exigir, permisoValido } from './_auth.js';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const run = (texto, params = []) => (sql.query ? sql.query(texto, params) : sql(texto, params));

// ==== FECHAS PLANAS (inicio) ====
// Fechas que van a la pantalla: siempre YYYY-MM-DD, sin hora ni zona.
// La pantalla las lee en ese formato (asi las entregaba Supabase). Neon las entrega como fecha con hora
// ("2015-06-12T00:00:00.000Z") y eso rompe a quien las parte por guiones.
const pad2 = n => String(n).padStart(2, '0');
const CAMPOS_FECHA = ['desde', 'hasta', 'desde_cobro', 'vence_contrato', 'fecha_limite_pago'];

function fechaPlana(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : s;
}

function conFechasPlanas(c) {
  const out = { ...c };
  CAMPOS_FECHA.forEach(k => { if (k in out) out[k] = fechaPlana(out[k]); });
  return out;
}
// ==== FECHAS PLANAS (fin) ====

// ==== TELEFONO (inicio) ====
// Se guarda con los 8 digitos (sin 506, guiones ni espacios) y se entrega como 8888-8888.
// Si no son 8 digitos (fijo con extension, otro pais, texto) se deja tal cual: no se pierde nada.
function telefonoLimpio(v) {
  if (v === null || v === undefined) return v;
  const t = String(v).trim();
  let d = t.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('506')) d = d.slice(3);
  return d.length === 8 ? d : t;
}
function telefonoBonito(v) {
  const t = telefonoLimpio(v);
  return typeof t === 'string' && /^\d{8}$/.test(t) ? t.slice(0, 4) + '-' + t.slice(4) : t;
}
// ==== TELEFONO (fin) ====

// Columnas que llegan del Excel y su valor por defecto. Se definen una sola vez.
const CAMPOS = {
  asegurado: '', identificacion: '', telefono: '', correo: '', periodicidad: '',
  desde: null, hasta: null, desde_cobro: null, vence_contrato: null,
  moneda: 'CRC', placa: '', aseguradora: '', tipo_seguro: '', marca: '', modelo: '', anio: '',
  fecha_limite_pago: null, periodo_gracia: '',
  tipo_movimiento: '', medio_cobro: '', planillas: false, objeto_asegurado: '',
  correos_extra: '', telefonos_extra: '', direccion: '', acreedor: ''
};
const SOLO_AL_CREAR = ['hasta', 'desde_cobro'];
const CONSERVA_SI_VACIO = ['fecha_limite_pago', 'periodo_gracia', 'direccion', 'acreedor'];

// Neon entrega el id como numero y las fechas con hora; la pantalla los maneja como texto y YYYY-MM-DD.
const conId = c => conFechasPlanas({ ...c, id: String(c.id), telefono: telefonoBonito(c.telefono) });

// Fecha AAAA-MM-DD valida, o null
function fechaISO(s) {
  const t = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + 'T00:00:00Z');
  return (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) ? null : t;
}

// Columna para agrupar lo que se manda a la Papelera por rango de fechas (se crea si falta)
let listo = null;
function prepararTablas() {
  if (!listo) {
    listo = (async () => {
      await run('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS lote_papelera TEXT');
      await run('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT');
      await run('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS acreedor TEXT');
    })().catch(e => { listo = null; throw e; });
  }
  return listo;
}

function valor(c, campo) {
  if (campo === 'planillas') return c.planillas ? true : false;
  if (campo === 'telefono') return telefonoLimpio(c.telefono || CAMPOS.telefono);
  return c[campo] || CAMPOS[campo];
}

// Borra filas de una tabla auxiliar; si la tabla todavia no existe no pasa nada
async function borrarAuxiliar(texto, params) {
  try {
    await run(texto, params);
  } catch (e) {
    if (!/does not exist/i.test(String((e && e.message) || ''))) throw e;
  }
}

async function insertarCliente(user_id, poliza, c) {
  const nombres = Object.keys(CAMPOS);
  const campos = ['user_id', 'poliza', ...nombres, 'prima'];
  const valores = [user_id, poliza, ...nombres.map(k => valor(c, k)), parseFloat(c.prima || 0)];
  const marcas = valores.map((_, i) => `$${i + 1}`).join(', ');
  await run(`INSERT INTO clientes (${campos.join(', ')}) VALUES (${marcas})`, valores);
}

async function actualizarCliente(id, c) {
  const campos = Object.keys(CAMPOS).filter(k => !SOLO_AL_CREAR.includes(k));
  const valores = campos.map(k => (CONSERVA_SI_VACIO.includes(k) ? (c[k] || null) : valor(c, k)));
  const prima = parseFloat(c.prima) > 0 ? parseFloat(c.prima) : null;
  const sets = campos.map((k, i) => (CONSERVA_SI_VACIO.includes(k) ? `${k} = COALESCE($${i + 1}, ${k})` : `${k} = $${i + 1}`));
  sets.push(`prima = COALESCE($${campos.length + 1}, prima)`);
  await run(`UPDATE clientes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${campos.length + 2}`, [...valores, prima, id]);
}

async function handlerOriginal(req, res) {
  try {
    await prepararTablas();
    const { action } = req.query;

    // GET: cuantos clientes activos caen en un rango de fechas de cobro (solo cuenta, no mueve nada)
    if (req.method === 'GET' && action === 'papelera-contar') {
      const { user_id } = req.query;
      const d = fechaISO(req.query.desde), h = fechaISO(req.query.hasta);
      if (!user_id || !d || !h || d > h) return res.status(400).json({ success: false, error: 'Fechas no validas (use AAAA-MM-DD, y desde no mayor que hasta)' });
      const r = await run('SELECT COUNT(*)::int AS n FROM clientes WHERE user_id = $1 AND (borrado IS NULL OR borrado = false) AND desde_cobro >= $2::date AND desde_cobro <= $3::date', [String(user_id), d, h]);
      return res.status(200).json({ success: true, cantidad: r[0].n });
    }

    // GET: lotes que estan en la Papelera (los archivados uno a uno salen como SIN_LOTE)
    if (req.method === 'GET' && action === 'papelera-lotes') {
      const { user_id } = req.query;
      if (!user_id) return res.status(400).json({ success: false, error: 'Falta user_id' });
      const r = await run("SELECT COALESCE(lote_papelera, 'SIN_LOTE') AS lote, COUNT(*)::int AS cantidad, MIN(desde_cobro)::text AS desde, MAX(desde_cobro)::text AS hasta, MAX(updated_at)::text AS fecha FROM clientes WHERE user_id = $1 AND borrado = true GROUP BY COALESCE(lote_papelera, 'SIN_LOTE') ORDER BY MAX(updated_at) DESC", [String(user_id)]);
      return res.status(200).json({ success: true, lotes: r });
    }

    // GET: cargar clientes activos (bridge _pagado incluido)
    if (req.method === 'GET' && action !== 'borrados') {
      const { user_id } = req.query;
      const rows = await sql`SELECT * FROM clientes WHERE user_id = ${user_id} AND (borrado IS NULL OR borrado = false) ORDER BY created_at DESC`;
      const clientes = rows.map(c => ({ ...conId(c), _pagado: !!c.pagado }));
      return res.status(200).json({ success: true, clientes });
    }

    // GET borrados
    if (req.method === 'GET' && action === 'borrados') {
      const { user_id } = req.query;
      const rows = await sql`SELECT * FROM clientes WHERE user_id = ${user_id} AND borrado = true ORDER BY created_at DESC`;
      return res.status(200).json({ success: true, clientes: rows.map(conId) });
    }

    // POST: mandar a la Papelera todo lo activo cuyo cobro cae en un rango de fechas (una sola operacion, con numero de lote)
    if (req.method === 'POST' && action === 'papelera-rango') {
      const cuerpo = req.body || {};
      const d = fechaISO(cuerpo.desde), h = fechaISO(cuerpo.hasta);
      if (!cuerpo.user_id || !d || !h || d > h) return res.status(400).json({ success: false, error: 'Fechas no validas (use AAAA-MM-DD, y desde no mayor que hasta)' });
      const lote = 'L' + Date.now();
      const r = await run('UPDATE clientes SET borrado = true, lote_papelera = $4, updated_at = NOW() WHERE user_id = $1 AND (borrado IS NULL OR borrado = false) AND desde_cobro >= $2::date AND desde_cobro <= $3::date RETURNING id', [String(cuerpo.user_id), d, h, lote]);
      return res.status(200).json({ success: true, lote, movidos: r.length });
    }

    // POST: devolver de la Papelera todo un lote
    if (req.method === 'POST' && action === 'papelera-restaurar-lote') {
      const cuerpo = req.body || {};
      if (!cuerpo.user_id || !cuerpo.lote) return res.status(400).json({ success: false, error: 'Falta user_id o lote' });
      const r = cuerpo.lote === 'SIN_LOTE'
        ? await run('UPDATE clientes SET borrado = false, lote_papelera = NULL, updated_at = NOW() WHERE user_id = $1 AND borrado = true AND lote_papelera IS NULL RETURNING id', [String(cuerpo.user_id)])
        : await run('UPDATE clientes SET borrado = false, lote_papelera = NULL, updated_at = NOW() WHERE user_id = $1 AND borrado = true AND lote_papelera = $2 RETURNING id', [String(cuerpo.user_id), String(cuerpo.lote)]);
      return res.status(200).json({ success: true, restaurados: r.length });
    }

    // POST: guardar carga masiva (Excel)
    if (req.method === 'POST' && action === 'guardar') {
      const { user_id, clientes } = req.body;
      /*SEG_GUARDAR*/ if (Array.isArray(clientes) && clientes.length > 1 && !permisoValido(req)) return res.status(403).json({ success: false, necesita_permiso: true, error: 'Falta la clave de seguridad' });
      const existentes = await sql`SELECT id, poliza FROM clientes WHERE user_id = ${user_id}`;
      const polizaToId = {};
      existentes.forEach(e => { polizaToId[e.poliza] = e.id; });

      let actualizados = 0, nuevos = 0;
      const fallidos = [];

      for (const c of clientes) {
        const polizaLimpia = (c.poliza || "").toString().trim();
        try {
          if (polizaToId[polizaLimpia]) {
            await actualizarCliente(polizaToId[polizaLimpia], c);
            actualizados++;
          } else {
            try {
              await insertarCliente(user_id, polizaLimpia, c);
            } catch (dupErr) {
              await insertarCliente(user_id, polizaLimpia + " (DUPLICADA)", c);
            }
            nuevos++;
          }
        } catch (filaError) {
          fallidos.push({ asegurado: c.asegurado || '(sin nombre)', poliza: polizaLimpia, error: filaError.message });
        }
      }
      return res.status(200).json({ success: true, actualizados, nuevos, fallidos, total: clientes.length });
    }

    // POST: actualizar cliente (edición manual)
    if (req.method === 'POST' && action === 'actualizar') {
      const { id, cambios } = req.body;
      const campos = Object.keys(cambios);
      if (campos.length === 0) return res.status(400).json({ success: false, error: 'Sin cambios' });
      if (!campos.every(campo => /^[a-z_]+$/.test(campo))) return res.status(400).json({ success: false, error: 'Campo no válido' });
      for (const campo of campos) {
        await run(`UPDATE clientes SET ${campo} = $1, updated_at = NOW() WHERE id = $2`, [campo === 'telefono' ? telefonoLimpio(cambios[campo]) : cambios[campo], id]);
      }
      return res.status(200).json({ success: true });
    }

    // POST: marcar pagado (lógica de negocio de periodicidad)
    if (req.method === 'POST' && action === 'marcar-pagado') {
      const { id, user_id } = req.body;
      const rows = await sql`SELECT * FROM clientes WHERE id = ${id}`;
      const cliente = rows[0];
      if (!cliente) return res.status(404).json({ success: false, error: 'Cliente no encontrado' });

      const hastaActual = new Date(cliente.hasta);
      const per = (cliente.periodicidad || "mensual").toLowerCase();
      let mesesPeriodo = 1;
      if (per.includes("anual")) mesesPeriodo = 12;
      else if (per.includes("semes")) mesesPeriodo = 6;
      else if (per.includes("trimest")) mesesPeriodo = 3;

      const desdeAnterior = new Date(hastaActual);
      desdeAnterior.setMonth(desdeAnterior.getMonth() - mesesPeriodo);

      let hastaNuevo = new Date(hastaActual);
      hastaNuevo.setMonth(hastaNuevo.getMonth() + mesesPeriodo);

      const hastaNuevoStr = hastaNuevo.toISOString().split("T")[0];

      await sql`UPDATE clientes SET pagado = true, hasta = ${hastaNuevoStr}, updated_at = NOW() WHERE id = ${id}`;

      await sql`INSERT INTO pagos_history (user_id, cliente_id, asegurado, poliza, identificacion, monto, moneda, desde_anterior, hasta_anterior, desde_nuevo, hasta_nuevo)
        VALUES (${user_id}, ${id}, ${cliente.asegurado}, ${cliente.poliza}, ${cliente.identificacion}, ${cliente.prima}, ${cliente.moneda}, ${desdeAnterior.toISOString().split("T")[0]}, ${cliente.hasta}, ${cliente.hasta}, ${hastaNuevoStr})`;

      return res.status(200).json({ success: true });
    }

    // POST: limpiar todos los clientes del usuario, y todo lo que cuelga de ellos
    // (envios, pagos, notas y comprobantes). Primero lo que cuelga, al final los clientes.
    if (req.method === 'POST' && action === 'limpiar') {
      /*SEG_LIMPIAR*/ if (!permisoValido(req)) return res.status(403).json({ success: false, necesita_permiso: true, error: 'Falta la clave de seguridad' });
      const { user_id } = req.body;
      const suyos = 'SELECT id::text FROM clientes WHERE user_id = $1';
      await borrarAuxiliar('DELETE FROM historial_envios WHERE cliente_id::text IN (' + suyos + ')', [user_id]);
      await borrarAuxiliar('DELETE FROM pagos_history WHERE cliente_id::text IN (' + suyos + ')', [user_id]);
      await borrarAuxiliar('DELETE FROM historial_pagos WHERE cliente_id::text IN (' + suyos + ')', [user_id]);
      await borrarAuxiliar('DELETE FROM gestion_notas WHERE cliente_id::text IN (' + suyos + ')', [user_id]);
      await borrarAuxiliar('DELETE FROM comprobantes_pago WHERE cliente_id::text IN (' + suyos + ')', [user_id]);
      await sql`DELETE FROM clientes WHERE user_id = ${user_id}`;
      return res.status(200).json({ success: true });
    }

    // POST: borrar (soft-delete)
    if (req.method === 'POST' && action === 'borrar') {
      const { id } = req.body;
      await sql`UPDATE clientes SET borrado = true, updated_at = NOW() WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    // POST: restaurar
    if (req.method === 'POST' && action === 'restaurar') {
      const { id } = req.body;
      await sql`UPDATE clientes SET borrado = false, lote_papelera = NULL, updated_at = NOW() WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    // REPARACION DE PRUEBA: borra pagos de prueba que quedaron con fechas dañadas ("05T00:00:00.000Z/06/2015").
    // Quitar antes de cargar datos reales.
    if (req.method === 'POST' && action === 'reparar-pagos') {
      const borrados = await run("DELETE FROM historial_pagos WHERE periodo_desde LIKE '%T00:00%' OR periodo_hasta LIKE '%T00:00%' RETURNING id");
      return res.status(200).json({ success: true, borrados: borrados.length });
    }

    return res.status(405).json({ error: 'Acción no reconocida' });
  } catch (error) {
    console.error('Error en API clientes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default async function handler(req, res) {
  const usuario = await exigir(req, res, 'clientes');
  if (!usuario) return;
  return handlerOriginal(req, res);
}
