
(function() {
    'use strict';

    // === CONFIGURAÇÃO DAS TAGS ===
    const TAG_INADIMPLENTE = "inadimplente";
    const TAG_INTERNO = "interno";

    // Agora usamos um Map para guardar o status exato de cada cliente (Nome -> Status)
    const statusClientes = new Map();

    function processarContatos(data) {
        let lista = Array.isArray(data) ? data : (data.data ? data.data : []);
        let encontrouNovo = false;

        lista.forEach(contato => {
            if (contato.tags && Array.isArray(contato.tags) && contato.tags.length > 0) {

                let temInadimplente = false;
                let temInterno = false;

                // Verifica quais tags o cliente possui
                contato.tags.forEach(tag => {
                    let nomeTag = "";
                    if (typeof tag === 'string') nomeTag = tag;
                    else if (tag.name) nomeTag = tag.name;
                    else if (tag.title) nomeTag = tag.title;
                    else if (tag.label) nomeTag = tag.label;

                    nomeTag = nomeTag.toLowerCase().trim();

                    if (nomeTag === TAG_INADIMPLENTE.toLowerCase()) temInadimplente = true;
                    if (nomeTag === TAG_INTERNO.toLowerCase()) temInterno = true;
                });

                // HIERARQUIA: Inadimplente > Interno
                let statusAtual = null;
                if (temInadimplente) {
                    statusAtual = 'inadimplente';
                } else if (temInterno) {
                    statusAtual = 'interno';
                }

                if (statusAtual) {
                    if (contato.name) {
                        statusClientes.set(contato.name.trim(), statusAtual);
                        encontrouNovo = true;
                    }
                    if (contato.internalName) {
                        statusClientes.set(contato.internalName.trim(), statusAtual);
                        encontrouNovo = true;
                    }
                }
            }
        });

        if (encontrouNovo) {
            destacarNaTela();
        }
    }

    // INTERCEPTAR FETCH
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const response = await originalFetch.apply(this, args);

        if (url.includes('/api/v1/contacts/list') || url.includes('/api/v1/contacts')) {
            response.clone().json().then(data => {
                processarContatos(data);
            }).catch(e => {});
        }
        return response;
    };

    // INTERCEPTAR XHR
    const originalXHR = window.XMLHttpRequest;
    function newXHR() {
        const xhr = new originalXHR();
        xhr.addEventListener('load', function() {
            if (xhr.responseURL && (xhr.responseURL.includes('/api/v1/contacts/list') || xhr.responseURL.includes('/api/v1/contacts'))) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    processarContatos(data);
                } catch(e) {}
            }
        });
        return xhr;
    }
    window.XMLHttpRequest = newXHR;

    // PINTAR A TELA (Atualizado para lidar com reciclagem de divs)
    function destacarNaTela() {
        if (statusClientes.size === 0) return;

        const cards = document.querySelectorAll('.chatContactDiv');

        cards.forEach(cardInteiro => {
            const nameSpan = cardInteiro.querySelector('.name-wrapper span') || cardInteiro.querySelector('span[title]');
            if (!nameSpan) return;

            const textoElemento = nameSpan.innerText ? nameSpan.innerText.trim() : "";
            const status = statusClientes.get(textoElemento); // Descobre qual a prioridade desse cliente

            if (status) {
                // Aplica os estilos apenas se o card ainda não estiver com esse status aplicado
                if (cardInteiro.dataset.statusScript !== status) {
                    cardInteiro.dataset.statusScript = status; // Marca o card com o status atual

                    if (status === 'inadimplente') {
                        cardInteiro.style.setProperty('background-color', '#ffe6e6', 'important'); // Vermelho claro
                        cardInteiro.style.setProperty('border-left', '5px solid #ff0000', 'important'); // Borda grossa vermelha
                        nameSpan.style.setProperty('color', '#ff0000', 'important');
                        nameSpan.style.setProperty('font-weight', 'bold', 'important');
                    } else if (status === 'interno') {
                        cardInteiro.style.setProperty('background-color', '#e6ffec', 'important'); // Verde claro
                        cardInteiro.style.setProperty('border-left', '5px solid #00b33c', 'important'); // Borda grossa verde
                        nameSpan.style.setProperty('color', '#00b33c', 'important');
                        nameSpan.style.setProperty('font-weight', 'bold', 'important');
                    }
                }
            } else {
                // RESET ANTI-BUG: Se o card foi reciclado para um cliente "normal", remove todas as cores do script
                if (cardInteiro.dataset.statusScript) {
                    cardInteiro.dataset.statusScript = "";
                    cardInteiro.style.removeProperty('background-color');
                    cardInteiro.style.removeProperty('border-left');
                    nameSpan.style.removeProperty('color');
                    nameSpan.style.removeProperty('font-weight');
                }
            }
        });
    }

    // INICIALIZAÇÃO
    const observer = new MutationObserver(() => destacarNaTela());
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(destacarNaTela, 2000);

})();