// ================= CONFIGURAÇÕES =================
const STORAGE_KEY = "juncao_cargas_registros";
const OPERADOR_KEY = "juncao_cargas_operador";
const LOG_KEY = "juncao_cargas_log";
const SESSAO_ATIVA_KEY = "juncao_sessao_ativa";
const LOG_DIAS_RETENCAO = 45; // dias de retenção do log

// Estado
let operador = "";
let brAtual = "";
let brTravado = false;
let leitor = null;
let leitorLigado = false;
let modoLeitura = ""; // "br" ou "caixa"
let telaAtual = "login"; // controla qual seção está visível (evita race condition de foco)

// Dados salvos no localStorage
let registros = [];

document.addEventListener("DOMContentLoaded", () => {
    carregarDados();
    limparLogAntigo();
    configurarListeners();
    atualizarStatusConexao();

    verificarSessaoPendente();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn("SW não registrado:", err);
        });
    }
});

// ================= LISTENERS GLOBAIS =================
function configurarListeners() {
    const inputCaixa = document.getElementById("input-caixa");

    if (inputCaixa) {
        inputCaixa.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                confirmarLeituraCaixa();
            }
        });

        // Correção: usa telaAtual em vez de checar classList no momento do blur
        inputCaixa.addEventListener("blur", () => {
            if (brTravado && telaAtual === "operacao") {
                setTimeout(() => {
                    if (telaAtual === "operacao") inputCaixa.focus();
                }, 150);
            }
        });
    }

    const brInput = document.getElementById("br-input");
    if (brInput) {
        brInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                travarBR();
            }
        });
    }

    window.addEventListener('online', atualizarStatusConexao);
    window.addEventListener('offline', atualizarStatusConexao);
}

function atualizarStatusConexao() {
    const el = document.getElementById('status-conexao');
    if (!el) return;

    if (navigator.onLine) {
        el.textContent = 'ONLINE';
        el.className = 'text-xs bg-[#50af47] text-white px-2 py-1 rounded font-bold';
    } else {
        el.textContent = 'OFFLINE';
        el.className = 'text-xs bg-gray-500 text-white px-2 py-1 rounded font-bold';
    }
}

// ================= NAVEGAÇÃO DE TELAS =================
function mostrarTela(nome) {
    const secoes = {
        login: "secao-login",
        sessaoPendente: "secao-sessao-pendente",
        operacao: "secao-operacao",
        relatorio: "secao-relatorio"
    };
    Object.values(secoes).forEach(id => document.getElementById(id)?.classList.add("hidden"));
    document.getElementById(secoes[nome])?.classList.remove("hidden");
    telaAtual = nome;
}

// ================= LOGIN =================
function entrar() {
    const input = document.getElementById("operador");
    const nome = input.value.trim().toUpperCase();

    if (!nome) {
        mostrarToast("Digite seu nome", "aviso");
        input.focus();
        return;
    }

    operador = nome;
    localStorage.setItem(OPERADOR_KEY, operador);

    mostrarTela("operacao");
    adicionarLog(`Operador ${operador} iniciou sessão`);

    document.getElementById("br-input")?.focus();
}

function sair() {
    adicionarLog(`Operador ${operador} saiu da aplicação`);
    localStorage.removeItem(OPERADOR_KEY);
    localStorage.removeItem(SESSAO_ATIVA_KEY);
    location.reload();
}

// ================= SESSÃO PENDENTE =================
function verificarSessaoPendente() {
    const operadorSalvo = localStorage.getItem(OPERADOR_KEY);

    if (registros.length > 0) {
        mostrarTela("sessaoPendente");
        document.getElementById("sessao-pendente-contagem").textContent = registros.length;
    } else if (operadorSalvo) {
        const campoOperador = document.getElementById("operador");
        if (campoOperador) campoOperador.value = operadorSalvo;
        mostrarTela("login");
    } else {
        mostrarTela("login");
    }
}

function continuarSessao() {
    // Confirma/pede o nome do operador mesmo ao continuar (evita atribuir a pessoa errada)
    const nomeInformado = prompt("Confirme seu nome para continuar a sessão:",
        localStorage.getItem(OPERADOR_KEY) || "");

    if (!nomeInformado || !nomeInformado.trim()) {
        mostrarToast("Nome é obrigatório para continuar", "aviso");
        return;
    }

    operador = nomeInformado.trim().toUpperCase();
    localStorage.setItem(OPERADOR_KEY, operador);

    // Restaura estado do BR travado, se houver
    const sessaoSalva = carregarSessaoAtiva();
    if (sessaoSalva && sessaoSalva.brTravado) {
        brAtual = sessaoSalva.brAtual;
        brTravado = true;
        document.getElementById("box-br").classList.add("hidden");
        document.getElementById("box-br-travado").classList.remove("hidden");
        document.getElementById("br-atual").textContent = brAtual;
        document.getElementById("box-leitura-caixa").classList.remove("hidden");
    }

    mostrarTela("operacao");

    adicionarLog(`Sessão anterior continuada por ${operador}. ${registros.length} registro(s) pendente(s)`);

    renderizarCaixas();

    if (brTravado) {
        setTimeout(() => document.getElementById("input-caixa")?.focus(), 200);
    } else {
        document.getElementById("br-input")?.focus();
    }
}

function iniciarNovaSessao() {
    if (!confirm("Tem certeza que deseja iniciar uma nova sessão? Os registros anteriores serão apagados.")) {
        return;
    }

    adicionarLog(`Nova sessão iniciada. ${registros.length} registro(s) anterior(es) removido(s)`);

    registros = [];
    salvarDados();
    limparSessaoAtiva();

    // Limpa também o campo de operador salvo, forçando digitação do nome do novo operador
    localStorage.removeItem(OPERADOR_KEY);
    const campoOperador = document.getElementById("operador");
    if (campoOperador) campoOperador.value = "";

    mostrarTela("login");
}

// ================= PERSISTÊNCIA DE SESSÃO ATIVA (BR travado) =================
function salvarSessaoAtiva() {
    try {
        localStorage.setItem(SESSAO_ATIVA_KEY, JSON.stringify({ brAtual, brTravado }));
    } catch (e) {
        console.error("Erro ao salvar sessão ativa:", e);
    }
}

function carregarSessaoAtiva() {
    try {
        const dados = localStorage.getItem(SESSAO_ATIVA_KEY);
        return dados ? JSON.parse(dados) : null;
    } catch (e) {
        console.error("Erro ao carregar sessão ativa:", e);
        return null;
    }
}

function limparSessaoAtiva() {
    localStorage.removeItem(SESSAO_ATIVA_KEY);
}

// ================= BR =================
function travarBR() {
    const input = document.getElementById("br-input");
    const valor = input.value.trim().toUpperCase();

    if (!valor) {
        mostrarToast("Informe o BR", "aviso");
        input.focus();
        return;
    }

    brAtual = valor;
    brTravado = true;
    salvarSessaoAtiva();

    adicionarLog(`BR ${brAtual} travado pelo operador ${operador}`);

    document.getElementById("box-br").classList.add("hidden");
    document.getElementById("box-br-travado").classList.remove("hidden");
    document.getElementById("br-atual").textContent = brAtual;

    document.getElementById("box-leitura-caixa").classList.remove("hidden");

    renderizarCaixas();

    setTimeout(() => document.getElementById("input-caixa")?.focus(), 200);
}

function trocarBR() {
    if (!confirm("Deseja trocar de BR? Os dados já salvos não serão perdidos.")) return;

    adicionarLog(`Troca de BR: ${brAtual} liberado pelo operador ${operador}`);

    pararLeitor();
    brTravado = false;
    brAtual = "";
    limparSessaoAtiva();

    document.getElementById("box-br").classList.remove("hidden");
    document.getElementById("box-br-travado").classList.add("hidden");
    document.getElementById("box-leitura-caixa").classList.add("hidden");
    document.getElementById("area-leitor").classList.add("hidden");
    document.getElementById("br-input").value = "";

    renderizarCaixas();
    document.getElementById("br-input")?.focus();
}

// ================= LEITORES POR CÂMERA =================
async function lerQRBR() {
    if (leitorLigado) {
        await pararLeitor();
        return;
    }

    if (!window.Html5Qrcode) {
        mostrarToast("Biblioteca de câmera não carregada", "erro");
        return;
    }

    modoLeitura = "br";
    document.getElementById("area-leitor").classList.remove("hidden");

    try {
        leitor = new Html5Qrcode("reader");
        leitorLigado = true;

        await leitor.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 150 } },
            (codigo) => {
                document.getElementById("br-input").value = codigo.trim().toUpperCase();
                pararLeitor();
                mostrarToast("BR lido com sucesso", "sucesso");
            },
            () => {}
        );
    } catch (err) {
        console.error(err);
        pararLeitor();
        mostrarToast("Erro ao acessar câmera: " + err.message, "erro");
    }
}

async function lerCodigoBarras() {
    if (leitorLigado) {
        await pararLeitor();
        return;
    }

    if (!brTravado) {
        mostrarToast("Trave o BR primeiro", "aviso");
        return;
    }

    if (!window.Html5Qrcode) {
        mostrarToast("Biblioteca de câmera não carregada", "erro");
        return;
    }

    modoLeitura = "caixa";
    document.getElementById("area-leitor").classList.remove("hidden");

    try {
        leitor = new Html5Qrcode("reader");
        leitorLigado = true;

        await leitor.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 100 } },
            (codigo) => {
                processarLeituraCaixa(codigo.trim());
                pararLeitor();
            },
            () => {}
        );
    } catch (err) {
        console.error(err);
        pararLeitor();
        mostrarToast("Erro ao acessar câmera: " + err.message, "erro");
    }
}

async function pararLeitor() {
    if (leitor && leitorLigado) {
        try {
            await leitor.stop();
        } catch (e) {
            console.warn("Erro ao parar leitor:", e);
        }
        leitor = null;
        leitorLigado = false;
    }
    document.getElementById("area-leitor")?.classList.add("hidden");
}

// ================= LEITURA MANUAL / LEITOR FÍSICO =================
function confirmarLeituraCaixa() {
    const input = document.getElementById("input-caixa");
    const codigo = input.value.trim().toUpperCase();

    if (!codigo) {
        mostrarToast("Digite ou leia o código da caixa", "aviso");
        input.focus();
        return;
    }

    processarLeituraCaixa(codigo);
    input.value = "";
    input.focus();
}

// ================= PROCESSAMENTO DA CAIXA =================
function processarLeituraCaixa(codigo) {
    if (!codigo) return;

    if (!brTravado) {
        mostrarToast("Trave o BR antes de ler caixas", "aviso");
        return;
    }

    const duplicado = registros.find(r => r.br === brAtual && r.caixa === codigo);
    if (duplicado) {
        mostrarToast(`Caixa ${codigo} já registrada neste BR`, "aviso");
        return;
    }

    const existenteOutroBR = registros.find(r => r.br !== brAtual && r.caixa === codigo);
    if (existenteOutroBR) {
        if (confirm(`Caixa ${codigo} já registrada no BR ${existenteOutroBR.br} em ${existenteOutroBR.data} ${existenteOutroBR.hora}.\n\nDeseja mover para o BR ${brAtual}?`)) {
            moverCaixaParaBR(existenteOutroBR.id, brAtual);
        }
        return;
    }

    const agora = new Date();
    const registro = {
        id: gerarId(),
        data: agora.toLocaleDateString("pt-BR"),
        hora: agora.toLocaleTimeString("pt-BR"),
        data_iso: agora.toISOString(),
        operador: operador,
        br: brAtual,
        caixa: codigo
    };

    registros.push(registro);
    salvarDados();
    renderizarCaixas();

    adicionarLog(`Caixa ${codigo} adicionada ao BR ${brAtual} pelo operador ${operador}`);

    if (navigator.vibrate) navigator.vibrate(150);
    mostrarToast(`Caixa ${codigo} adicionada`, "sucesso");
}

function moverCaixaParaBR(id, novoBR) {
    const idx = registros.findIndex(r => r.id === id);
    if (idx === -1) return;

    const agora = new Date();
    registros[idx].br = novoBR;
    registros[idx].operador = operador;
    registros[idx].data = agora.toLocaleDateString("pt-BR");
    registros[idx].hora = agora.toLocaleTimeString("pt-BR");
    registros[idx].data_iso = agora.toISOString();

    salvarDados();
    renderizarCaixas();
    mostrarToast(`Caixa movida para o BR ${novoBR}`, "sucesso");

    adicionarLog(`Caixa ${registros[idx].caixa} movida para o BR ${novoBR} pelo operador ${operador}`);
}

function gerarId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// Correção: usa textContent (sem innerHTML) para evitar qualquer injeção de HTML
function renderizarCaixas() {
    const lista = document.getElementById("lista-caixas");
    lista.innerHTML = "";

    const caixasBR = registros.filter(r => r.br === brAtual);

    caixasBR.slice().reverse().forEach(r => {
        const li = document.createElement("li");
        li.className = "caixa-item";

        const span = document.createElement("span");
        span.textContent = r.caixa;

        const btn = document.createElement("button");
        btn.className = "btn-excluir";
        btn.textContent = "REMOVER";
        btn.addEventListener("click", () => removerCaixa(r.id));

        li.appendChild(span);
        li.appendChild(btn);
        lista.appendChild(li);
    });

    document.getElementById("contador").textContent = caixasBR.length;
}

function removerCaixa(id) {
    if (!confirm("Remover este registro?")) return;

    const removido = registros.find(r => r.id === id);
    registros = registros.filter(r => r.id !== id);
    salvarDados();
    renderizarCaixas();
    mostrarToast("Registro removido", "sucesso");

    if (removido) {
        adicionarLog(`Caixa ${removido.caixa} removida do BR ${removido.br} pelo operador ${operador}`);
    }
}

// ================= PERSISTÊNCIA =================
function salvarDados() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(registros));
    } catch (e) {
        console.error("Erro ao salvar:", e);
        mostrarToast("Erro ao salvar dados (armazenamento cheio?)", "erro");
    }
}

function carregarDados() {
    try {
        const dados = localStorage.getItem(STORAGE_KEY);
        if (dados) {
            registros = JSON.parse(dados);
        }
    } catch (e) {
        console.error("Erro ao carregar:", e);
        registros = [];
    }
}

// ================= RELATÓRIO =================
function abrirRelatorio() {
    mostrarTela("relatorio");
    pararLeitor();

    const resumo = document.getElementById("resumo-relatorio");
    resumo.innerHTML = "";

    const agrupado = {};
    registros.forEach(r => {
        if (!agrupado[r.br]) agrupado[r.br] = { caixas: [], operador: r.operador };
        agrupado[r.br].caixas.push(r.caixa);
    });

    if (Object.keys(agrupado).length === 0) {
        resumo.innerHTML = "<p>Nenhum registro ainda.</p>";
        return;
    }

    let html = `<p><strong>Total de BRs:</strong> ${Object.keys(agrupado).length}</p>`;
    html += `<p><strong>Total de caixas:</strong> ${registros.length}</p>`;
    html += `<hr class="my-2 border-gray-300">`;

    for (const br in agrupado) {
        html += `
            <div class="mb-3">
                <p><strong>BR ${escaparHTML(br)}</strong> — ${agrupado[br].caixas.length} caixa(s)</p>
                <p class="text-gray-600 break-all text-xs">${agrupado[br].caixas.map(escaparHTML).join(", ")}</p>
            </div>
        `;
    }

    resumo.innerHTML = html;
}

// Pequena função de segurança para strings exibidas via innerHTML
function escaparHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function voltarOperacao() {
    mostrarTela("operacao");
    renderizarCaixas();

    if (brTravado) {
        setTimeout(() => document.getElementById("input-caixa")?.focus(), 200);
    }
}

// ================= EXPORTAÇÃO =================
function prepararDadosExportacao() {
    return registros.map(r => ({
        Data: r.data,
        Hora: r.hora,
        Operador: r.operador,
        BR: r.br,
        Caixa_Pedido: r.caixa
    }));
}

function baixarCSV() {
    if (registros.length === 0) {
        mostrarToast("Nenhum registro para exportar", "aviso");
        return;
    }

    const dados = prepararDadosExportacao();
    const csv = converterParaCSV(dados);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });

    if (typeof saveAs === "function") {
        saveAs(blob, `juncao_cargas_${dataAtualArquivo()}.csv`);
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `juncao_cargas_${dataAtualArquivo()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    adicionarLog(`Relatório CSV exportado por ${operador}. ${registros.length} registro(s)`);
    // ⚠️ Removida a limpeza automática pós-exportação, conforme solicitado.
    // A limpeza agora é feita SOMENTE pelo botão "LIMPAR HISTÓRICO".
}

// Correção: escapa ; e quebras de linha nos valores, evitando CSV quebrado
function converterParaCSV(dados) {
    if (dados.length === 0) return "";

    const escaparCampo = (valor) => {
        const str = String(valor ?? "");
        if (str.includes(";") || str.includes("\n") || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const cabecalho = Object.keys(dados[0]).map(escaparCampo).join(";");
    const linhas = dados.map(obj => Object.values(obj).map(escaparCampo).join(";"));
    return [cabecalho, ...linhas].join("\n");
}

function baixarExcel() {
    if (registros.length === 0) {
        mostrarToast("Nenhum registro para exportar", "aviso");
        return;
    }

    if (typeof XLSX === "undefined") {
        mostrarToast("Biblioteca Excel não carregada", "erro");
        return;
    }

    const dados = prepararDadosExportacao();
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Junções");
    XLSX.writeFile(wb, `juncao_cargas_${dataAtualArquivo()}.xlsx`);

    adicionarLog(`Relatório Excel exportado por ${operador}. ${registros.length} registro(s)`);
}

function dataAtualArquivo() {
    const agora = new Date();
    const dia = String(agora.getDate()).padStart(2, "0");
    const mes = String(agora.getMonth() + 1).padStart(2, "0");
    const ano = agora.getFullYear();
    return `${ano}${mes}${dia}`;
}

function compartilharWhatsApp() {
    if (registros.length === 0) {
        mostrarToast("Nenhum registro para compartilhar", "aviso");
        return;
    }

    const texto = gerarTextoRelatorio();
    const url = "https://wa.me/?text=" + encodeURIComponent(texto);
    window.open(url, "_blank");

    adicionarLog(`Relatório compartilhado via WhatsApp por ${operador}`);
}

function compartilharEmail() {
    if (registros.length === 0) {
        mostrarToast("Nenhum registro para compartilhar", "aviso");
        return;
    }

    const assunto = `Junção de Cargas - ${dataAtualArquivo()}`;
    const corpo = gerarTextoRelatorio();

    const a = document.createElement("a");
    a.href = `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();

    adicionarLog(`Relatório compartilhado via e-mail por ${operador}`);
}

function gerarTextoRelatorio() {
    const agrupado = {};
    registros.forEach(r => {
        if (!agrupado[r.br]) agrupado[r.br] = [];
        agrupado[r.br].push(r.caixa);
    });

    let texto = `*Junção de Cargas*\n`;
    texto += `Data: ${new Date().toLocaleDateString("pt-BR")}\n`;
    texto += `Operador: ${operador}\n\n`;

    for (const br in agrupado) {
        texto += `*BR: ${br}*\n`;
        texto += `Caixas: ${agrupado[br].length}\n`;
        texto += `${agrupado[br].join(", ")}\n\n`;
    }

    return texto;
}

// ================= UTILITÁRIOS =================
function mostrarToast(mensagem, tipo = "sucesso") {
    const toast = document.createElement("div");
    toast.className = `toast ${tipo}`;
    toast.textContent = mensagem;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function limparHistoricoManual() {
    if (registros.length === 0) {
        mostrarToast("Não há registros para limpar", "aviso");
        return;
    }

    if (confirm("Tem certeza que deseja apagar todos os registros? Esta ação não pode ser desfeita.")) {
        const qtd = registros.length;
        registros = [];
        salvarDados();
        limparSessaoAtiva();
        brAtual = "";
        brTravado = false;

        mostrarToast("Histórico limpo com sucesso", "sucesso");
        voltarOperacao();

        // Reseta a tela de operação para o estado inicial (BR não travado)
        document.getElementById("box-br")?.classList.remove("hidden");
        document.getElementById("box-br-travado")?.classList.add("hidden");
        document.getElementById("box-leitura-caixa")?.classList.add("hidden");

        adicionarLog(`Histórico limpo manualmente por ${operador}. ${qtd} registro(s) removido(s)`);
    }
}

// ================= LOG DE HISTÓRICO =================
function adicionarLog(mensagem) {
    const agora = new Date();
    const data = agora.toLocaleDateString("pt-BR");
    const hora = agora.toLocaleTimeString("pt-BR");
    const linha = `[${data} ${hora}] ${mensagem}`;

    let log = [];
    try {
        const dados = localStorage.getItem(LOG_KEY);
        if (dados) log = JSON.parse(dados);
    } catch (e) {
        console.error("Erro ao carregar log:", e);
        log = [];
    }

    log.push(linha);

    try {
        localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch (e) {
        console.error("Erro ao salvar log:", e);
    }
}

// Remove entradas de log com mais de LOG_DIAS_RETENCAO dias, evitando estourar localStorage
function limparLogAntigo() {
    try {
        const dados = localStorage.getItem(LOG_KEY);
        if (!dados) return;

        let log = JSON.parse(dados);
        const limite = new Date();
        limite.setDate(limite.getDate() - LOG_DIAS_RETENCAO);

        log = log.filter(linha => {
            const match = linha.match(/^\[(\d{2})\/(\d{2})\/(\d{4})/);
            if (!match) return true; // mantém se não conseguir parsear
            const [, dia, mes, ano] = match;
            const dataLinha = new Date(`${ano}-${mes}-${dia}`);
            return dataLinha >= limite;
        });

        localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch (e) {
        console.error("Erro ao limpar log antigo:", e);
    }
}

function baixarLogHoje() {
    const hoje = new Date().toLocaleDateString("pt-BR");
    let log = [];

    try {
        const dados = localStorage.getItem(LOG_KEY);
        if (dados) log = JSON.parse(dados);
    } catch (e) {
        console.error("Erro ao carregar log:", e);
        mostrarToast("Erro ao carregar log", "erro");
        return;
    }

    const logHoje = log.filter(linha => linha.includes(hoje));

    if (logHoje.length === 0) {
        mostrarToast("Nenhum log para hoje", "aviso");
        return;
    }

    const conteudo = logHoje.join("\n");
    const blob = new Blob([conteudo], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `log_juncao_cargas_${dataAtualArquivo()}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    adicionarLog(`Log do dia ${hoje} baixado por ${operador}`);
}
