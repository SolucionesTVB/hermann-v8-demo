// V8 Auth - Auto-login sin pantalla de login
const AUTH = {
  token: null,
  usuario: 'Hermann',
  rol: 'oficina',
  init() {
    // Auto-login inmediato
    this.token = 'auto';
    localStorage.setItem('noa_token', 'auto');
    localStorage.setItem('noa_usuario', 'Hermann');
    localStorage.setItem('noa_rol', 'oficina');
    return Promise.resolve(true);
  },
  async check() { return true; },
  async login() { return true; },
  logout() { location.reload(); },
  getToken() { return 'auto'; },
  getUsuario() { return 'Hermann'; },
  getRol() { return 'oficina'; },
  headers() { return { 'Authorization': 'Bearer auto' }; }
};

// Auto-init
AUTH.init();

window.AUTH = AUTH;
export default AUTH;
