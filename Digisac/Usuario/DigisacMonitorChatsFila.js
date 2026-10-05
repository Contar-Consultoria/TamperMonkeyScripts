(async function () {
    'use strict';
    console.log("[Digisac Unified] Iniciando módulos automaticamente (Monitor V8 + Tags)...");

    // Fura a bolha de segurança do Tampermonkey para a interceptação de rede funcionar
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ========================================================================
    // MÓDULO 1: MONITOR CHATS V8 (SLA, Fila, Aguardando)
    // ========================================================================
    async function iniciarModuloMonitor() {
        console.log("[Módulo] Monitor de Chats V8 inicializado.");

        const CHECAGEM_INICIAL_MS = 1000;
        const RETRY_DOM_NAO_PRONTO_MS = 2000;
        const INTERVALO_RECORRENTE_MS = 30000;
        const INTERVALO_FILA = 120000;
        const INTERVALO_RESPOSTA = 120000;
        const INTERVALO_INATIVIDADE = 300000;

        let ultimaFila = 0;
        let ultimaResposta = 0;
        let ultimaInatividade = 0;

        let notificadoFila = 0;
        let notificadoResposta = 0;
        let notificadoInatividade = 0;

        function deveAvisar(total, jaNotificado, ultimaVez, intervalo, agora) {
            if (total <= 0) return false;
            if (total > jaNotificado) return true;
            return agora - ultimaVez >= intervalo;
        }

        const MINUTOS_INATIVIDADE_MIN = 18;
        const MINUTOS_INATIVIDADE_MAX = 21;
        const MAX_NOMES_NOTIFICACAO = 4;
        const MAX_CARACTERES_NOME = 45;
        const TEXTO_LISTA_VAZIA = 'não existem chamados';

        const PADROES_CONVERSA_INATIVA = [
            'finalizando o seu atendimento por falta de interação',
            'pesquisa de satisfação',
            'como você classifica nosso atendimento',
            'agradecemos o seu contato e sua avaliação',
            'informe o *número* do departamento',
            'informe o número do departamento',
            'digite um número entre 1 e 5',
            'aguarde um instante, em breve um atendente entrará em contato',
            'digite *0* para retornar ao menu inicial'
        ];

        const ICONES_ENVIO = [
            'svg.lucide-check-check',
            'svg.lucide-check',
            'svg.lucide-clock',
            'svg.lucide-x'
        ].join(', ');

        function NotificacaoNativaBloqueada() {}
        NotificacaoNativaBloqueada.prototype.close = function () {};
        NotificacaoNativaBloqueada.permission = 'denied';
        NotificacaoNativaBloqueada.requestPermission = function (cb) {
            if (typeof cb === 'function') cb('denied');
            return Promise.resolve('denied');
        };

        try {
            if (typeof win !== 'undefined') {
                win.Notification = NotificacaoNativaBloqueada;
            }
        } catch (e) {
            console.error('[Digisac] Falha ao bloquear Notification nativa:', e);
        }

        function notificar(mensagem) {
            try {
                if (typeof GM_notification !== 'function') {
                    console.error('[Digisac] GM_notification indisponível.');
                    return;
                }
                GM_notification({
                    title: 'DIGISAC',
                    text: mensagem,
                    timeout: 10000,
                    silent: true,
                    onclick: function () {
                        try { win.focus(); } catch (e) { /* ignora */ }
                    }
                });
            } catch (e) {
                console.error('[Digisac] Falha ao notificar:', e);
            }
        }

        function formatarNomes(nomes) {
            try {
                const limpos = (nomes || [])
                    .filter(Boolean)
                    .map(n => n.length > MAX_CARACTERES_NOME ? n.slice(0, MAX_CARACTERES_NOME - 1) + '…' : n);
                if (!limpos.length) return '';
                if (limpos.length <= MAX_NOMES_NOTIFICACAO) return limpos.join('\n');
                const restantes = limpos.length - MAX_NOMES_NOTIFICACAO;
                return limpos.slice(0, MAX_NOMES_NOTIFICACAO).join('\n') + `\n… e mais ${restantes}`;
            } catch (e) {
                return '';
            }
        }

        function chipsNovos() {
            return {
                minhas: document.querySelector('[data-testid="queue-chip-mine"]'),
                fila: document.querySelector('[data-testid="queue-chip-queue"]'),
                todas: document.querySelector('[data-testid="queue-chip-all"]')
            };
        }

        function layoutNovo() {
            const c = chipsNovos();
            return !!(c.minhas || c.fila || c.todas);
        }

        function contagemDoChip(chip) {
            try {
                if (!chip) return null;
                const m = (chip.textContent || '').match(/(\d+)/);
                return m ? parseInt(m[1], 10) : 0;
            } catch (e) {
                return null;
            }
        }

        function abaAtiva() {
            try {
                if (layoutNovo()) {
                    const chips = chipsNovos();
                    const nomes = Object.keys(chips).filter(n => chips[n]);
                    const ativa = nomes.find(n =>
                        chips[n].getAttribute('data-state') === 'on' ||
                        chips[n].getAttribute('aria-checked') === 'true'
                    );
                    return ativa || null;
                }

                const abas = {
                    minhas: document.querySelector('[data-testid="chat-tab-mine"]'),
                    fila: document.querySelector('[data-testid="chat-tab-queue_calls"]'),
                    contatos: document.querySelector('[data-testid="chat-tab-start_conversation"]')
                };
                const nomes = Object.keys(abas).filter(n => abas[n]);
                if (!nomes.length) return null;

                const contagem = {};
                nomes.forEach(n => {
                    Array.from(abas[n].classList).forEach(c => { contagem[c] = (contagem[c] || 0) + 1; });
                });
                const unica = nomes.filter(n => Array.from(abas[n].classList).some(c => contagem[c] === 1));
                if (unica.length === 1) return unica[0];

                const porCor = nomes.filter(n => abas[n].querySelector('svg[stroke="#52658C"]'));
                return porCor.length === 1 ? porCor[0] : null;
            } catch (e) {
                return null;
            }
        }

        function meusAtendimentos() {
            try {
                if (layoutNovo()) return contagemDoChip(chipsNovos().minhas);
                const aba = document.querySelector('[data-testid="chat-tab-mine"]');
                if (!aba) return null;
                const badge = aba.querySelector('.badge.badge-primary.badge-pill') || aba.querySelector('.badge.badge-primary');
                if (!badge) return 0;
                const n = parseInt(badge.textContent.trim(), 10);
                return isNaN(n) ? 0 : n;
            } catch (e) {
                return null;
            }
        }

        function containerLista() {
            try {
                return document.querySelector('[data-testid^="contacts_list_view"]') || document.querySelector('.chat-contact-list') || null;
            } catch (e) { return null; }
        }

        function listaVazia(container) {
            try {
                if (!container) return false;
                return (container.textContent || '').toLowerCase().includes(TEXTO_LISTA_VAZIA);
            } catch (e) { return false; }
        }

        function cards(container) {
            try {
                if (!container) return [];
                return Array.from(container.querySelectorAll('[data-testid^="contact_internalName-"]'));
            } catch (e) { return []; }
        }

        function nomeContato(card) {
            try {
                const testid = card.getAttribute('data-testid') || '';
                const prefixo = 'contact_internalName-';
                if (testid.indexOf(prefixo) === 0) {
                    const nome = testid.slice(prefixo.length).trim();
                    if (nome) return nome;
                }
                const h5 = card.querySelector('h5');
                if (h5 && h5.textContent.trim()) return h5.textContent.trim();
                const span = card.querySelector('.name-wrapper span[title]');
                if (span) return (span.getAttribute('title') || '').trim() || null;
                return null;
            } catch (e) { return null; }
        }

        function textoUltimaMensagem(card) {
            try {
                const el = card.querySelector('[data-testid="last-message-text"]');
                if (el) {
                    const comTitle = el.closest('[title]') || el.querySelector('[title]');
                    if (comTitle) return (comTitle.getAttribute('title') || '').toLowerCase();
                    return (el.textContent || '').toLowerCase();
                }
                return '';
            } catch (e) { return ''; }
        }

        function ehConversaInativa(texto) {
            if (!texto) return false;
            return PADROES_CONVERSA_INATIVA.some(p => texto.includes(p));
        }

        function ultimaMensagemDoOperador(card) {
            try {
                if (card.querySelector(ICONES_ENVIO)) return true;
                const wrapper = card.querySelector('.last-message-wrapper');
                if (wrapper) return !!wrapper.querySelector('svg');
                return false;
            } catch (e) { return false; }
        }

        function dataUltimaMensagem(card) {
            try {
                const el = card.querySelector('[data-testid="last-message-at"]');
                if (!el) return null;

                const comTitle = el.querySelector('[title]') || (el.hasAttribute('title') ? el : null);
                if (comTitle) {
                    const t = comTitle.getAttribute('title') || '';
                    const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
                    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
                }

                const txt = (el.textContent || '').trim();
                const mh = txt.match(/^(\d{1,2}):(\d{2})$/);
                if (mh) {
                    const agora = new Date();
                    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), parseInt(mh[1], 10), parseInt(mh[2], 10), 0);
                    return d > agora ? null : d;
                }
                return null; 
            } catch (e) { return null; }
        }

        function dadosFila(aba, container) {
            let total = null;
            try {
                if (layoutNovo()) {
                    if (aba === 'fila' && container) {
                        total = listaVazia(container) ? 0 : cards(container).length;
                    } else {
                        total = contagemDoChip(chipsNovos().fila);
                    }
                } else {
                    const abaFila = document.querySelector('[data-testid="chat-tab-queue_calls"]') || document.querySelector('[data-testid*="queue-calls"]');
                    if (abaFila) {
                        const badge = abaFila.querySelector('.badge.badge-primary.badge-pill') || abaFila.querySelector('.badge.badge-primary') || abaFila.querySelector('.badge');
                        if (badge) {
                            const n = parseInt(badge.textContent.trim(), 10);
                            total = isNaN(n) ? 0 : n;
                        } else {
                            total = 0;
                        }
                    }
                }
            } catch (e) { }

            const nomes = [];
            try {
                if (total && aba === 'fila' && container && !listaVazia(container)) {
                    cards(container).forEach(c => {
                        const nome = nomeContato(c);
                        if (nome) nomes.push(nome);
                    });
                }
            } catch (e) { }

            return { total: total, nomes: nomes };
        }

        function dadosAguardando(aba, container) {
            try {
                if (!container) return { total: 0, nomes: [] };
                const meus = meusAtendimentos();
                if (!meus) return { total: 0, nomes: [] };
                if (aba === 'fila' || listaVazia(container)) return { total: 0, nomes: [] };

                const nomes = [];
                cards(container).forEach(c => {
                    if (ultimaMensagemDoOperador(c)) return;
                    const nome = nomeContato(c);
                    if (nome) nomes.push(nome);
                });

                const total = Math.min(nomes.length, meus);
                if (aba !== 'minhas') return { total: total, nomes: [] };
                return { total: total, nomes: nomes.slice(0, total) };
            } catch (e) { return { total: 0, nomes: [] }; }
        }

        function dadosInatividade(aba, container) {
            try {
                if (!container) return { total: 0, nomes: [] };
                const meus = meusAtendimentos();
                if (!meus) return { total: 0, nomes: [] };
                if (aba === 'fila' || listaVazia(container)) return { total: 0, nomes: [] };

                const agora = new Date();
                const nomes = [];

                cards(container).forEach(c => {
                    if (!ultimaMensagemDoOperador(c)) return;
                    if (ehConversaInativa(textoUltimaMensagem(c))) return;

                    const data = dataUltimaMensagem(c);
                    if (!data) return;

                    const min = (agora - data) / 60000;
                    if (min >= MINUTOS_INATIVIDADE_MIN && min <= MINUTOS_INATIVIDADE_MAX) {
                        const nome = nomeContato(c);
                        if (nome) nomes.push(nome);
                    }
                });

                const total = Math.min(nomes.length, meus);
                if (aba !== 'minhas') return { total: total, nomes: [] };
                return { total: total, nomes: nomes.slice(0, total) };
            } catch (e) { return { total: 0, nomes: [] }; }
        }

        function verificar() {
            try {
                const aba = abaAtiva();
                const container = containerLista();

                const fila = dadosFila(aba, container);
                const aguardando = dadosAguardando(aba, container);
                const inatividade = dadosInatividade(aba, container);

                console.log(`[Digisac] ${new Date().toLocaleTimeString()} | Aba: ${aba} | Meus: ${meusAtendimentos()} | Fila: ${fila.total} | Aguardando: ${aguardando.total} | Inatividade: ${inatividade.total}`);

                const agora = Date.now();

                if (deveAvisar(fila.total, notificadoFila, ultimaFila, INTERVALO_FILA, agora)) {
                    ultimaFila = agora;
                    let msg = `• ${fila.total} chamado(s) na fila`;
                    const lista = formatarNomes(fila.nomes);
                    if (lista) msg += `:\n${lista}`;
                    notificar(msg);
                }

                if (deveAvisar(aguardando.total, notificadoResposta, ultimaResposta, INTERVALO_RESPOSTA, agora)) {
                    ultimaResposta = agora;
                    let msg = `• ${aguardando.total} atendimento(s) aguardando sua resposta`;
                    const lista = formatarNomes(aguardando.nomes);
                    if (lista) msg += `:\n${lista}`;
                    notificar(msg);
                }

                if (deveAvisar(inatividade.total, notificadoInatividade, ultimaInatividade, INTERVALO_INATIVIDADE, agora)) {
                    ultimaInatividade = agora;
                    let msg = `Há ${inatividade.total} chat(s) com cliente ausente há mais de 18 minutos! Mande uma mensagem para não encerrar sozinho.`;
                    const lista = formatarNomes(inatividade.nomes);
                    if (lista) msg += `\n${lista}`;
                    notificar(msg);
                }

                notificadoFila = fila.total || 0;
                notificadoResposta = aguardando.total || 0;
                notificadoInatividade = inatividade.total || 0;
            } catch (e) {}
        }

        function tentarChecagemInicial() {
            try {
                const pronto = layoutNovo() || document.querySelector('[data-testid="chat-tab-mine"]');
                if (!pronto) {
                    setTimeout(tentarChecagemInicial, RETRY_DOM_NAO_PRONTO_MS);
                    return;
                }
                verificar();
                setInterval(verificar, INTERVALO_RECORRENTE_MS);
            } catch (e) {
                setTimeout(tentarChecagemInicial, RETRY_DOM_NAO_PRONTO_MS);
            }
        }

        setTimeout(tentarChecagemInicial, CHECAGEM_INICIAL_MS);
    }

    // ========================================================================
    // MÓDULO 2: TAGS (Com grampo na rede usando unsafeWindow)
    // ========================================================================
    async function iniciarModuloTags() {
        console.log("[Módulo] Tags (Inadimplentes e Interno) inicializado.");

        const css = `
            .card-script-inadimplente { background-color: #ffe6e6 !important; border-left: 5px solid #ff0000 !important; }
            .card-script-inadimplente span { color: #ff0000 !important; font-weight: bold !important; }
            .card-script-interno { background-color: #e6ffec !important; border-left: 5px solid #00b33c !important; }
            .card-script-interno span { color: #00b33c !important; font-weight: bold !important; }
        `;

        if (typeof GM_addStyle !== "undefined") {
            GM_addStyle(css);
        } else {
            const styleSheet = document.createElement("style");
            styleSheet.innerText = css;
            if(document.head) document.head.appendChild(styleSheet);
            else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(styleSheet));
        }

        const TAG_INADIMPLENTE = "inadimplente";
        const TAG_INTERNO = "interno";
        const statusClientes = new Map();

        function processarContatos(data) {
            let lista = Array.isArray(data) ? data : (data.data ? data.data : []);
            let atualizouTela = false;

            if(lista.length > 0) {
                console.log(`[Módulo Tags] Analisando pacote com ${lista.length} contatos da API...`);
            }

            lista.forEach(contato => {
                if (contato.tags && Array.isArray(contato.tags)) {
                    let temInadimplente = false;
                    let temInterno = false;

                    contato.tags.forEach(tag => {
                        let nomeTag = typeof tag === 'string' ? tag : (tag.name || tag.title || tag.label || "");
                        nomeTag = nomeTag.toLowerCase().trim();

                        if (nomeTag.includes(TAG_INADIMPLENTE) || nomeTag.includes("inadiplente")) temInadimplente = true;
                        if (nomeTag.includes(TAG_INTERNO)) temInterno = true;
                    });

                    let statusAtual = null;
                    if (temInadimplente) statusAtual = 'inadimplente';
                    else if (temInterno) statusAtual = 'interno';

                    if (statusAtual) {
                        if (contato.name) statusClientes.set(contato.name.trim(), statusAtual);
                        if (contato.internalName) statusClientes.set(contato.internalName.trim(), statusAtual);
                        atualizouTela = true;
                    }
                }
            });

            if (atualizouTela) destacarNaTela();
        }

        const originalFetch = win.fetch;
        win.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
            const response = await originalFetch.apply(this, args);
            if (url.includes('/api/v1/contacts/list') || url.includes('/api/v1/contacts')) {
                response.clone().json().then(processarContatos).catch(() => {});
            }
            return response;
        };

        if (win.XMLHttpRequest) {
            const XHR = win.XMLHttpRequest.prototype;
            const originalOpen = XHR.open;
            const originalSend = XHR.send;

            XHR.open = function(method, url) {
                this._requestUrl = url;
                return originalOpen.apply(this, arguments);
            };

            XHR.send = function() {
                this.addEventListener('load', function() {
                    if (this._requestUrl && (this._requestUrl.includes('/api/v1/contacts/list') || this._requestUrl.includes('/api/v1/contacts'))) {
                        try { processarContatos(JSON.parse(this.responseText)); } catch (e) { }
                    }
                });
                return originalSend.apply(this, arguments);
            };
        }

        function destacarNaTela() {
            if (statusClientes.size === 0) return;
            const cards = document.querySelectorAll('.chatContactDiv');

            cards.forEach(card => {
                let nomeDoCliente = "";
                const testId = card.getAttribute('data-testid');

                if (testId && testId.startsWith('contact_internalName-')) {
                    nomeDoCliente = testId.replace('contact_internalName-', '').trim();
                } else {
                    const spanName = card.querySelector('span[title]');
                    if (spanName) nomeDoCliente = (spanName.getAttribute('title') || spanName.innerText).trim();
                }

                if (!nomeDoCliente) return;

                const status = statusClientes.get(nomeDoCliente);

                if (status === 'inadimplente') {
                    if (!card.classList.contains('card-script-inadimplente')) {
                        card.classList.remove('card-script-interno');
                        card.classList.add('card-script-inadimplente');
                    }
                } else if (status === 'interno') {
                    if (!card.classList.contains('card-script-interno')) {
                        card.classList.remove('card-script-inadimplente');
                        card.classList.add('card-script-interno');
                    }
                } else {
                    card.classList.remove('card-script-inadimplente', 'card-script-interno');
                }
            });
        }

        setInterval(destacarNaTela, 2000);
        document.addEventListener('DOMContentLoaded', () => {
            const observer = new MutationObserver(() => destacarNaTela());
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    try {
        await Promise.all([ iniciarModuloTags(), iniciarModuloMonitor() ]);
        console.log("[Digisac Unified] Todos os módulos operantes!");
    } catch (erro) {
        console.error("[Digisac Unified] Falha crítica:", erro);
    }
})();
