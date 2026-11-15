// V8 Auth - Auto-login DIRECTO sin pantalla
console.log('🔓 NOA Auth: entrada directa activada');

// Simular usuario logueado inmediatamente
localStorage.setItem('noa_token', 'auto-hermann-v8');
localStorage.setItem('noa_usuario', 'Hermann');
localStorage.setItem('noa_rol', 'oficina');

// Objeto AUTH global
window.AUTH = {
  token: 'auto-hermann-v8',
  usuario: 'Hermann',
  rol: 'oficina',
  init: function() { return Promise.resolve(true); },
  check: function() { return Promise.resolve(true); },
  login: function() { return Promise.resolve(true); },
  logout: function() { location.reload(); },
  getToken: function() { return 'auto-hermann-v8'; },
  getUsuario: function() { return 'Hermann'; },
  getRol: function() { return 'oficina'; },
  headers: function() { return { 'Authorization': 'Bearer auto-hermann-v8' }; }
};

// Para compatibilidad: también como variable global
window.noaToken = 'auto-hermann-v8';
window.noaUsuario = 'Hermann';
window.noaRol = 'oficina';

console.log('✅ Usuario Hermann autenticado automáticamente');

// Función getUserNOA - Retorna el objeto usuario con id para las queries
window.getUserNOA = async function() {
  return {
    id: 'b6090401-971a-4451-a20a-f6c686deb053',
    nombre: 'Hermann Solera',
    email: 'segurossolera@outlook.com',
    rol: 'oficina'
  };
};

console.log('✅ getUserNOA configurado para Hermann');
