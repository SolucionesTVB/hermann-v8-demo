// NOA - Respaldo programado dos veces al dia (12 md y 7 pm, hora de Costa Rica) con Excel.
// Llama primero al respaldo de siempre (api/respaldo.js: copia en Neon y copia cifrada en GitHub) sin tocarlo,
// y despues arma el Excel (hojas Cartera y Papelera) y lo manda por correo si hay correo configurado.
import { neon } from '@neondatabase/serverless';
import zlib from 'zlib';
import respaldoBase from './respaldo.js';

const sql = neon(process.env.DATABASE_URL);
const run = (t, p = []) => (sql.query ? sql.query(t, p) : sql(t, p));
const COLS = [['asegurado','Cliente'],['poliza','Póliza'],['acreedor','Acreedor'],['aseguradora','Aseguradora'],['tipo_seguro','Línea'],['periodicidad','Forma de pago'],['desde_cobro','Vencimiento'],['prima','Prima'],['moneda','Moneda'],['objeto_asegurado','Objeto Asegurado'],['anio','Año'],['placa','Placa'],['hasta','Próx Pago'],['medio_cobro','Medio de cobro'],['identificacion','Identificación'],['telefono','Tel / WA'],['telefonos_extra','Otros tel.'],['correo','Email'],['correos_extra','Otros correos'],['direccion','Dirección'],['planillas','Planillas'],['desde','Inicio'],['vence_contrato','Vence'],['pagado','Pagado']];
const FECHAS = ['desde_cobro', 'hasta', 'desde', 'vence_contrato'];
const ahoraCR = () => new Date(Date.now() - 6 * 3600e3);

function celda(k, v) {
  if (v === null || v === undefined) return '';
  if (FECHAS.indexOf(k) >= 0) { const m = (v instanceof Date ? v.toISOString() : String(v)).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(v); }
  if (typeof v === 'boolean') return v ? 'Sí' : '';
  return String(v);
}
const xml = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function letra(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

let TABLA = null;
function crc32(buf) {
  if (!TABLA) { TABLA = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TABLA[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(archivos) {
  const locales = [], centrales = []; let pos = 0;
  archivos.forEach(a => {
    const nombre = Buffer.from(a.nombre, 'utf8'), datos = Buffer.from(a.datos, 'utf8'), comp = zlib.deflateRawSync(datos), crc = crc32(datos);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8); l.writeUInt16LE(0, 10); l.writeUInt16LE(0x21, 12);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(datos.length, 22); l.writeUInt16LE(nombre.length, 26); l.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(datos.length, 24); c.writeUInt16LE(nombre.length, 28); c.writeUInt32LE(pos, 42);
    locales.push(l, nombre, comp); centrales.push(c, nombre); pos += l.length + nombre.length + comp.length;
  });
  const cen = Buffer.concat(centrales), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10); fin.writeUInt32LE(cen.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat(locales.concat([cen, fin]));
}
function hojaXml(filas) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="' + COLS.length + '" width="18" customWidth="1"/></cols><sheetData>'];
  const fila = (vals, n, enc) => '<row r="' + n + '">' + vals.map((v, i) => {
    const ref = letra(i) + n;
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
    return '<c r="' + ref + '" t="inlineStr"' + (enc ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
  }).join('') + '</row>';
  out.push(fila(COLS.map(c => c[1]), 1, true));
  filas.forEach((r, i) => out.push(fila(COLS.map(c => { if (c[0] === 'prima') { const n = Number(r.prima); return (r.prima !== null && r.prima !== undefined && r.prima !== '' && isFinite(n)) ? n : ''; } return celda(c[0], r[c[0]]); }), i + 2, false)));
  out.push('</sheetData></worksheet>');
  return out.join('');
}
export function armarXlsx(cartera, papelera) {
  return zip([
    { nombre: '[Content_Types].xml', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nombre: '_rels/.rels', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nombre: 'xl/workbook.xml', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cartera" sheetId="1" r:id="rId1"/><sheet name="Papelera" sheetId="2" r:id="rId2"/></sheets></workbook>' },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nombre: 'xl/styles.xml', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { nombre: 'xl/worksheets/sheet1.xml', datos: hojaXml(cartera) },
    { nombre: 'xl/worksheets/sheet2.xml', datos: hojaXml(papelera) }
  ]);
}

async function correrBase(req) {
  const salida = { code: 200, body: null };
  const falsoRes = { status(c) { salida.code = c; return this; }, json(b) { salida.body = b; return this; }, send(b) { salida.body = b; return this; }, setHeader() { return this; } };
  const guardado = { k: process.env.RESEND_API_KEY, e: process.env.RESPALDO_EMAIL };
  delete process.env.RESEND_API_KEY; delete process.env.RESPALDO_EMAIL; // el correo con Excel lo manda este archivo, no el respaldo de siempre
  try { await respaldoBase({ headers: req.headers, query: {}, method: 'GET' }, falsoRes); }
  finally { if (guardado.k !== undefined) process.env.RESEND_API_KEY = guardado.k; if (guardado.e !== undefined) process.env.RESPALDO_EMAIL = guardado.e; }
  return salida;
}
async function enviarCorreo(asunto, nombre, xlsx, texto) {
  const key = process.env.RESEND_API_KEY, para = process.env.RESPALDO_EMAIL;
  if (!key || !para) return 'sin correo configurado';
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESPALDO_FROM || 'onboarding@resend.dev', to: para.split(',').map(x => x.trim()), subject: asunto, text: texto, attachments: [{ filename: nombre, content: xlsx.toString('base64') }] }) });
  return r.ok ? 'enviado' : 'error correo ' + r.status;
}

export default async function handler(req, res) {
  const secreto = process.env.CRON_SECRET;
  if (secreto === undefined || secreto === '' || (req.headers.authorization === 'Bearer ' + secreto) === false) return res.status(401).json({ error: 'No autorizado' });
  const ahora = ahoraCR(), fecha = ahora.toISOString().slice(0, 10), turno = ahora.getUTCHours() < 15 ? '12 md' : '7 pm';
  const resultado = { ok: false, fecha, turno };
  try { const b = await correrBase(req); resultado.respaldo = { codigo: b.code, detalle: b.body }; } catch (e) { resultado.respaldo = { codigo: 500, detalle: String(e && e.message || e) }; }
  try {
    const filas = await run('SELECT * FROM clientes ORDER BY id');
    const activos = filas.filter(r => !r.borrado), borrados = filas.filter(r => r.borrado);
    const xlsx = armarXlsx(activos, borrados);
    const nombre = 'Respaldo_NOA_' + fecha + '_' + turno.replace(' ', '') + '.xlsx';
    resultado.excel = { archivo: nombre, bytes: xlsx.length, cartera: activos.length, papelera: borrados.length };
    resultado.correo = await enviarCorreo('Respaldo NOA Cobros ' + fecha + ' (' + turno + ')', nombre, xlsx, 'Adjunto el respaldo de la cartera al ' + fecha + ' (' + turno + '): ' + activos.length + ' clientes en Cartera y ' + borrados.length + ' en la Papelera.');
    resultado.ok = resultado.respaldo.codigo === 200;
  } catch (e) { resultado.error = String(e && e.message || e); }
  return res.status(resultado.ok ? 200 : 500).json(resultado);
}
