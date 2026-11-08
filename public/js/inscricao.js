(function () {
  const { h, icone, api, moeda, FORMAS } = window.T;
  const form = document.getElementById('form');
  const erroBox = document.getElementById('erro');
  const btnVoltar = document.getElementById('voltar');
  const btnAvancar = document.getElementById('avancar');

  const estado = { passo: 1, cursos: [], cursoId: null, forma: 'pix', enviando: false };
  const preSel = parseInt(new URLSearchParams(location.search).get('curso'), 10);

  document.getElementById('icone-ok').append(icone('check', '#2F5D4E', 36));
  document.querySelector('#r-nome').classList.add('serif');

  api('/api/cursos').then((cursos) => {
    estado.cursos = cursos;
    if (cursos.some((c) => c.id === preSel)) estado.cursoId = preSel;
    else { const livre = cursos.find((c) => c.vagas_livres > 0); estado.cursoId = livre ? livre.id : null; }
    render();
  }).catch(() => mostrarErro('Não foi possível carregar os cursos. Recarregue a página.'));

  function mostrarErro(msg) {
    erroBox.textContent = msg;
    erroBox.classList.toggle('hidden', !msg);
    if (msg) erroBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function render() {
    // etapas
    document.querySelectorAll('[data-etapa]').forEach((s) => s.classList.toggle('hidden', Number(s.dataset.etapa) !== estado.passo));
    document.querySelectorAll('#stepper li').forEach((li) => {
      const n = Number(li.dataset.passo);
      li.classList.toggle('atual', n === estado.passo);
      li.classList.toggle('feito', n < estado.passo);
      li.querySelector('.dot').textContent = n < estado.passo ? '✓' : n;
    });
    document.getElementById('navegacao').classList.toggle('hidden', estado.passo === 4);
    btnVoltar.classList.toggle('hidden', estado.passo === 1);
    btnAvancar.textContent = estado.enviando ? 'Enviando…' : estado.passo === 3 ? 'Enviar inscrição' : 'Continuar';
    btnAvancar.disabled = estado.enviando;

    // cursos
    document.getElementById('opcoes-curso').replaceChildren(...estado.cursos.map((c) => {
      const livres = c.vagas_livres;
      const rotulo = livres <= 0 ? 'Lista de espera' : livres === 1 ? 'Última vaga' : `${livres} vagas`;
      return h('button', { type: 'button', class: 'opcao', 'aria-pressed': String(c.id === estado.cursoId),
        onclick: () => { estado.cursoId = c.id; render(); } },
        h('span', { class: 'linha' }, h('span', { class: 'nome' }, c.nome), h('span', { class: 'radio' })),
        h('span', { class: 'muted small' }, c.horario),
        h('span', { class: 'linha small' }, h('b', {}, `${moeda(c.valor_mensal)}/mês`),
          h('span', { class: livres <= 0 ? 'muted' : '' }, rotulo)));
    }));

    // pagamento
    const desc = { pix: 'Você recebe a chave Pix todo mês no WhatsApp.', cartao: 'Cobrança automática no cartão de crédito.', boleto: 'Boleto enviado por e-mail antes do vencimento.' };
    document.getElementById('opcoes-pagamento').replaceChildren(...['pix', 'cartao', 'boleto'].map((f) =>
      h('button', { type: 'button', class: 'opcao', 'aria-pressed': String(f === estado.forma), onclick: () => { estado.forma = f; render(); } },
        h('span', { class: 'linha' }, h('b', {}, FORMAS[f]), h('span', { class: 'radio' })),
        h('span', { class: 'muted small' }, desc[f]))));

    // resumo
    const c = estado.cursos.find((x) => x.id === estado.cursoId);
    document.getElementById('r-nome').textContent = c ? c.nome : 'Escolha um curso';
    document.getElementById('r-horario').textContent = c ? c.horario : '';
    document.getElementById('r-valor').textContent = c ? moeda(c.valor_mensal) : '—';
    document.getElementById('r-forma').textContent = FORMAS[estado.forma];
    document.getElementById('r-capa').style.backgroundColor = c ? c.cor : '';
  }

  function validarPasso() {
    if (estado.passo === 1 && !estado.cursoId) return 'Escolha um curso.';
    if (estado.passo === 2) {
      const nome = form.nome.value.trim();
      const tel = form.whatsapp.value.replace(/\D/g, '');
      if (nome.length < 3) { form.nome.focus(); return 'Informe seu nome completo.'; }
      if (tel.length < 10 || tel.length > 13) { form.whatsapp.focus(); return 'Informe um WhatsApp válido com DDD.'; }
      if (form.email.value && !form.email.checkValidity()) { form.email.focus(); return 'E-mail inválido.'; }
    }
    if (estado.passo === 3 && !form.aceite.checked) return 'É preciso aceitar as regras do ateliê.';
    return '';
  }

  btnVoltar.addEventListener('click', () => { mostrarErro(''); estado.passo -= 1; render(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = validarPasso();
    mostrarErro(erro);
    if (erro) return;
    if (estado.passo < 3) { estado.passo += 1; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }

    estado.enviando = true; render();
    try {
      const r = await api('/api/inscricoes', { method: 'POST', body: {
        curso_id: estado.cursoId, forma_pagamento: estado.forma, aceite: form.aceite.checked,
        nome: form.nome.value, whatsapp: form.whatsapp.value, email: form.email.value, nascimento: form.nascimento.value,
        como_conheceu: form.como_conheceu.value, experiencia: form.experiencia.value, observacoes: form.observacoes.value,
        site: form.site.value,
      } });
      const p = document.getElementById('msg-sucesso');
      p.replaceChildren(
        r.lista_espera ? 'Você entrou na lista de espera de ' : 'Recebemos seu pedido para ',
        h('strong', {}, r.curso || ''),
        r.lista_espera ? '. Avisaremos pelo WhatsApp assim que abrir uma vaga.' : '. Em breve o ateliê confirma sua vaga pelo WhatsApp.');
      estado.passo = 4;
    } catch (e) {
      mostrarErro(e.message);
    } finally {
      estado.enviando = false; render();
    }
  });
})();
