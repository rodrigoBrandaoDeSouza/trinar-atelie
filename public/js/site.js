(function () {
  const { h, icone, api, moeda, formatarTel, linkWhats } = window.T;

  document.getElementById('ano').textContent = new Date().getFullYear();

  const ben = document.getElementById('beneficios');
  ben.append(
    h('span', {}, icone('pessoas', '#2F5D4E'), 'Turmas pequenas'),
    h('span', {}, icone('calendario', '#2F5D4E'), 'Mensalidade fixa'),
    h('span', {}, icone('check', '#2F5D4E'), 'Do zero ao avançado')
  );

  // Informações do ateliê
  api('/api/config').then((cfg) => {
    if (cfg.endereco) document.getElementById('cfg-endereco').textContent = cfg.endereco;
    if (cfg.horario) document.getElementById('cfg-horario').textContent = cfg.horario;
    if (cfg.whatsapp) {
      document.getElementById('cfg-whats').textContent = formatarTel(cfg.whatsapp);
      document.getElementById('btn-whats').href = linkWhats(cfg.whatsapp, 'Olá! Vim pelo site e queria saber mais sobre os cursos.');
    }
    const ig = document.getElementById('link-instagram');
    ig.href = `https://www.instagram.com/${encodeURIComponent(cfg.instagram)}`;
    ig.replaceChildren(icone('instagram', '#FFFFFF'), `@${cfg.instagram}`);
    if (cfg.mapa && /^https:\/\/(www\.)?google\.com\/maps\/embed/.test(cfg.mapa)) {
      const mapa = document.getElementById('mapa');
      mapa.replaceWith(h('iframe', { class: 'mapa', src: cfg.mapa, title: 'Mapa do ateliê', loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade' }));
    }
  }).catch(() => {});

  // Cursos
  const lista = document.getElementById('lista-cursos');
  api('/api/cursos').then((cursos) => {
    if (!cursos.length) {
      lista.replaceChildren(h('p', { class: 'muted' }, 'Novas turmas em breve. Fale com a gente pelo WhatsApp!'));
      return;
    }
    lista.replaceChildren(...cursos.map(cartaoCurso));
  }).catch(() => {
    lista.replaceChildren(h('p', { class: 'muted' }, 'Não foi possível carregar os cursos agora. Recarregue a página.'));
  });

  function cartaoCurso(c) {
    const livres = c.vagas_livres;
    const cheio = livres <= 0;
    const selo = cheio
      ? h('span', { class: 'pill pill-dark' }, 'Turma cheia')
      : livres <= 2
        ? h('span', { class: 'pill pill-strong' }, livres === 1 ? 'Última vaga' : `${livres} vagas`)
        : h('span', { class: 'pill pill-green' }, `${livres} vagas`);
    return h('article', { class: 'curso' },
      h('div', { class: 'curso-capa', style: { backgroundColor: c.cor } },
        h('span', { class: 'nivel' }, c.nivel || 'Todos os níveis'), selo),
      h('div', { class: 'curso-corpo' },
        h('h3', {}, c.nome),
        c.descricao ? h('p', { class: 'desc' }, c.descricao) : null,
        c.horario ? h('div', { class: 'curso-horario' }, icone('relogio', '#2F5D4E', 18), c.horario) : null,
        h('div', { class: 'curso-rodape' },
          h('div', {}, h('span', { class: 'rotulo' }, 'Mensalidade'), h('span', { class: 'preco' }, moeda(c.valor_mensal))),
          h('a', { class: cheio ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm', href: `/inscricao?curso=${c.id}` },
            cheio ? 'Lista de espera' : 'Inscrever-se'))));
  }
})();
