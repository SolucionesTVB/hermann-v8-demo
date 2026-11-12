import { exigir } from './_auth.js';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const run = (texto, params = []) => (sql.query ? sql.query(texto, params) : sql(texto, params));

// Fechas: se guardan siempre como YYYY-MM-DD (acepta DD/MM/YYYY)
function aISO(f) {
  if (!f) return null;
  const s = String(f).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return s.slice(0, 10);
}

const COLS = "id, user_id, cliente_id, poliza, cliente_nombre, periodo_desde, periodo_hasta, monto_pagado::float8 AS monto_pagado, moneda, fecha_pago, dias_mora, metodo_pago, created_at";

async function handlerOriginal(req, res) {
  try {
    // GET: pagos de un cliente (?cliente_id=) o de todo el usuario (?user_id=)
    if (req.method === 'GET') {
      const { cliente_id, user_id } = req.query;
      if (cliente_id) {
        const pagos = await run(`SELECT ${COLS} FROM historial_pagos WHERE cliente_id = $1 ORDER BY created_at DESC`, [String(cliente_id)]);
        return res.status(200).json({ success: true, pagos });
      }
      if (user_id) {
        const pagos = await run(`SELECT ${COLS} FROM historial_pagos WHERE user_id = $1 ORDER BY created_at DESC`, [String(user_id)]);
        return res.status(200).json({ success: true, pagos });
      }
      return res.status(400).json({ success: false, error: 'Falta cliente_id o user_id' });
    }

    // POST: guardar un pago (el monto puede ser 0 mientras no haya prima real)
    if (req.method === 'POST' && req.query.action === 'guardar') {
      const p = req.body || {};
      if (!p.user_id) return res.status(400).json({ success: false, error: 'user_id requerido' });
      if (!p.cliente_id) return res.status(400).json({ success: false, error: 'cliente_id requerido' });
      const monto = Number(p.monto_pagado);
      await run(
        `INSERT INTO historial_pagos (user_id, cliente_id, poliza, cliente_nombre, periodo_desde, periodo_hasta, monto_pagado, moneda, fecha_pago, dias_mora, metodo_pago)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          String(p.user_id), String(p.cliente_id), p.poliza || 'SIN-POLIZA', p.cliente_nombre || 'Cliente',
          aISO(p.periodo_desde), aISO(p.periodo_hasta), isNaN(monto) ? 0 : monto, p.moneda || 'CRC',
          aISO(p.fecha_pago), Math.round(Number(p.dias_mora) || 0), p.metodo_pago || 'manual'
        ]
      );
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Acción no reconocida' });
  } catch (error) {
    console.error('Error en API pagos:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default async function handler(req, res) {
  const usuario = await exigir(req, res, 'pagos');
  if (!usuario) return;
  return handlerOriginal(req, res);
}
