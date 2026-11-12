import { exigir } from './_auth.js';
// NOA ASISTENTE — servidor intermediario con la IA (Claude).
// El navegador manda la conversación; este servidor agrega las instrucciones y las herramientas, llama a Claude con la
// llave guardada en Vercel (ANTHROPIC_API_KEY) y devuelve la respuesta. La llave NUNCA llega al navegador.
// Las herramientas se ejecutan en el navegador sobre la cartera ya cargada: solo viaja a la IA lo que se consulta.

const MODELO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MAX_MENSAJES = 40;
const MAX_CARACTERES = 90000;
const LIMITE_POR_MINUTO = 20;
const visitas = new Map();

const INSTRUCCIONES = `Eres el Asistente NOA de la corredora de seguros de Emmanuel (Seguros Prisma, Ciudad Quesada, Costa Rica). Ayudas al equipo a manejar la cartera de cobros de pólizas.

CÓMO RESPONDES
- Conversas natural, en español de Costa Rica, claro y directo. Respuestas cortas; si hay lista, que sea corta. No uses tablas.
- Nunca inventes datos. Todo dato de clientes, pólizas, fechas, montos o estados sale de las herramientas. Si una herramienta no trae lo que se pidió, dilo y ofrece lo más cercano.
- ACTÚA PRIMERO, PREGUNTA DESPUÉS. La gente escribe rápido y desordenado: una sola palabra, un apellido, medio nombre, una placa, "vencen", "morosos", "los de INS". Nunca respondas "¿a qué se refiere?" sin haber buscado antes.
- Una palabra suelta o un nombre: usa buscar_clientes de una vez. Si no hay resultados, prueba otra forma (solo el apellido, otro campo) antes de rendirte.
- Palabras de cobranza ("morosos", "atrasados", "pendientes", "vencen", "cobros de hoy", "esta semana"): usa listar_por_estado o listar_por_fecha con lo más razonable y di en una frase qué interpretaste.
- Una pregunta con dos partes: pide los datos de ambas en la misma ronda.
- Si de verdad hay dos lecturas posibles, responde la más probable y ofrece la otra al final en una línea.
- Solo haz UNA pregunta corta cuando ninguna herramienta puede acercarse a lo que piden.
- Puedes conversar de seguros y de cobranza en general (qué decirle a un cliente, cómo ordenar el día), pero los datos de la cartera siempre vienen de las herramientas.
- Fechas en formato DD/MM/AAAA. Montos con ₡ (colones) o $ (dólares) según la moneda.
- Tienes herramientas para la cartera, para el historial de pagos, para los mensajes enviados y para las oportunidades de Cross-Selling. Si algo no está en ninguna herramienta, dilo con honestidad.
- Un "pago" es un cobro ya registrado con el botón Pagar; "dias_mora" son los días de atraso con que pagó. Un "envío" es un mensaje de cobro enviado por correo o WhatsApp.

SOBRE LOS DATOS
- "desde_cobro" es la fecha de cobro actual (cuándo vence lo que se debe ahora). "hasta" es el próximo pago.
- El estado (Pendiente, Pagada, Cancelada) lo calcula el sistema; úsalo tal como lo devuelven las herramientas.
- Una póliza con texto como "Autos" y sin números es un marcador de póliza que falta, no una póliza real.
- No puedes modificar datos: solo consultar. Si piden cambiar algo, explica cómo hacerlo en el sistema (botón Editar, Pagar, etc.).`;

const HERRAMIENTAS = [
  { name: 'resumen_cartera', description: 'Resumen general de la cartera: total de clientes, cuántos hay por estado (Pendiente, Pagada, Cancelada, otros), cuántos vencen hoy y cuántos en Deducción Mensual. Úsala para "cómo voy", "resumen", "cuántos clientes", etc.', input_schema: { type: 'object', properties: {} } },
  { name: 'buscar_clientes', description: 'Busca clientes por texto libre en nombre, cédula, póliza, teléfono, correo, placa u objeto asegurado. Devuelve hasta 10 coincidencias con sus datos y estado.', input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Lo que se busca, ej. "Alfaro", "0106AUT", "TRD-450"' }, limite: { type: 'integer', description: 'Máximo de resultados (1-25)' } }, required: ['texto'] } },
  { name: 'listar_por_estado', description: 'Lista clientes según su estado de cobro: "pendiente", "pagada" o "cancelada" (cancelada = morosos que ya pasaron el período de gracia). Ordenados por fecha de cobro. Úsala para morosos, atrasados, pendientes.', input_schema: { type: 'object', properties: { estado: { type: 'string', description: 'pendiente, pagada o cancelada' }, limite: { type: 'integer', description: 'Máximo de resultados (1-25)' } }, required: ['estado'] } },
  { name: 'listar_por_fecha', description: 'Lista clientes cuya fecha de cobro cae entre dos fechas (inclusive). Úsala para "qué vence hoy", "esta semana", "en octubre", etc. Fechas en formato AAAA-MM-DD.', input_schema: { type: 'object', properties: { desde: { type: 'string', description: 'AAAA-MM-DD' }, hasta: { type: 'string', description: 'AAAA-MM-DD' }, limite: { type: 'integer', description: 'Máximo de resultados (1-25)' } }, required: ['desde', 'hasta'] } },
  { name: 'contar_por', description: 'Cuenta clientes agrupados por un campo: aseguradora, tipo_seguro, periodicidad, medio_cobro o moneda. Úsala para "cuántos hay de INS", "cuántos pagan mensual", etc.', input_schema: { type: 'object', properties: { campo: { type: 'string', enum: ['aseguradora', 'tipo_seguro', 'periodicidad', 'medio_cobro', 'moneda'] } }, required: ['campo'] } },
  { name: 'clientes_sin_dato', description: 'Clientes a los que les falta un dato: telefono, correo o poliza (póliza real). Devuelve el total y hasta 10 ejemplos.', input_schema: { type: 'object', properties: { campo: { type: 'string', enum: ['telefono', 'correo', 'poliza'] } }, required: ['campo'] } },
  { name: 'polizas_repetidas', description: 'Pólizas que aparecen en más de un cliente (posible error de datos).', input_schema: { type: 'object', properties: {} } },
  { name: 'pagos_resumen', description: 'Pagos ya registrados: cuántos y cuánto se cobró, por moneda y por mes, y la mora promedio. Opcional un rango de fechas AAAA-MM-DD. Úsala para "cuánto cobramos este mes", "cuántos pagos hubo en septiembre".', input_schema: { type: 'object', properties: { desde: { type: 'string', description: 'AAAA-MM-DD (opcional)' }, hasta: { type: 'string', description: 'AAAA-MM-DD (opcional)' } } } },
  { name: 'pagos_de_cliente', description: 'Historial de pagos de un cliente (por nombre o póliza): fecha, monto, moneda y días de mora. Los más recientes primero.', input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Nombre o póliza' } }, required: ['texto'] } },
  { name: 'ranking_mora', description: 'Clientes ordenados por días de atraso promedio al pagar. orden "peores" (los que más se atrasan) o "mejores" (los más puntuales).', input_schema: { type: 'object', properties: { orden: { type: 'string', enum: ['peores', 'mejores'] }, limite: { type: 'integer', description: 'Máximo de resultados (1-25)' } } } },
  { name: 'envios_resumen', description: 'Mensajes de cobro enviados: total, por canal (correo/WhatsApp) y por estado. Opcional un rango de fechas AAAA-MM-DD.', input_schema: { type: 'object', properties: { desde: { type: 'string', description: 'AAAA-MM-DD (opcional)' }, hasta: { type: 'string', description: 'AAAA-MM-DD (opcional)' } } } },
  { name: 'envios_de_cliente', description: 'Mensajes que se le han enviado a un cliente: fecha, canal y estado. Los más recientes primero.', input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Nombre del cliente' } }, required: ['texto'] } },
  { name: 'oportunidades_cross_selling', description: 'Oportunidades de venta cruzada (otro seguro que ofrecerle a un cliente) con la razón y el momento ideal. Opcional filtrar por nombre.', input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Nombre del cliente (opcional)' }, limite: { type: 'integer', description: 'Máximo de resultados (1-25)' } } } }
];

function origenValido(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const o = String(req.headers.origin || req.headers.referer || '');
  if (!o) return false;
  try { return new URL(o).host.toLowerCase() === host; } catch (e) { return false; }
}

function demasiadas(req) {
  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const ahora = Date.now();
  const lista = (visitas.get(ip) || []).filter(function (t) { return ahora - t < 60000; });
  lista.push(ahora);
  visitas.set(ip, lista);
  if (visitas.size > 500) visitas.clear();
  return lista.length > LIMITE_POR_MINUTO;
}

async function handlerOriginal(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'SIN_LLAVE', mensaje: 'Falta configurar la llave de la IA (ANTHROPIC_API_KEY) en Vercel.' });
  if (demasiadas(req)) return res.status(429).json({ error: 'Demasiadas preguntas seguidas, espere un minuto.' });

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  const mensajes = cuerpo && cuerpo.messages;
  if (!Array.isArray(mensajes) || !mensajes.length || mensajes.length > MAX_MENSAJES) return res.status(400).json({ error: 'Conversación inválida' });
  const tam = JSON.stringify(mensajes).length;
  if (tam > MAX_CARACTERES) return res.status(413).json({ error: 'Conversación demasiado larga' });
  for (const m of mensajes) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || (typeof m.content !== 'string' && !Array.isArray(m.content))) return res.status(400).json({ error: 'Mensaje inválido' });
  }
  const hoy = String((cuerpo && cuerpo.hoy) || '').slice(0, 10);
  const sistema = INSTRUCCIONES + (hoy ? '\n\nFECHA DE HOY (Costa Rica): ' + hoy + ' (AAAA-MM-DD).' : '');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO, max_tokens: 1024, system: sistema, tools: HERRAMIENTAS, messages: mensajes })
    });
    const datos = await r.json().catch(function () { return null; });
    if (!r.ok || !datos) {
      const motivo = (datos && datos.error && datos.error.message) || ('Error ' + r.status);
      return res.status(502).json({ error: 'La IA no respondió: ' + motivo });
    }
    return res.status(200).json({ content: datos.content || [], stop_reason: datos.stop_reason });
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo conectar con la IA: ' + (e && e.message ? e.message : e) });
  }
}

export default async function handler(req, res) {
  const usuario = await exigir(req, res, 'asistente');
  if (!usuario) return;
  return handlerOriginal(req, res);
}
