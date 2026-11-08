(function () {
  const form = document.getElementById('form-login');
  const erro = document.getElementById('erro');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await window.T.api('/api/admin/login', { method: 'POST', body: { email: form.email.value, senha: form.senha.value } });
      location.href = '/admin';
    } catch (e) {
      erro.textContent = e.message;
      erro.classList.remove('hidden');
      btn.disabled = false;
    }
  });
})();
