import { run, prepararAuth, firmar, hashClave, claveCorrecta, claveTemporal, exigir, anotar } from './_auth.js';
import crypto from 'node:crypto';

const NOMBRE_OK = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ._-]{1,29}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await prepararAuth();
    const action = (req.query && req.query.action) || '';
    const body = (req.body && typeof req.body === 'object') ? req.body : {};

    // LOGIN SIN CONTRASEÑA - solo usuario
    if (req.method === 'POST' && action === 'login') {
      const nombre = String(body.usuario || '').trim().slice(0, 40);
      if (!nombre) return res.status(400).json({ error: 'Ingrese un usuario' });
      const f = await run('SELECT nombre, rol, activo FROM usuarios WHERE lower(nombre) = lower($1)', [nombre]);
      const u = f[0];
      if (!u) return res.status(401).json({ error: 'Usuario no encontrado' });
      if (!u.activo) return res.status(401).json({ error: 'Usuario inactivo' });
      await anotar(u.nombre, 'login', '');
      return res.status(200).json({ ok: true, token: firmar(u.nombre, u.rol), usuario: u.nombre, rol: u.rol, debe_cambiar: false });
    }

    const yo = await exigir(req, res, 'auth');
    if (!yo) return;

    if (req.method === 'GET' && action === 'yo') {
      const f = await run('SELECT nombre, rol, activo FROM usuarios WHERE nombre = $1', [yo.nombre]);
      if (!f[0] || !f[0].activo) return res.status(401).json({ error: 'No autorizado', login: true });
      return res.status(200).json({ ok: true, usuario: f[0].nombre, rol: f[0].rol, debe_cambiar: false });
    }

    if (req.method === 'GET' && action === 'bitacora') {
      const lim = Math.min(Math.max(parseInt(req.query.limite, 10) || 300, 1), 1000);
      const filas = await run('SELECT fecha, usuario, accion, detalle FROM bitacora ORDER BY id DESC LIMIT ' + lim);
      return res.status(200).json({ ok: true, filas });
    }

    if (req.method === 'GET' && action === 'usuarios') {
      const filas = await run('SELECT nombre, rol, activo FROM usuarios ORDER BY nombre');
      return res.status(200).json({ ok: true, usuarios: filas });
    }

    if (yo.rol === 'robot') return res.status(403).json({ error: 'Sin permiso' });

    if (req.method === 'POST' && action === 'crear-usuario') {
      const nombre = String(body.usuario || '').trim();
      if (!NOMBRE_OK.test(nombre)) return res.status(400).json({ error: 'Nombre no válido (2 a 30 letras o números)' });
      const ya = await run('SELECT 1 FROM usuarios WHERE lower(nombre) = lower($1)', [nombre]);
      if (ya[0]) return res.status(409).json({ error: 'Ese usuario ya existe' });
      await run('INSERT INTO usuarios (nombre, rol, hash, debe_cambiar) VALUES ($1,$2,$3,FALSE)', [nombre, 'oficina', 'none']);
      await anotar(yo.nombre, 'crear-usuario', nombre);
      return res.status(200).json({ ok: true, usuario: nombre });
    }

    if (req.method === 'POST' && action === 'estado-usuario') {
      const nombre = String(body.usuario || '').trim();
      if (nombre.toLowerCase() === yo.nombre.toLowerCase()) return res.status(400).json({ error: 'No puede desactivarse usted mismo' });
      const f = await run('SELECT nombre, rol FROM usuarios WHERE lower(nombre) = lower($1)', [nombre]);
      if (!f[0] || f[0].rol === 'robot') return res.status(404).json({ error: 'Usuario no encontrado' });
      await run('UPDATE usuarios SET activo = $1 WHERE nombre = $2', [!!body.activo, f[0].nombre]);
      await anotar(yo.nombre, body.activo ? 'activar-usuario' : 'desactivar-usuario', f[0].nombre);
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Acción no válida' });
  } catch (e) {
    console.error('auth', e);
    return res.status(500).json({ error: 'Error interno' });
  }
}
