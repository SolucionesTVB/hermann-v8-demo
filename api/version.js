// Versión publicada del sistema. La pantalla la consulta para avisar cuando hay una versión nueva.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'sin-version';
  res.status(200).json({ v: String(v).slice(0, 40) });
}
