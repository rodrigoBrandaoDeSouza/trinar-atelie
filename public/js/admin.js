(function () {
  const { h, api, moeda, dataBR, formatarTel, linkWhats, FORMAS, toast } = window.T;

  const tela = document.getElementById('tela');
  const titulo = document.getElementById('titulo');
  const subtitulo = document.getElementById('subtitulo');
  const inputMes = document.getElementById('mes');
  const campoMes = document.getElementById('campo-mes');
  const btnCsv = document.getElementById('btn-csv');
  const btnPrincipal = document.getElementById('btn-principal');

  const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  inputMes.value = hojeSP.slice(0, 7);
  subtitulo.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  const estado = { aba: location.hash.slice(1) || 'geral', filtroMens: 'todas', filtroInsc: 'pendente', busca: '', cursoFiltro: '', cursos: [], whats: { configurado: false, conectado: false, nao_lidas: 0 }, conversa: null };

  const ABAS = {
    geral: { titulo: 'Resumo do ateliê', acao: '+ Nova aluna', mes: true, render: renderGeral },
    cursos: { titulo: 'Cursos e turmas', acao: '+ Novo curso', mes: false, render: renderCursos },
    alunas: { titulo: 'Alunas matriculadas', acao: '+ Nova aluna', mes: true, render: renderAlunas },
    mensalidades: { titulo: 'Mensalidades', acao: '+ Nova aluna', mes: true, render: renderMensalidades },
    inscricoes: { titulo: 'Inscrições pelo site', acao: '+ Nova aluna', mes: false, render: renderInscricoes },
    conversas: { titulo: 'Conversas no WhatsApp', acao: '+ Nova aluna', mes: false, render: renderConversas },
    whatsapp: { titulo: 'WhatsApp do ateliê', acao: '+ Nova aluna', mes: false, render: renderWhatsapp },
  };

  const mes = () => inputMes.value;
  const nomeMes = () => new Date(`${mes()}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  // ---------- Navegação ----------
  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aba)));
  inputMes.addEventListener('change', () => carregar());
  btnPrincipal.addEventListener('click', () => (estado.aba === 'cursos' ? abrirCurso() : abrirAluna()));
  document.getElementById('sair').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    location.href = '/admin/login';
  });

  function irPara(aba) {
    if (!ABAS[aba]) aba = 'geral';
    estado.aba = aba;
    history.replaceState(null, '', `#${aba}`);
    carregar();
  }

  async function carregar() {
    const cfg = ABAS[estado.aba] ? ABAS[estado.aba] : ABAS.geral;
    document.querySelectorAll('.aba').forEach((b) => b.setAttribute('aria-current', b.dataset.aba === estado.aba ? 'page' : 'false'));
    titulo.textContent = cfg.titulo;
    btnPrincipal.textContent = cfg.acao;
    campoMes.classList.toggle('hidden', !cfg.mes);
    btnCsv.classList.toggle('hidden', estado.aba !== 'mensalidades');
    btnCsv.href = `/api/admin/mensalidades.csv?mes=${mes()}`;
    try {
      await cfg.render();
    } catch (e) {
      tela.replaceChildren(h('div', { class: 'alerta alerta-erro' }, e.message));
    }
    atualizarBadges();
  }

  async function atualizarBadges() {
    try {
      const r = await api(`/api/admin/resumo?mes=${hojeSP.slice(0, 7)}`);
      badge('badge-geral', r.inscricoes.length);
      badge('badge-mens', r.atrasados.length);
    } catch { /* ignora */ }
    await atualizarWhats();
  }
  async function atualizarWhats() {
    try {
      estado.whats = await api('/api/admin/whatsapp/status');
      badge('badge-conversas', estado.whats.nao_lidas);
      const dot = document.getElementById('dot-whats');
      dot.className = `dot-status ${estado.whats.conectado ? 'on' : 'off'}`;
      dot.title = estado.whats.conectado ? 'Conectado' : 'Desconectado';
    } catch { /* ignora */ }
  }
  function badge(id, n) {
    const el = document.getElementById(id);
    el.textContent = n;
    el.classList.toggle('hidden', !n);
  }

  const pillSituacao = (s) => ({
    pago: h('span', { class: 'pill pill-ok' }, 'Em dia'),
    a_vencer: h('span', { class: 'pill pill-warn' }, 'A vencer'),
    atrasado: h('span', { class: 'pill pill-bad' }, 'Em atraso'),
  }[s] || h('span', { class: 'pill pill-neutral' }, 'Sem cobrança'));

  async function acao(fn, msg) {
    try { await fn(); if (msg) toast(msg); await carregar(); }
    catch (e) { toast(e.message); }
  }

  // Com o WhatsApp do ateliê conectado, envia direto pelo número do ateliê; senão, abre o wa.me.
  function botaoCobrar(m) {
    const vencida = m.vencimento < hojeSP;
    if (estado.whats.conectado) {
      return h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (ev) => {
        ev.currentTarget.disabled = true;
        acao(() => api(`/api/admin/whatsapp/mensalidades/${m.id}/cobrar`, { method: 'POST' }),
          vencida ? 'Cobrança enviada pelo WhatsApp.' : 'Lembrete enviado pelo WhatsApp.');
      } }, vencida ? 'Cobrar no WhatsApp' : 'Lembrar no WhatsApp');
    }
    const texto = `Olá, ${m.nome.split(' ')[0]}! Tudo bem? Passando para lembrar da mensalidade de ${m.curso} (${moeda(m.valor)}), com vencimento em ${dataBR(m.vencimento)}. Qualquer dúvida, é só chamar!`;
    return h('a', { class: 'btn btn-ghost btn-sm', href: linkWhats(m.whatsapp, texto), target: '_blank', rel: 'noopener' }, 'Cobrar no WhatsApp');
  }
  const botaoPagar = (id) => h('button', { type: 'button', class: 'btn btn-primary btn-sm',
    onclick: () => acao(() => api(`/api/admin/mensalidades/${id}/pagar`, { method: 'POST' }), 'Pagamento registrado.') }, 'Recebido');

  // ---------- Visão geral ----------
  async function renderGeral() {
    const r = await api(`/api/admin/resumo?mes=${mes()}`);
    const pct = r.previsto ? Math.round((r.recebido / r.previsto) * 100) : 0;
    const kpi = (rotulo, valor, sub, cls) => h('div', { class: 'kpi' },
      h('span', { class: 'rotulo' }, rotulo), h('span', { class: `valor ${cls || ''}` }, valor), h('span', { class: 'sub' }, sub));

    tela.replaceChildren(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '24px' } },
      h('div', { class: 'kpis' },
        kpi('Alunas matriculadas', r.alunas, `${r.matriculas} matrículas ativas`),
        kpi('Cursos ativos no site', r.cursos_ativos, `de ${r.cursos_total} cadastrados`),
        kpi(`Recebido em ${nomeMes()}`, moeda(r.recebido), `de ${moeda(r.previsto)} previstos`, 'verde'),
        kpi('Em atraso (todos os meses)', moeda(r.atrasado), `${moeda(r.a_vencer)} a vencer em ${nomeMes()}`, 'vermelho')),
      h('div', { class: 'bloco' },
        h('div', { class: 'bloco-topo small' }, h('b', {}, `Recebido em ${nomeMes()}`), h('b', {}, `${pct}% do previsto`)),
        h('div', { class: 'barra' }, h('div', { style: { width: `${pct}%` } }))),
      h('div', { class: 'duas-colunas' },
        h('section', { class: 'bloco' },
          h('div', { class: 'bloco-topo' }, h('h2', {}, 'Mensalidades em atraso'), h('b', { class: 'small' }, `${r.atrasados.length}`)),
          r.atrasados.length ? r.atrasados.map((m) => h('div', { class: 'item-lista' },
            h('div', { class: 'info' }, h('b', {}, m.nome), h('span', {}, `${m.curso} · venceu ${dataBR(m.vencimento)} · ${moeda(m.valor)}`)),
            h('div', { class: 'botoes' }, botaoCobrar(m), botaoPagar(m.id))))
            : h('p', { class: 'vazio' }, 'Nenhuma mensalidade em atraso.')),
        h('section', { class: 'bloco' },
          h('div', { class: 'bloco-topo' }, h('h2', {}, 'Novas inscrições pelo site'), h('span', { class: 'small muted' }, `${r.inscricoes.length} aguardando`)),
          r.inscricoes.length ? r.inscricoes.map(itemInscricao) : h('p', { class: 'vazio' }, 'Nenhuma inscrição aguardando confirmação.')))));
  }

  function itemInscricao(i) {
    const quando = new Date(i.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    return h('div', { class: 'item-lista' },
      h('div', { class: 'info' }, h('b', {}, i.nome, i.lista_espera ? ' · lista de espera' : ''),
        h('span', {}, `${i.curso} · ${quando} · ${FORMAS[i.forma_pagamento]} · ${formatarTel(i.whatsapp)}`)),
      h('div', { class: 'botoes' },
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => {
          if (confirm(`Recusar a inscrição de ${i.nome}?`)) acao(() => api(`/api/admin/inscricoes/${i.id}/recusar`, { method: 'POST' }), 'Inscrição recusada.');
        } }, 'Recusar'),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => acao(async () => {
          const r = await api(`/api/admin/inscricoes/${i.id}/confirmar`, { method: 'POST' });
          if (r.whatsapp_enviado) { toast('Vaga confirmada. Boas-vindas enviadas pelo WhatsApp.'); return; }
          const msg = `Olá, ${i.nome.split(' ')[0]}! Sua vaga em ${i.curso} no Trinar Ateliê Criativo está confirmada. Seja bem-vinda!`;
          window.open(linkWhats(i.whatsapp, msg), '_blank', 'noopener');
          toast('Vaga confirmada e matrícula criada.');
        }) }, 'Confirmar vaga')));
  }

  // ---------- Cursos ----------
  async function renderCursos() {
    estado.cursos = await api('/api/admin/cursos');
    if (!estado.cursos.length) { tela.replaceChildren(h('p', { class: 'vazio' }, 'Nenhum curso cadastrado ainda.')); return; }
    tela.replaceChildren(h('div', { class: 'cursos-admin' }, estado.cursos.map((c) => {
      const cheia = c.alunos >= c.vagas;
      const pct = Math.min(100, Math.round((c.alunos / c.vagas) * 100));
      return h('article', { class: 'curso-admin' },
        h('div', { class: 'linha-entre' },
          h('div', {}, h('h2', {}, c.nome), h('span', { class: 'muted small' }, c.horario)),
          h('button', { type: 'button', class: 'chave', 'aria-pressed': String(c.ativo), 'aria-label': `Mostrar ${c.nome} no site`,
            onclick: () => acao(() => api(`/api/admin/cursos/${c.id}/ativo`, { method: 'PATCH', body: { ativo: !c.ativo } }),
              c.ativo ? 'Curso ocultado do site.' : 'Curso visível no site.') }, h('span', {}))),
        h('div', {},
          h('div', { class: 'linha-entre' }, h('span', { class: 'muted' }, 'Alunas'), h('b', {}, `${c.alunos} de ${c.vagas} vagas`)),
          h('div', { class: `barra fina ${cheia ? 'cheia' : ''}` }, h('div', { style: { width: `${pct}%` } }))),
        h('div', { class: 'linha-entre' },
          h('span', { class: 'muted' }, 'Mensalidade ', h('b', {}, moeda(c.valor_mensal))),
          !c.ativo ? h('span', { class: 'pill pill-neutral' }, 'Oculto no site')
            : cheia ? h('span', { class: 'pill pill-warn' }, 'Turma cheia') : h('span', { class: 'pill pill-ok' }, 'Inscrições abertas')),
        h('div', { class: 'botoes' },
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => abrirCurso(c) }, 'Editar'),
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { estado.cursoFiltro = String(c.id); irPara('alunas'); } }, 'Ver alunas'),
          c.alunos && estado.whats.conectado ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => abrirAviso(c) }, 'Avisar turma') : null));
    })));
  }

  const dlgCurso = document.getElementById('dlg-curso');
  const formCurso = document.getElementById('form-curso');
  let cursoEditando = null;
  function abrirCurso(c) {
    cursoEditando = c || null;
    formCurso.reset();
    document.getElementById('dlg-curso-titulo').textContent = c ? 'Editar curso' : 'Novo curso';
    formCurso.querySelector('.alerta').classList.add('hidden');
    if (c) {
      for (const k of ['nome', 'nivel', 'horario', 'vagas', 'valor_mensal', 'cor', 'ordem', 'descricao']) formCurso[k].value = c[k] ?? '';
      formCurso.ativo.checked = c.ativo;
    }
    dlgCurso.showModal();
  }
  formCurso.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.submitter && ev.submitter.value === 'cancel') return dlgCurso.close();
    const f = formCurso;
    const body = { nome: f.nome.value, nivel: f.nivel.value, horario: f.horario.value, vagas: f.vagas.value, valor_mensal: f.valor_mensal.value,
      cor: f.cor.value, ordem: f.ordem.value, descricao: f.descricao.value, ativo: f.ativo.checked };
    try {
      if (cursoEditando) await api(`/api/admin/cursos/${cursoEditando.id}`, { method: 'PUT', body });
      else await api('/api/admin/cursos', { method: 'POST', body });
      dlgCurso.close();
      toast('Curso salvo.');
      carregar();
    } catch (e) {
      const a = f.querySelector('.alerta'); a.textContent = e.message; a.classList.remove('hidden');
    }
  });

  // ---------- Alunas ----------
  async function renderAlunas() {
    if (!estado.cursos.length) estado.cursos = await api('/api/admin/cursos');
    const params = new URLSearchParams({ mes: mes() });
    if (estado.busca) params.set('q', estado.busca);
    if (estado.cursoFiltro) params.set('curso_id', estado.cursoFiltro);
    const rows = await api(`/api/admin/alunas?${params}`);

    const busca = h('input', { type: 'search', placeholder: 'Nome ou telefone', value: estado.busca });
    let t;
    busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { estado.busca = busca.value; renderAlunas().then(() => {
      const el = tela.querySelector('input[type=search]'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 300); });
    const sel = h('select', { onchange: (e) => { estado.cursoFiltro = e.target.value; renderAlunas(); } },
      h('option', { value: '' }, 'Todos os cursos'),
      estado.cursos.map((c) => h('option', { value: c.id, selected: String(c.id) === estado.cursoFiltro }, c.nome)));

    tela.replaceChildren(
      h('div', { class: 'filtros' },
        h('label', { class: 'field', style: { flex: '1 1 260px' } }, 'Buscar aluna', busca),
        h('label', { class: 'field', style: { flex: '0 1 240px' } }, 'Curso', sel)),
      h('div', { class: 'tabela-box', style: { marginTop: '16px' } },
        h('table', {},
          h('thead', {}, h('tr', {}, ['Aluna', 'Curso', 'WhatsApp', 'Desde', `Mensalidade de ${nomeMes()}`, ''].map((x) => h('th', {}, x || h('span', { class: 'sr-only' }, 'Ações'))))),
          h('tbody', {}, rows.length ? rows.map((r) => h('tr', {},
            h('td', {}, h('b', {}, r.nome)),
            h('td', {}, r.curso),
            h('td', {}, h('a', { href: linkWhats(r.whatsapp), target: '_blank', rel: 'noopener' }, formatarTel(r.whatsapp))),
            h('td', { class: 'muted' }, dataBR(r.inicio)),
            h('td', {}, pillSituacao(r.situacao)),
            h('td', { class: 'acao' }, h('button', { type: 'button', class: 'link-btn', onclick: () => {
              if (confirm(`Encerrar a matrícula de ${r.nome} em ${r.curso}? Ela deixa de gerar mensalidades.`)) {
                acao(() => api(`/api/admin/matriculas/${r.matricula_id}/encerrar`, { method: 'POST' }), 'Matrícula encerrada.');
              }
            } }, 'Encerrar matrícula'))))
            : h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'Nenhuma aluna encontrada.'))))),
      h('p', { class: 'small muted', style: { marginTop: '12px' } }, `${rows.length} matrícula(s)`));
  }

  const dlgAluna = document.getElementById('dlg-aluna');
  const formAluna = document.getElementById('form-aluna');
  async function abrirAluna() {
    if (!estado.cursos.length) estado.cursos = await api('/api/admin/cursos');
    formAluna.reset();
    formAluna.querySelector('.alerta').classList.add('hidden');
    formAluna.curso_id.replaceChildren(...estado.cursos.map((c) => h('option', { value: c.id }, `${c.nome} (${c.alunos}/${c.vagas})`)));
    dlgAluna.showModal();
  }
  formAluna.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.submitter && ev.submitter.value === 'cancel') return dlgAluna.close();
    const f = formAluna;
    const body = {};
    for (const k of ['nome', 'whatsapp', 'email', 'nascimento', 'curso_id', 'forma_pagamento', 'dia_vencimento', 'observacoes']) body[k] = f[k].value;
    try {
      await api('/api/admin/alunas', { method: 'POST', body });
      dlgAluna.close();
      toast('Aluna matriculada.');
      carregar();
    } catch (e) {
      const a = f.querySelector('.alerta'); a.textContent = e.message; a.classList.remove('hidden');
    }
  });

  // ---------- Mensalidades ----------
  async function renderMensalidades() {
    const todas = await api(`/api/admin/mensalidades?mes=${mes()}`);
    const conta = (s) => todas.filter((m) => m.situacao === s).length;
    const filtros = [['todas', 'Todas', todas.length], ['atrasado', 'Em atraso', conta('atrasado')], ['a_vencer', 'A vencer', conta('a_vencer')], ['pago', 'Pagas', conta('pago')]];
    const rows = estado.filtroMens === 'todas' ? todas : todas.filter((m) => m.situacao === estado.filtroMens);
    const total = rows.reduce((s, m) => s + m.valor, 0);

    tela.replaceChildren(
      h('div', { class: 'filtros', role: 'group', 'aria-label': 'Filtrar por situação' }, filtros.map(([id, rot, n]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(estado.filtroMens === id),
          onclick: () => { estado.filtroMens = id; renderMensalidades(); } }, `${rot} (${n})`))),
      h('div', { class: 'tabela-box', style: { marginTop: '16px' } },
        h('table', {},
          h('thead', {}, h('tr', {}, ['Aluna', 'Curso', 'Vencimento', 'Valor', 'Situação', ''].map((x) => h('th', {}, x || h('span', { class: 'sr-only' }, 'Ações'))))),
          h('tbody', {}, rows.length ? rows.map((m) => h('tr', {},
            h('td', {}, h('b', {}, m.nome)),
            h('td', {}, m.curso),
            h('td', { class: 'muted' }, dataBR(m.vencimento)),
            h('td', {}, h('b', {}, moeda(m.valor))),
            h('td', {}, pillSituacao(m.situacao)),
            h('td', { class: 'acao' }, m.situacao === 'pago'
              ? h('span', {}, h('span', { class: 'small muted' }, `Pago em ${new Date(m.pago_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} `),
                  h('button', { type: 'button', class: 'link-btn', onclick: () => acao(() => api(`/api/admin/mensalidades/${m.id}/desfazer`, { method: 'POST' }), 'Pagamento desfeito.') }, 'Desfazer'))
              : h('span', { class: 'botoes' }, botaoCobrar(m), ' ',
                  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => acao(() => api(`/api/admin/mensalidades/${m.id}/pagar`, { method: 'POST' }), 'Pagamento registrado.') }, 'Marcar como pago')))))
            : h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'Nenhuma mensalidade neste filtro.'))))),
      h('p', { class: 'small muted', style: { marginTop: '12px' } }, `${rows.length} mensalidade(s) · total ${moeda(total)}`));
  }

  // ---------- Inscrições ----------
  async function renderInscricoes() {
    const rows = await api(`/api/admin/inscricoes?status=${estado.filtroInsc}`);
    const filtros = [['pendente', 'Aguardando'], ['confirmada', 'Confirmadas'], ['recusada', 'Recusadas']];
    tela.replaceChildren(
      h('div', { class: 'filtros' }, filtros.map(([id, rot]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(estado.filtroInsc === id),
        onclick: () => { estado.filtroInsc = id; renderInscricoes(); } }, rot))),
      h('section', { class: 'bloco', style: { marginTop: '16px' } },
        rows.length ? rows.map((i) => estado.filtroInsc === 'pendente' ? itemInscricao(i)
          : h('div', { class: 'item-lista' },
            h('div', { class: 'info' }, h('b', {}, i.nome), h('span', {}, `${i.curso} · ${formatarTel(i.whatsapp)} · ${i.email || 'sem e-mail'}`)),
            h('span', { class: 'small muted' }, i.observacoes || '')))
          : h('p', { class: 'vazio' }, 'Nada por aqui.')));
  }


  // ---------- Avisar turma ----------
  const dlgAviso = document.getElementById('dlg-aviso');
  const formAviso = document.getElementById('form-aviso');
  let cursoAviso = null;
  function abrirAviso(c) {
    cursoAviso = c;
    formAviso.reset();
    formAviso.querySelector('.alerta').classList.add('hidden');
    document.getElementById('aviso-curso').textContent = `${c.nome} · ${c.alunos} aluna(s)`;
    dlgAviso.showModal();
  }
  formAviso.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.submitter && ev.submitter.value === 'cancel') return dlgAviso.close();
    try {
      const r = await api('/api/admin/whatsapp/avisar-turma', { method: 'POST', body: { curso_id: cursoAviso.id, texto: formAviso.texto.value } });
      dlgAviso.close();
      toast(`Enviando para ${r.total} aluna(s), com intervalo entre as mensagens.`);
    } catch (e) {
      const a = formAviso.querySelector('.alerta'); a.textContent = e.message; a.classList.remove('hidden');
    }
  });

  // ---------- Conversas ----------
  let pollConversas = null;
  const horaCurta = (iso) => {
    const d = new Date(iso);
    const hoje = new Date().toDateString() === d.toDateString();
    return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }
      : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  };
  const ROTULO_TIPO = { inscricao_recebida: 'automática · inscrição', boas_vindas: 'automática · boas-vindas', lembrete: 'automática · lembrete',
    cobranca: 'cobrança', aviso_turma: 'aviso para a turma', aviso_dona: 'aviso para a dona', celular: 'enviada pelo celular' };

  async function renderConversas() {
    clearInterval(pollConversas);
    if (!estado.whats.configurado || !estado.whats.conectado) {
      tela.replaceChildren(h('div', { class: 'bloco' },
        h('h2', {}, 'WhatsApp não conectado'),
        h('p', { class: 'muted' }, 'Conecte o número do ateliê na aba WhatsApp para conversar com as alunas por aqui.'),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => irPara('whatsapp') }, 'Conectar WhatsApp')));
      if (!estado.whats.configurado) return;
    }
    const lista = await api('/api/admin/whatsapp/conversas');
    if (!estado.conversa && lista.length && window.innerWidth > 900) estado.conversa = lista[0].chave;
    const nome = (c) => c.aluna || c.inscrita || c.contato || formatarTel(c.telefone);

    const coluna = h('div', { class: 'conversas-lista' }, lista.length ? lista.map((c) =>
      h('button', { type: 'button', class: 'conversa-item', 'aria-pressed': String(c.chave === estado.conversa),
        onclick: () => { estado.conversa = c.chave; renderConversas(); } },
        h('span', { class: 'linha-entre' }, h('b', {}, nome(c)), h('span', { class: 'small muted' }, horaCurta(c.criado_em))),
        h('span', { class: 'linha-entre' },
          h('span', { class: 'previa' }, c.direcao === 'saida' ? 'Você: ' : '', c.texto),
          c.nao_lidas ? h('span', { class: 'badge-verde' }, c.nao_lidas) : null),
        !c.aluna ? h('span', { class: 'small muted' }, c.inscrita ? 'inscrita pelo site' : 'contato novo') : null))
      : h('p', { class: 'vazio', style: { padding: '16px' } }, 'Nenhuma conversa ainda. Quando alguém mandar mensagem para o número do ateliê, aparece aqui.'));

    const atual = lista.find((c) => c.chave === estado.conversa);
    let painelChat = h('div', { class: 'chat vazio-chat' }, h('p', { class: 'muted' }, 'Escolha uma conversa.'));
    if (atual) {
      const msgs = await api(`/api/admin/whatsapp/conversas/${atual.chave}`);
      const corpo = h('div', { class: 'chat-corpo' }, msgs.map((m) => h('div', { class: `bolha ${m.direcao}${m.status === 'erro' ? ' falhou' : ''}` },
        h('div', { class: 'texto' }, m.texto),
        h('div', { class: 'meta' }, ROTULO_TIPO[m.tipo] ? `${ROTULO_TIPO[m.tipo]} · ` : '', horaCurta(m.criado_em),
          m.status === 'erro' ? ` · não enviada: ${m.erro || ''}` : ''))));
      const campo = h('textarea', { rows: 2, placeholder: 'Escreva uma mensagem…', 'aria-label': 'Mensagem', maxlength: 4000 });
      const enviar = async (ev) => {
        ev.preventDefault();
        const texto = campo.value.trim();
        if (!texto) return;
        campo.disabled = true;
        try { await api('/api/admin/whatsapp/enviar', { method: 'POST', body: { chave: atual.chave, texto } }); campo.value = ''; await renderConversas(); }
        catch (e) { toast(e.message); campo.disabled = false; }
      };
      campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) enviar(ev); });
      painelChat = h('div', { class: 'chat' },
        h('div', { class: 'chat-topo' },
          h('div', {}, h('b', {}, nome(atual)), h('div', { class: 'small muted' }, formatarTel(atual.telefone))),
          h('a', { class: 'link-btn', href: linkWhats(atual.telefone), target: '_blank', rel: 'noopener' }, 'Abrir no WhatsApp')),
        corpo,
        h('form', { class: 'chat-envio', onsubmit: enviar }, campo,
          h('button', { class: 'btn btn-primary btn-sm', type: 'submit', disabled: !estado.whats.conectado }, 'Enviar')));
      setTimeout(() => { corpo.scrollTop = corpo.scrollHeight; }, 0);
    }
    const aviso = tela.querySelector('.bloco');
    tela.replaceChildren(...(!estado.whats.conectado && aviso ? [aviso] : []), h('div', { class: 'conversas' }, coluna, painelChat));
    pollConversas = setInterval(async () => {
      if (estado.aba !== 'conversas') return clearInterval(pollConversas);
      const ativo = document.activeElement;
      if (ativo && ativo.tagName === 'TEXTAREA' && ativo.value) return; // não atrapalha quem está digitando
      const antes = estado.whats.nao_lidas;
      await atualizarWhats();
      if (estado.whats.nao_lidas !== antes) renderConversas();
    }, 8000);
  }

  // ---------- WhatsApp: conexão e automações ----------
  let pollQr = null;
  async function renderWhatsapp() {
    clearInterval(pollQr);
    const st = await api('/api/admin/whatsapp/status?forcar=1');
    estado.whats = st;
    const conexao = h('section', { class: 'bloco' }, h('h2', {}, 'Número do ateliê'));
    if (!st.configurado) {
      conexao.append(h('p', { class: 'muted' }, 'A integração ainda não está configurada no servidor. Defina as variáveis EVOLUTION_API_URL e EVOLUTION_API_KEY (veja o README) e recarregue esta página.'));
    } else if (st.conectado) {
      conexao.append(
        h('p', {}, h('span', { class: 'pill pill-ok' }, 'Conectado'), ' O site e o painel estão enviando e recebendo mensagens por este número.'),
        h('div', { class: 'botoes' },
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => {
            if (confirm('Desconectar o WhatsApp do ateliê? As mensagens automáticas param até conectar de novo.')) {
              acao(() => api('/api/admin/whatsapp/desconectar', { method: 'POST' }), 'WhatsApp desconectado.');
            }
          } }, 'Desconectar')));
    } else {
      const areaQr = h('div', { class: 'qr-area' });
      const btn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Gerando QR code…';
        try {
          const r = await api('/api/admin/whatsapp/conectar', { method: 'POST' });
          if (r.estado === 'open') { toast('WhatsApp conectado!'); return carregar(); }
          areaQr.replaceChildren(
            r.qr ? h('img', { src: r.qr.startsWith('data:') ? r.qr : `data:image/png;base64,${r.qr}`, alt: 'QR code para conectar o WhatsApp', width: 260, height: 260 })
              : h('p', { class: 'muted' }, 'QR code ainda não disponível. Clique de novo em alguns segundos.'),
            h('ol', { class: 'passos-qr' },
              h('li', {}, 'No celular do ateliê, abra o WhatsApp (ou WhatsApp Business).'),
              h('li', {}, 'Toque em ⋮ ou Configurações › Dispositivos conectados › Conectar dispositivo.'),
              h('li', {}, 'Aponte a câmera para este QR code. Ele expira em cerca de 1 minuto.')));
          btn.textContent = 'Gerar novo QR code'; btn.disabled = false;
          clearInterval(pollQr);
          pollQr = setInterval(async () => {
            if (estado.aba !== 'whatsapp') return clearInterval(pollQr);
            const s = await api('/api/admin/whatsapp/status?forcar=1').catch(() => null);
            if (s && s.conectado) { clearInterval(pollQr); toast('WhatsApp conectado!'); carregar(); }
          }, 3000);
        } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Conectar WhatsApp'; }
      } }, 'Conectar WhatsApp');
      conexao.append(
        h('p', {}, h('span', { class: 'pill pill-warn' }, 'Desconectado'), ' Use um chip exclusivo do ateliê. Clique em conectar e escaneie o QR code com o celular desse número.'),
        btn, areaQr);
    }

    const cfg = await api('/api/admin/whatsapp/config');
    const form = h('form', { class: 'bloco', id: 'form-whats' });
    const chk = (k, rot, desc) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `auto_${k}`, checked: cfg.automacoes[k] }),
      h('span', {}, h('b', {}, rot), h('br', {}), h('span', { class: 'small muted' }, desc)));
    const texto = (k, rot) => h('label', { class: 'field' }, rot, h('textarea', { name: `texto_${k}`, rows: 3, maxlength: 1000 }, cfg.textos[k]));
    form.append(
      h('h2', {}, 'Mensagens automáticas'),
      chk('inscricao_recebida', 'Inscrição recebida', 'Avisa a aluna que a inscrição chegou (ou que entrou na lista de espera).'),
      chk('aviso_dona', 'Avisar a dona', 'Manda um aviso de nova inscrição para o número pessoal abaixo.'),
      chk('boas_vindas', 'Boas-vindas', 'Ao clicar em "Confirmar vaga".'),
      chk('lembrete', 'Lembrete de vencimento', 'Uma vez, alguns dias antes do vencimento.'),
      chk('cobranca', 'Cobrança de atraso', 'Uma vez, no dia seguinte ao vencimento.'),
      h('div', { class: 'grid-form' },
        h('label', { class: 'field' }, 'Dias de antecedência do lembrete', h('input', { type: 'number', name: 'lembrete_dias_antes', min: 0, max: 10, value: cfg.lembrete_dias_antes })),
        h('label', { class: 'field' }, 'Chave Pix (vai no lembrete e na cobrança)', h('input', { name: 'chave_pix', value: cfg.chave_pix, maxlength: 140, placeholder: 'CPF, e-mail, telefone ou chave aleatória' })),
        h('label', { class: 'field' }, 'WhatsApp pessoal da dona (avisos)', h('input', { name: 'numero_dona', type: 'tel', value: cfg.numero_dona, placeholder: '(00) 00000-0000' }))),
      h('h2', {}, 'Textos'),
      h('p', { class: 'small muted' }, 'Campos que você pode usar: {nome}, {curso}, {horario}, {valor}, {vencimento}, {dia}, {pagamento}, {atelie}.'),
      texto('inscricao_recebida', 'Inscrição recebida'),
      texto('lista_espera', 'Lista de espera'),
      texto('boas_vindas', 'Boas-vindas'),
      texto('lembrete', 'Lembrete de vencimento'),
      texto('cobranca', 'Cobrança de atraso'),
      texto('aviso_dona', 'Aviso de nova inscrição (para a dona)'),
      h('div', { class: 'navegacao' },
        st.conectado ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: async (ev) => {
          const botao = ev.currentTarget;
          botao.disabled = true;
          toast('Enviando… isso pode levar alguns minutos.');
          try { const r = await api('/api/admin/whatsapp/rotina', { method: 'POST' });
            toast(r.pulada || `${r.enviadas || 0} mensagem(ns) enviada(s): ${r.lembretes} lembrete(s), ${r.cobrancas} cobrança(s).`); }
          catch (e) { toast(e.message); }
          botao.disabled = false;
        } }, 'Enviar lembretes e cobranças agora') : null,
        h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Salvar')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = form.elements;
      const body = { automacoes: {}, textos: {}, lembrete_dias_antes: f.lembrete_dias_antes.value, chave_pix: f.chave_pix.value, numero_dona: f.numero_dona.value };
      for (const k of Object.keys(cfg.automacoes)) body.automacoes[k] = f[`auto_${k}`].checked;
      for (const k of Object.keys(cfg.textos)) body.textos[k] = f[`texto_${k}`].value;
      try { await api('/api/admin/whatsapp/config', { method: 'PUT', body }); toast('Configurações salvas.'); }
      catch (e) { toast(e.message); }
    });

    tela.replaceChildren(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } }, conexao, form,
      h('p', { class: 'small muted' }, 'A rotina de lembretes e cobranças roda sozinha uma vez por dia, entre 9h e 19h. ',
        'As mensagens saem com intervalo de alguns segundos entre elas, para proteger o número.')));
  }

  api('/api/admin/eu').then((u) => { document.getElementById('nome-usuaria').textContent = u.nome; }).catch(() => {});
  irPara(estado.aba);
})();
