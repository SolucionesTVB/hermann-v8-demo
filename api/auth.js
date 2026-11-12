import { run, prepararAuth, firmar, hashClave, claveCorrecta, claveTemporal, exigir, anotar } from './_auth.js';
import crypto from 'node:crypto';

const NOMBRE_OK = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ._-]{1,29}$/;
const FALSO = hashClave('x'); // para gastar el mismo tiempo cuando el usuario no existe

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await prepararAuth();
    /*REINICIO_TONY_20261109*/
    if (req.method === 'POST' && (req.query && req.query.action) === 'login') {
      await run('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
      const yaRT = await run("SELECT 1 FROM ajustes WHERE clave = 'reinicio_tony_20261109'");
      if (!yaRT[0]) {
        const hRT = 'scrypt$226cc89151e160455caf922a1fee7f8b$6eda9113f7b40aa3d0b407613afd055a06cc042b91dd3e77a69bd87b93f608f5';
        await run('UPDATE usuarios SET hash = $1, debe_cambiar = TRUE, activo = TRUE, fallos = 0, bloqueado_hasta = NULL WHERE lower(nombre) = lower($2)', [hRT, 'Tony']);
        await run("INSERT INTO ajustes (clave, valor) VALUES ('reinicio_tony_20261109', 'hecho') ON CONFLICT (clave) DO NOTHING");
        await anotar('sistema', 'reinicio-claves', 'Tony');
      }
    }
    /*REINICIO_20261103*/
    if (req.method === 'POST' && (req.query && req.query.action) === 'login') {
      await run('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
      const yaR3 = await run("SELECT 1 FROM ajustes WHERE clave = 'reinicio_claves_20261103'");
      if (!yaR3[0]) {
        const h3 = 'scrypt$00db9a41da959f6d108f038d0b175031$5cf22b3b6a58c8d85f64909ed0030b3931147b8ced75ab7d7ed3da5903fd6087';
        await run('UPDATE usuarios SET hash = $1, debe_cambiar = TRUE, activo = TRUE, fallos = 0, bloqueado_hasta = NULL WHERE lower(nombre) = lower($2)', [h3, 'Gloriana']);
        await run("INSERT INTO ajustes (clave, valor) VALUES ('reinicio_claves_20261103', 'hecho') ON CONFLICT (clave) DO NOTHING");
        await anotar('sistema', 'reinicio-claves', 'Gloriana');
      }
    }
    /*USUARIO_TONY_20261105*/
    if (req.method === 'POST' && (req.query && req.query.action) === 'login') {
      await run('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
      const yaT = await run("SELECT 1 FROM ajustes WHERE clave = 'usuario_tony_20261105'");
      if (!yaT[0]) {
        const hT = 'scrypt$226cc89151e160455caf922a1fee7f8b$6eda9113f7b40aa3d0b407613afd055a06cc042b91dd3e77a69bd87b93f608f5';
        await run("INSERT INTO usuarios (nombre, rol, hash, debe_cambiar) SELECT 'Tony', 'oficina', $1, TRUE WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE lower(nombre) = 'tony')", [hT]);
        await run("INSERT INTO ajustes (clave, valor) VALUES ('usuario_tony_20261105', 'hecho') ON CONFLICT (clave) DO NOTHING");
        await anotar('sistema', 'usuario-creado', 'Tony');
      }
    }
    /*REINICIO_20261102*/
    if (req.method === 'POST' && (req.query && req.query.action) === 'login') {
      await run('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
      const yaR = await run("SELECT 1 FROM ajustes WHERE clave = 'reinicio_claves_20261102'");
      if (!yaR[0]) {
        const lista = [
          ['Diana', 'scrypt$2f5053e46166bd4d62dfa8d6f822250d$632de654189cdbb7c3a75d4c91d02ddce76faeed6659a8a6f5c30d4744ce48ae'],
          ['Gloriana', 'scrypt$e0191a38698f1c8dec5ec7ffd13a27d1$54ee56629fce9109d215228df8145299e7c0664232ddb9ff3110bb3a621274e6']
        ];
        for (const [n, h] of lista) {
          await run('UPDATE usuarios SET hash = $1, debe_cambiar = TRUE, activo = TRUE, fallos = 0, bloqueado_hasta = NULL WHERE lower(nombre) = lower($2)', [h, n]);
          await run("INSERT INTO usuarios (nombre, rol, hash, debe_cambiar) SELECT $1, 'oficina', $2, TRUE WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE lower(nombre) = lower($1))", [n, h]);
        }
        await run("INSERT INTO ajustes (clave, valor) VALUES ('reinicio_claves_20261102', 'hecho') ON CONFLICT (clave) DO NOTHING");
        await anotar('sistema', 'reinicio-claves', 'Diana, Gloriana');
      }
    }
    const action = (req.query && req.query.action) || '';
    const body = (req.body && typeof req.body === 'object') ? req.body : {};

    if (req.method === 'POST' && action === 'setup') {
      const n = (await run('SELECT COUNT(*)::int AS n FROM usuarios'))[0].n;
      if (n > 0) return res.status(409).json({ error: 'Ya hay usuarios creados' });
      if (body.confirmar !== 'crear-usuarios-iniciales') return res.status(400).json({ error: 'Falta confirmar' });
      const claves = { Seidy: claveTemporal(), Diana: claveTemporal(), Robot: crypto.randomBytes(18).toString('base64url') };
      await run('INSERT INTO usuarios (nombre, rol, hash, debe_cambiar) VALUES ($1,$2,$3,TRUE)', ['Seidy', 'oficina', hashClave(claves.Seidy)]);
      await run('INSERT INTO usuarios (nombre, rol, hash, debe_cambiar) VALUES ($1,$2,$3,TRUE)', ['Diana', 'oficina', hashClave(claves.Diana)]);
      await run('INSERT INTO usuarios (nombre, rol, hash, debe_cambiar) VALUES ($1,$2,$3,FALSE)', ['Robot', 'robot', hashClave(claves.Robot)]);
      await anotar('sistema', 'setup', 'usuarios iniciales: Seidy, Diana, Robot');
      return res.status(200).json({ ok: true, claves });
    }

    if (req.method === 'POST' && action === 'login') {
      const nombre = String(body.usuario || '').trim().slice(0, 40);
      const clave = String(body.clave || '');
      const f = nombre ? await run('SELECT nombre, rol, hash, debe_cambiar, activo, bloqueado_hasta FROM usuarios WHERE lower(nombre) = lower($1)', [nombre]) : [];
      const u = f[0];
      if (u && u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
        return res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos e intente de nuevo.' });
      }
      const bien = claveCorrecta(clave, u ? u.hash : FALSO) && !!u && u.activo;
      if (!bien) {
        if (u) {
          await run('UPDATE usuarios SET fallos = fallos + 1 WHERE nombre = $1', [u.nombre]);
          await run("UPDATE usuarios SET fallos = 0, bloqueado_hasta = NOW() + INTERVAL '15 minutes' WHERE nombre = $1 AND fallos >= 6", [u.nombre]);
        }
        await anotar(nombre || '(vacío)', 'login-fallido', '');
        return res.status(401).json({ error: 'Usuario o clave incorrectos' });
      }
      await run('UPDATE usuarios SET fallos = 0, bloqueado_hasta = NULL WHERE nombre = $1', [u.nombre]);
      await anotar(u.nombre, 'login', '');
      return res.status(200).json({ ok: true, token: firmar(u.nombre, u.rol), usuario: u.nombre, rol: u.rol, debe_cambiar: !!u.debe_cambiar });
    }

    const yo = await exigir(req, res, 'auth');
    if (!yo) return;

    if (req.method === 'GET' && action === 'yo') {
      const f = await run('SELECT nombre, rol, debe_cambiar, activo FROM usuarios WHERE nombre = $1', [yo.nombre]);
      if (!f[0] || !f[0].activo) return res.status(401).json({ error: 'No autorizado', login: true });
      return res.status(200).json({ ok: true, usuario: f[0].nombre, rol: f[0].rol, debe_cambiar: !!f[0].debe_cambiar });
    }

    if (req.method === 'GET' && action === 'bitacora') {
      const lim = Math.min(Math.max(parseInt(req.query.limite, 10) || 300, 1), 1000);
      const filas = await run('SELECT fecha, usuario, accion, detalle FROM bitacora ORDER BY id DESC LIMIT ' + lim);
      return res.status(200).json({ ok: true, filas });
    }

    if (req.method === 'GET' && action === 'usuarios') {
      const filas = await run('SELECT nombre, rol, activo, debe_cambiar FROM usuarios ORDER BY nombre');
      return res.status(200).json({ ok: true, usuarios: filas });
    }

    if (req.method === 'POST' && action === 'cambiar-clave') {
      const actual = String(body.actual || ''), nueva = String(body.nueva || '');
      const f = await run('SELECT hash FROM usuarios WHERE nombre = $1', [yo.nombre]);
      if (!f[0] || !claveCorrecta(actual, f[0].hash)) return res.status(400).json({ error: 'La clave actual no es correcta' });
      if (nueva.length < 8) return res.status(400).json({ error: 'La clave nueva debe tener al menos 8 caracteres' });
      if (nueva === actual) return res.status(400).json({ error: 'La clave nueva debe ser distinta de la actual' });
      await run('UPDATE usuarios SET hash = $1, debe_cambiar = FALSE WHERE nombre = $2', [hashClave(nueva), yo.nombre]);
      await anotar(yo.nombre, 'cambio-clave', '');
      return res.status(200).json({ ok: true });
    }

    if (yo.rol === 'robot') return res.status(403).json({ error: 'Sin permiso' });

    if (req.method === 'POST' && action === 'robot-clave') {
      const rb = await run("SELECT nombre FROM usuarios WHERE rol = 'robot' ORDER BY nombre LIMIT 1");
      if (!rb[0]) return res.status(404).json({ error: 'No hay usuario Robot' });
      const clave = crypto.randomBytes(18).toString('base64url');
      await run('UPDATE usuarios SET hash = $1, debe_cambiar = FALSE, activo = TRUE, fallos = 0, bloqueado_hasta = NULL WHERE nombre = $2', [hashClave(clave), rb[0].nombre]);
      await anotar(yo.nombre, 'clave-nueva-robot', '');
      return res.status(200).json({ ok: true, usuario: rb[0].nombre, clave });
    }

    if (req.method === 'POST' && action === 'reset-clave') {
      const nombre = String(body.usuario || '').trim();
      const f = await run('SELECT nombre, rol FROM usuarios WHERE lower(nombre) = lower($1)', [nombre]);
      if (!f[0] || f[0].rol === 'robot') return res.status(404).json({ error: 'Usuario no encontrado' });
      const temp = claveTemporal();
      await run('UPDATE usuarios SET hash = $1, debe_cambiar = TRUE, fallos = 0, bloqueado_hasta = NULL WHERE nombre = $2', [hashClave(temp), f[0].nombre]);
      await anotar(yo.nombre, 'reset-clave', 'a ' + f[0].nombre);
      return res.status(200).json({ ok: true, usuario: f[0].nombre, clave_temporal: temp });
    }

    if (req.method === 'POST' && action === 'crear-usuario') {
      const nombre = String(body.usuario || '').trim();
      if (!NOMBRE_OK.test(nombre)) return res.status(400).json({ error: 'Nombre no válido (2 a 30 letras o números)' });
      const ya = await run('SELECT 1 FROM usuarios WHERE lower(nombre) = lower($1)', [nombre]);
      if (ya[0]) return res.status(409).json({ error: 'Ese usuario ya existe' });
      const temp = claveTemporal();
      await run('INSERT INTO usuarios (nombre, rol, hash, debe_cambiar) VALUES ($1,$2,$3,TRUE)', [nombre, 'oficina', hashClave(temp)]);
      await anotar(yo.nombre, 'crear-usuario', nombre);
      return res.status(200).json({ ok: true, usuario: nombre, clave_temporal: temp });
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

    if (action === 'seguridad' || action === 'clave-seguridad' || action === 'permiso') {
      /*SEG_AUTH*/
      await run('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
      const g = await run("SELECT valor FROM ajustes WHERE clave = 'clave_seguridad'");
      const guardada = g[0] ? g[0].valor : null;
      if (req.method === 'GET' && action === 'seguridad') return res.status(200).json({ ok: true, hay_clave: !!guardada });
      if (req.method === 'POST' && (action === 'permiso' || action === 'clave-seguridad')) {
        const fallos = (await run("SELECT COUNT(*)::int AS n FROM bitacora WHERE usuario = $1 AND accion = 'seguridad-fallida' AND fecha > NOW() - INTERVAL '10 minutes'", [yo.nombre]))[0].n;
        if (fallos >= 5) return res.status(429).json({ error: 'Demasiados intentos. Espere 10 minutos.' });
        if (action === 'permiso') {
          if (!guardada) return res.status(409).json({ error: 'Todavía no hay clave de seguridad', sin_clave: true });
          if (!claveCorrecta(String(body.clave || ''), guardada)) {
            await anotar(yo.nombre, 'seguridad-fallida', '');
            return res.status(400).json({ error: 'La clave de seguridad no es correcta' });
          }
          return res.status(200).json({ ok: true, permiso: firmar(yo.nombre, 'permiso', 5 * 60 * 1000, 'p'), minutos: 5 });
        }
        const nueva = String(body.nueva || '');
        if (guardada && !claveCorrecta(String(body.actual || ''), guardada)) {
          await anotar(yo.nombre, 'seguridad-fallida', '');
          return res.status(400).json({ error: 'La clave de seguridad actual no es correcta' });
        }
        if (nueva.length < 8) return res.status(400).json({ error: 'La clave de seguridad debe tener al menos 8 caracteres' });
        await run("INSERT INTO ajustes (clave, valor) VALUES ('clave_seguridad', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [hashClave(nueva)]);
        await anotar(yo.nombre, guardada ? 'cambio-clave-seguridad' : 'crear-clave-seguridad', '');
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(404).json({ error: 'Acción no válida' });
  } catch (e) {
    console.error('auth', e);
    return res.status(500).json({ error: 'Error interno' });
  }
}
