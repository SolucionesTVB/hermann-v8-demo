function detectarColumnaFecha(cliente, tipo) {
  if (tipo === "desde") {
    if (cliente["Fecha Desde"] !== undefined) return cliente["Fecha Desde"];
    if (cliente["Fecha Desde "] !== undefined) return cliente["Fecha Desde "];
  } else {
    if (cliente["Fecha Hasta"] !== undefined) return cliente["Fecha Hasta"];
    if (cliente["Fecha Hasta "] !== undefined) return cliente["Fecha Hasta "];
  }
  const palabrasDesde = ["vigencia desde", "fecha inicio", "inicio", "fec desde", "vigdesde"];
  const palabrasHasta = ["vigencia hasta", "fecha fin", "vencimiento", "fec hasta", "vighasta"];
  const palabras = tipo === "desde" ? palabrasDesde : palabrasHasta;
  for (const key of Object.keys(cliente)) {
    const keyLower = key.toLowerCase().trim();
    for (const palabra of palabras) {
      if (keyLower === palabra || keyLower.includes(palabra)) return cliente[key];
    }
  }
  return null;
}
function convertirFechaExcel(valor) {
  if (!valor) return null;
  if (typeof valor === 'string' && valor.includes('-')) return valor;
  if (typeof valor === 'number') {
    const fecha = new Date((valor - 25569) * 86400 * 1000);
    return fecha.toISOString().split('T')[0];
  }
  return null;
}
async function guardarClientesSupabase(clientes) {
  try {
    const user = await getUserNOA();
    if (!user) throw new Error("No autenticado");
    const resp = await fetch('/api/clientes?action=guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, clientes })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error guardando');
    console.log('✅ Guardado:', json.actualizados, 'actualizados,', json.nuevos, 'nuevos');
    return { success: true, actualizados: json.actualizados, nuevos: json.nuevos, total: clientes.length };
  } catch (error) {
    console.error("Error guardando:", error);
    return { success: false, error: error.message };
  }
}
async function cargarClientesSupabase() {
  try {
    const user = await getUserNOA();
    if (!user) throw new Error('No autenticado');
    const resp = await fetch('/api/clientes?user_id=' + encodeURIComponent(user.id));
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error cargando');
    return { success: true, clientes: json.clientes || [] };
  } catch (error) {
    console.error('Error cargando:', error);
    return { success: false, error: error.message };
  }
}
async function actualizarClienteSupabase(clienteId, cambios) {
  try {
    if (cambios.desde && cambios.desde.includes('/')) { const [dd, mm, yyyy] = cambios.desde.split('/'); cambios.desde = yyyy+'-'+mm+'-'+dd; }
    if (cambios.hasta && cambios.hasta.includes('/')) { const [dd, mm, yyyy] = cambios.hasta.split('/'); cambios.hasta = yyyy+'-'+mm+'-'+dd; }
    const resp = await fetch('/api/clientes?action=actualizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clienteId, cambios })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error actualizando');
    if (typeof limpiarTodosLosIndicadores === "function") limpiarTodosLosIndicadores();
    return { success: true };
  } catch (error) {
    console.error('Error actualizando:', error);
    return { success: false, error: error.message };
  }
}
async function marcarPagadoSupabase(clienteId) {
  try {
    const user = await getUserNOA();
    if (!user) throw new Error('No autenticado');
    const resp = await fetch('/api/clientes?action=marcar-pagado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clienteId, user_id: user.id })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error marcando pagado');
    if (typeof limpiarTodosLosIndicadores === "function") limpiarTodosLosIndicadores();
    return { success: true };
  } catch (error) {
    console.error("Error marcando pagado:", error);
    return { success: false, error: error.message };
  }
}
async function limpiarClientesSupabase() {
  try {
    const user = await getUserNOA();
    if (!user) throw new Error('No autenticado');
    const resp = await fetch('/api/clientes?action=limpiar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error limpiando');
    if (typeof limpiarTodosLosIndicadores === "function") limpiarTodosLosIndicadores();
    return { success: true };
  } catch (error) {
    console.error('Error limpiando:', error);
    return { success: false, error: error.message };
  }
}
async function borrarClienteSupabase(clienteId) {
  try {
    const resp = await fetch('/api/clientes?action=borrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clienteId })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error borrando');
    window.datosReales = (window.datosReales || []).filter(function(c) { return c.id !== clienteId; });
    if (typeof limpiarTodosLosIndicadores === "function") limpiarTodosLosIndicadores();
    return { success: true };
  } catch (error) {
    console.error('Error borrando:', error);
    return { success: false, error: error.message };
  }
}
async function cargarClientesBorrados() {
  try {
    const user = await getUserNOA();
    if (!user) throw new Error('No autenticado');
    const resp = await fetch('/api/clientes?user_id=' + encodeURIComponent(user.id) + '&action=borrados');
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error cargando borrados');
    return { success: true, clientes: json.clientes || [] };
  } catch (error) {
    console.error('Error cargando borrados:', error);
    return { success: false, error: error.message };
  }
}
async function restaurarClienteSupabase(clienteId) {
  try {
    const resp = await fetch('/api/clientes?action=restaurar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clienteId })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Error restaurando');
    return { success: true };
  } catch (error) {
    console.error('Error restaurando:', error);
    return { success: false, error: error.message };
  }
}
window.guardarClientesSupabase = guardarClientesSupabase;
window.cargarClientesSupabase = cargarClientesSupabase;
window.actualizarClienteSupabase = actualizarClienteSupabase;
window.marcarPagadoSupabase = marcarPagadoSupabase;
window.limpiarClientesSupabase = limpiarClientesSupabase;
window.borrarClienteSupabase = borrarClienteSupabase;
window.cargarClientesBorrados = cargarClientesBorrados;
window.restaurarClienteSupabase = restaurarClienteSupabase;
