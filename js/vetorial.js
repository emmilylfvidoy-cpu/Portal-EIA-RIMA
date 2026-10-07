'use strict';
/* ============================================================================
 * vetorial.js — motor de recorte (clip) de polígonos, linhas e pontos
 *
 * É a peça central do portal: "recortar as áreas de influência com as camadas de
 * caracterização". Implementa o algoritmo de Greiner–Hormann (1998) para
 * interseção e diferença de polígonos simples, com as extensões necessárias:
 *
 *   - inserção das interseções nas DUAS listas circulares e ligação entre elas;
 *   - classificação dentro/fora de cada vértice em relação ao outro polígono;
 *   - travessia que troca de lista ao entrar/sair, produzindo o contorno resultado.
 *
 * Por que implementar em vez de usar o turf: o recorte do portal tem de funcionar
 * com polígonos côncavos (área de influência acompanhando rio, divisor de bacia,
 * faixa de servidão) — a decomposição em convexos do turf devolve fragmentos
 * desconexos nesses casos, e o número que vai para o EIA sai errado.
 *
 * O que o módulo NÃO faz: aritmética exata com coordenadas "grandes". Todo cálculo
 * é feito em graus com tolerância; para robustez numérica absoluta seria preciso
 * snap rounding, e isso está declarado como limitação na interface.
 * ========================================================================== */

(function (raiz, fabrica) {
  const paraNode = typeof module === 'object' && module.exports;
  const math = paraNode ? require('./math.js') : (raiz && raiz.EIA ? raiz.EIA.math : null);
  let turf = paraNode ? null : (raiz && raiz.turf ? raiz.turf : null);
  if (paraNode) {
    // No Node o mesmo bundle UMD do Turf usado no navegador é carregado do vendor.
    try { turf = require('../vendor/turf.min.js'); } catch (e) { turf = null; }
  }
  const api = fabrica(math, turf);
  if (paraNode) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.vetorial = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (math, turf) {
  const EPS = 1e-12;

  /**
   * CLIP DE POLÍGONOS: quem faz o trabalho pesado é o Turf (bundle `vendor/turf.min.js`,
   * já usado pelo portal e baseado na biblioteca polygon-clipping/Martinez).
   *
   * Por que delegar em vez de usar só o motor próprio que existe mais abaixo:
   * interseção/diferença de polígono côncavo é onde erro sutil vira número errado no
   * EIA. O motor próprio (travessia de face planar, mais abaixo) fica como RESERVA
   * e é exercitado pelos testes — inclusive comparado com o Turf caso a caso.
   *
   * Duas coisas que o Turf não faz e ficam por conta deste módulo:
   *   - coordenadas "grandes" (grau com 15 decimais) degradam a interseção de retas,
   *     então os anéis são deslocados por um índice negativo comum e deslocados de
   *     volta no fim;
   *   - o resultado vem como Polygon/MultiPolygon e precisa virar anéis com furo,
   *     no sentido certo para o GeoJSON.
   */
  const usarTurf = !!(turf && typeof turf.intersect === 'function' && typeof turf.difference === 'function');


  // ------------------------------------------------------------ predicados
  function orientacao(a, b, c) {
    const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(v) < EPS) return 0;
    return v > 0 ? 1 : -1;
  }

  function emSegmento(p, a, b, tol) {
    const t = tol === undefined ? 1e-14 : tol;
    if (orientacao(a, b, p) !== 0) return false;
    return p[0] >= Math.min(a[0], b[0]) - t && p[0] <= Math.max(a[0], b[0]) + t
      && p[1] >= Math.min(a[1], b[1]) - t && p[1] <= Math.max(a[1], b[1]) + t;
  }

  /**
   * Ponto dentro do anel (ray casting, regra par-ímpar).
   *
   * Trata explicitamente o caso do ponto SOBRE a borda: ali o ray casting devolve
   * resultado indefinido e a classificação de entrada/saída de um cruzamento
   * (que fica exatamente na borda do outro anel) sai errada. Quando o ponto está
   * na borda, o teste é repetido com o ponto deslocado em três direções e vale a
   * maioria — o suficiente para decidir de que lado ele cai.
   */
  function pontoNoAnel(p, anel) {
    const r = math.abrirAnel(anel);
    if (!naBorda(p, r)) return dentroSimples(p, r);
    let votos = 0;
    for (const d of [[1e-9, 0], [-1e-9, 0], [0, 1e-9], [0, -1e-9]]) {
      if (dentroSimples([p[0] + d[0], p[1] + d[1]], r)) votos++;
    }
    return votos >= 2;
  }

  function naBorda(p, r) {
    for (let i = 0; i < r.length; i++) {
      if (emSegmento(p, r[i], r[(i + 1) % r.length], 1e-12)) return true;
    }
    return false;
  }

  /** Ray casting puro, com a aresta tratada como intervalo semiaberto em y. */
  function dentroSimples(p, r) {
    let dentro = false;
    const n = r.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = r[i][1], yj = r[j][1];
      // (yi > y) !== (yj > y) já exclui os casos de toque no vértice
      if (((yi > p[1]) !== (yj > p[1]))
        && (p[0] < (r[j][0] - r[i][0]) * (p[1] - yi) / (yj - yi) + r[i][0])) dentro = !dentro;
    }
    return dentro;
  }

  /** Ponto em algum anel do polígono (externo ou furo). */
  function pontoNoPoligono(p, aneis) {
    for (let i = 0; i < aneis.length; i++) if (pontoNoAnel(p, aneis[i])) return true;
    return false;
  }

  function bboxDeAnel(anel) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < anel.length; i++) {
      const p = anel[i];
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  }

  function bboxDeAneis(aneis) {
    let b = null;
    for (let i = 0; i < aneis.length; i++) {
      const bi = bboxDeAnel(aneis[i]);
      b = b ? [
        Math.min(b[0], bi[0]), Math.min(b[1], bi[1]),
        Math.max(b[2], bi[2]), Math.max(b[3], bi[3]),
      ] : bi;
    }
    return b;
  }

  // ------------------------------------------------------------ interseção de segmentos
  /**
   * Interseção de dois segmentos.
   * @returns {null | {ponto:[x,y], t:number, u:number}} t no primeiro, u no segundo.
   * Colineares que se sobrepõem devolvem null (o gerador de cruzamentos cuida disso
   * inserindo os extremos contidos no outro segmento).
   */
  function intersecaoSegmentos(a1, a2, b1, b2) {
    const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
    const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
    const den = d1x * d2y - d1y * d2x;
    const ex = b1[0] - a1[0], ey = b1[1] - a1[1];
    if (Math.abs(den) < EPS) return null; // paralelos ou colineares
    const t = (ex * d2y - ey * d2x) / den;
    const u = (ex * d1y - ey * d1x) / den;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
    const tc = Math.min(1, Math.max(0, t));
    const uc = Math.min(1, Math.max(0, u));
    return { ponto: [a1[0] + tc * d1x, a1[1] + tc * d1y], t: tc, u: uc };
  }

  // ------------------------------------------------------------ estrutura do clip
  class No {
    constructor(ponto, anel, aresta) {
      this.ponto = ponto;
      this.x = ponto[0];
      this.y = ponto[1];
      this.anel = anel;     // índice do anel de origem
      this.aresta = aresta; // índice da aresta (vértice inicial) que começa aqui
      this.entrada = false; // interseção: entra no outro polígono
      this.saida = false;   // interseção: sai do outro polígono
      this.vizinho = null;  // nó correspondente na outra lista
      this.prox = null;
      this.ant = null;
      this.visitado = false;
    }
  }

  function listaDeAnel(anel, indiceAnel) {
    const r = math.abrirAnel(anel);
    const nos = [];
    for (let i = 0; i < r.length; i++) nos.push(new No(r[i], indiceAnel, i));
    // Remove vértices repetidos consecutivos (dado bruto traz muitos)
    const limpos = [];
    for (let i = 0; i < nos.length; i++) {
      const atual = nos[i];
      const anterior = limpos[limpos.length - 1];
      if (anterior && Math.abs(anterior.x - atual.x) < 1e-14 && Math.abs(anterior.y - atual.y) < 1e-14) continue;
      limpos.push(atual);
    }
    if (limpos.length > 1) {
      const p = limpos[0], u = limpos[limpos.length - 1];
      if (Math.abs(p.x - u.x) < 1e-14 && Math.abs(p.y - u.y) < 1e-14) limpos.pop();
    }
    for (let i = 0; i < limpos.length; i++) {
      limpos[i].prox = limpos[(i + 1) % limpos.length];
      limpos[i].ant = limpos[(i - 1 + limpos.length) % limpos.length];
      limpos[i].aresta = i;
    }
    return limpos;
  }

  /**
   * Anel de trabalho: guarda os nós E o primeiro nó.
   *
   * Existe porque confundir "array de nós" com "nó inicial" foi a origem de três
   * defeitos seguidos na primeira versão deste módulo — `iterar()` recebia o array,
   * percorria os índices e devolvia `undefined`. Com um tipo explícito, esse engano
   * deixa de compilar silenciosamente.
   */
  class Anel {
    constructor(nos) {
      this.nos = nos;
      this.primeiro = nos && nos.length >= 3 ? nos[0] : null;
      this.vazio = !this.primeiro;
    }
    /**
     * Pontos do anel, na ordem da travessia.
     * Percorre a lista encadeada — NÃO o array `nos`, que é o snapshot da
     * construção e não enxerga os nós de cruzamento inseridos depois.
     */
    pontos() {
      const saida = [];
      for (const no of iterar(this.primeiro)) saida.push([no.x, no.y]);
      return saida;
    }
    copiar() {
      return criarAnel(this.pontos());
    }
  }

  function criarAnel(pontos) {
    const nos = listaDeAnel(pontos, 0);
    return new Anel(nos);
  }

  /**
   * Insere um nó novo entre `a` e `a.prox`, com o parâmetro t na aresta.
   */
  function inserirEntre(a, ponto, arestaOrigem) {
    const novo = new No(ponto, a.anel, arestaOrigem);
    novo.prox = a.prox;
    novo.ant = a;
    if (a.prox) a.prox.ant = novo;
    a.prox = novo;
    return novo;
  }

  /**
   * Insere o ponto p na aresta de número `aresta`.
   *
   * Detalhe que custou uma falha: `listaDeAnel` devolve o ARRAY de nós, e depois
   * de inserir o índice do array deixa de corresponder ao número da aresta — o nó
   * inicial de uma aresta precisa ser procurado pelo número, não por posição.
   * E como os cruzamentos chegam em ordem arbitrária, é preciso achar QUAL
   * sub-aresta contém p, não assumir que é a que começa no vértice original.
   */
  function inserirNaAresta(anel, aresta, p) {
    let inicio = null;
    for (const no of iterar(anel.primeiro)) {
      if (no.aresta === aresta && (!no.ant || no.ant.aresta !== aresta)) { inicio = no; break; }
    }
    if (!inicio) return null;
    let a = inicio;
    let guarda = 0;
    do {
      if (mesmoPonto(a.ponto, p)) return null;
      if (a.prox && emSegmento(p, a.ponto, a.prox.ponto, 1e-12)) return inserirEntre(a, p, aresta);
      a = a.prox;
    } while (a && a !== inicio && ++guarda < 1e6);
    return null;
  }

  function mesmoPonto(a, b) {
    return Math.abs(a[0] - b[0]) < 1e-13 && Math.abs(a[1] - b[1]) < 1e-13;
  }

  /**
   * Acha os cruzamentos entre duas listas, insere os nós nas duas e liga os pares.
   *
   * Duas fases de propósito: a COLETA percorre as listas (sem modificar nada) e a
   * INSERÇÃO altera as duas listas depois. Fazer as duas coisas no mesmo laço
   * aninhado corrompe a travessia — foi exatamente o defeito da primeira versão.
   *
   * Trata também o caso de um vértice de uma lista cair exatamente sobre uma aresta
   * da outra (toque em "T"), comum quando as duas camadas vieram do mesmo SIG:
   * nesse caso o ponto é inserido só na lista que ainda não o tem.
   */
  function cruzar(anelA, anelB) {
    const pontos = [];
    const vistos = new Set();
    const chave = (p) => p[0].toFixed(12) + '|' + p[1].toFixed(12);

    function registrar(p) {
      const k = chave(p);
      if (vistos.has(k)) return;
      vistos.add(k);
      pontos.push([p[0], p[1]]);
    }

    const nosA = Array.from(iterar(anelA.primeiro));
    const nosB = Array.from(iterar(anelB.primeiro));

    // 1) vértices de A sobre arestas de B e vice-versa (toque em T)
    for (const noA of nosA) {
      for (const noB of nosB) {
        if (emSegmento(noA.ponto, noB.ponto, noB.prox.ponto, 1e-14)
          && !mesmoPonto(noA.ponto, noB.ponto) && !mesmoPonto(noA.ponto, noB.prox.ponto)) {
          registrar(noA.ponto);
        }
        if (emSegmento(noB.ponto, noA.ponto, noA.prox.ponto, 1e-14)
          && !mesmoPonto(noB.ponto, noA.ponto) && !mesmoPonto(noB.ponto, noA.prox.ponto)) {
          registrar(noB.ponto);
        }
      }
    }

    // 2) cruzamentos próprios
    for (const noA of nosA) {
      const a1 = noA.ponto, a2 = noA.prox.ponto;
      for (const noB of nosB) {
        const b1 = noB.ponto, b2 = noB.prox.ponto;
        const it = intersecaoSegmentos(a1, a2, b1, b2);
        if (!it) continue;
        if (mesmoPonto(it.ponto, a1) || mesmoPonto(it.ponto, a2)) continue; // já é vértice
        registrar(it.ponto);
      }
    }

    // 3) inserção nas duas listas, agora sem percorrer nada que esteja mudando
    let ligados = 0;
    for (const p of pontos) {
      const na = inserirEmLista(anelA, p);
      const nb = inserirEmLista(anelB, p);
      if (na && nb) {
        na.vizinho = nb;
        nb.vizinho = na;
        ligados++;
      }
    }
    return ligados;
  }

  /** Insere o ponto p no anel, achando a aresta que o contém. Devolve o nó criado. */
  function inserirEmLista(anel, p) {
    for (const no of iterar(anel.primeiro)) {
      if (mesmoPonto(no.ponto, p)) return null; // já existe um vértice aqui
    }
    for (const no of iterar(anel.primeiro)) {
      if (no.prox && emSegmento(p, no.ponto, no.prox.ponto, 1e-12)) {
        return inserirNaAresta(anel, no.aresta, p);
      }
    }
    return null;
  }

  function* iterar(inicio) {
    if (!inicio) return;
    let no = inicio;
    do { yield no; no = no.prox; } while (no && no !== inicio);
  }

  // ------------------------------------------------------------ travessia
  /** Remove vértices colineares e duplicados de um anel resultado. */
  function limparAnel(anel, tol) {
    const t = tol === undefined ? 1e-12 : tol;
    const r = math.abrirAnel(anel);
    const saida = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const ultimo = saida[saida.length - 1];
      if (ultimo && Math.abs(ultimo[0] - p[0]) < t && Math.abs(ultimo[1] - p[1]) < t) continue;
      saida.push([p[0], p[1]]);
    }
    let mudou = true;
    let atual = saida;
    while (mudou && atual.length > 3) {
      mudou = false;
      const seguinte = [];
      for (let i = 0; i < atual.length; i++) {
        const a = atual[(i - 1 + atual.length) % atual.length];
        const b = atual[i];
        const c = atual[(i + 1) % atual.length];
        if (orientacao(a, b, c) === 0) { mudou = true; continue; }
        seguinte.push(b);
      }
      if (seguinte.length >= 3) atual = seguinte; else break;
    }
    if (atual.length >= 3) {
      const p = atual[0], u = atual[atual.length - 1];
      if (p[0] !== u[0] || p[1] !== u[1]) atual.push([p[0], p[1]]);
      return atual;
    }
    return null;
  }

  // ------------------------------------------------------------ travessia
  /* COMO O RECORTE É MONTADO
   *
   * Em vez de percorrer as listas trocando de lado a cada cruzamento (Greiner–
   * Hormann clássico), o resultado é montado como uma travessia de face de um
   * grafo planar. O motivo é concreto: a troca de lado acerta a fronteira externa
   * mas não fecha os FUROS, e furo é resultado legítimo aqui — recortar uma feição
   * que está inteiramente dentro da área de influência por uma zona de exclusão
   * produz um anel com buraco.
   *
   * Passos:
   *   1. normaliza os dois anéis para sentido anti-horário;
   *   2. acha as interseções e insere os nós nos dois anéis;
   *   3. guarda como ARESTA DIRIGIDA os trechos que ficam do lado pedido
   *      (dentro do outro anel na interseção; fora, na diferença);
   *   4. encadeia as arestas: em cada nó sai pela aresta de MENOR VIRADA À
   *      ESQUERDA. Essa regra percorre a face da esquerda, o que produz o anel
   *      externo em sentido anti-horário e os furos em sentido horário — que é
   *      exatamente a convenção do GeoJSON e do shapefile.
   */

  /** Normaliza o anel para anti-horário (interior à esquerda). */
  function paraAntiHorario(pontos) {
    const r = math.abrirAnel(pontos);
    return math.areaAnelAssinada(r) >= 0 ? r : r.slice().reverse();
  }

  function chavePonto(p) {
    return p[0].toFixed(12) + '|' + p[1].toFixed(12);
  }

  /** Ponto ligeiramente à esquerda de um deslocamento (para testar de que lado cai). */
  function pontoAoLado(p, q, eps) {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const m = Math.hypot(dx, dy) || 1;
    const e = (eps === undefined ? 1e-9 : eps) / m;
    return [p[0] - dy * e, p[1] + dx * e];
  }

  /**
   * Minha aresta (entre no.prox e o próximo nó) cai do lado pedido do outro anel?
   * O teste é feito no MEIO da aresta, não nos extremos: o extremo pode estar
   * exatamente sobre a borda do outro anel (toque em T) e aí o resultado do
   * ray casting é indefinido.
   */
  function ladoDaAresta(no, aneisOutro, querDentro) {
    if (!no.prox) return false;
    const p = no.ponto, q = no.prox.ponto;
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const dentro = pontoNoPoligono(m, aneisOutro)
      || pontoNoPoligono(pontoAoLado(p, q, 1e-9), aneisOutro);
    return querDentro ? dentro : !dentro;
  }

  /**
   * Coleta as arestas dirigidas dos dois anéis e devolve a lista de adjacência.
   *
   * CONDIÇÕES (cada aresta é testada pelo MEIO do trecho, nunca pelos extremos: o
   * extremo pode estar exatamente sobre a borda do outro anel):
   *
   *   sujeito A:  interseção -> meio dentro de B
   *               diferença  -> meio fora de B
   *   recorte B:  meio dentro de A, e
   *               interseção -> sentido original de B
   *               diferença  -> meio FORA de B e sentido INVERTIDO
   *
   * A inversão do recorte na diferença não é capricho: com o trecho de B invertido,
   * a região que sobra fica sempre à esquerda da aresta — que é o que faz a regra da
   * menor virada à esquerda valer nos DOIS casos. Foi a peça que faltava para a
   * diferença parar de voltar vazia.
   */
  function arestasInternas(anelA, anelB, querDentro, oDepurar) {
    const arestas = [];
    const saida = new Map();
    const pontosA = anelA.pontos();
    const pontosB = anelB.pontos();

    function noOuCria(p) {
      const k = chavePonto(p);
      let n = saida.get(k);
      if (!n) { n = { ponto: [p[0], p[1]], saidas: [] }; saida.set(k, n); }
      return n;
    }

    function meioDe(p, q) {
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    }

    function adicionar(de, para, origem) {
      if (mesmoPonto(de, para)) return;
      const a = noOuCria(de), b = noOuCria(para);
      const dir = [para[0] - de[0], para[1] - de[1]];
      const chave = chavePonto(de) + '>' + chavePonto(para);
      if (arestas.some((e) => e.chave === chave)) return; // trecho repetido
      const aresta = { de: a, para: b, dir: dir, chave: chave, usada: false, origem: origem };
      arestas.push(aresta);
      a.saidas.push({ aresta: aresta, dir: dir });
    }

    // sujeito
    for (const no of iterar(anelA.primeiro)) {
      const p = no.ponto, q = no.prox.ponto;
      const dentro = pontoNoPoligono(meioDe(p, q), [pontosB]);
      if (oDepurar) console.log('   [arestas] A', p, '->', q, '| dentro de B =', dentro);
      if (querDentro ? !dentro : dentro) continue;
      adicionar(p, q, 'A');
    }

    // recorte
    for (const no of iterar(anelB.primeiro)) {
      const p = no.ponto, q = no.prox.ponto;
      const dentroA = pontoNoPoligono(meioDe(p, q), [pontosA]);
      const dentroB = pontoNoPoligono(meioDe(p, q), [pontosB]);
      if (oDepurar) console.log('   [arestas] B', p, '->', q, '| dentro de A =', dentroA, '| dentro de B =', dentroB);
      if (!dentroA) continue;                     // fora do sujeito: não faz parte
      if (querDentro) {
        adicionar(p, q, 'B');                     // interseção: sentido original
      } else if (!dentroB) {
        adicionar(q, p, 'B invertido');           // diferença: sentido invertido
      }
    }
    return arestas;
  }

  /** Ângulo de u para v no intervalo (-π, π]. */
  function anguloEntre(u, v) {
    const cru = u[0] * v[1] - u[1] * v[0];
    const dot = u[0] * v[0] + u[1] * v[1];
    return Math.atan2(cru, dot);
  }

  /**
   * Encadeia as arestas pela regra da menor virada à esquerda.
   * Devolve os anéis (arrays de pontos, fechados).
   */
  function encadearArestas(arestas, opcoes) {
    const o = opcoes || {};
    const maxPassos = o.maxPassos || 8e6;
    const aneis = [];
    let passos = 0;

    // Ordena por comprimento: começar pelas arestas curtas tende a fechar o anel
    // de fora antes das internas, o que deixa as internas como furos.
    const ordenadas = arestas.slice().sort((a, b) => {
      const la = Math.abs(a.dir[0]) + Math.abs(a.dir[1]);
      const lb = Math.abs(b.dir[0]) + Math.abs(b.dir[1]);
      return la - lb;
    });

    for (const inicial of ordenadas) {
      if (inicial.usada) continue;

      const trilha = [];
      let aresta = inicial;
      let fechou = false;
      let guarda = 0;

      for (;;) {
        if (++passos > maxPassos) throw new Error('Recorte não convergiu (geometria degenerada).');
        if (++guarda > ordenadas.length + 4) break; // anel aberto: descarta

        aresta.usada = true;
        trilha.push(aresta);

        const proxima = escolherProxima(aresta);
        if (o.depurar) console.log('   [cadeia]', aresta.de.ponto, '->', aresta.para.ponto, '| proxima =', proxima ? proxima.para.ponto : 'nenhuma');
        if (!proxima) break;
        // Fecha quando a próxima aresta SAI DO NÓ INICIAL: nesse ponto a caminhada
        // já percorreu o anel inteiro e voltou (com 4 arestas num quadrado a última
        // escolhida é a primeira do anel, não a aresta semente).
        if (proxima.de === inicial.de) { fechou = true; break; }
        aresta = proxima;
      }

      if (fechou && trilha.length >= 3) {
        aneis.push(trilha.map((a) => [a.de.ponto[0], a.de.ponto[1]]));
      } else {
        // Beco sem saída: devolve as arestas para outra semente poder usá-las.
        for (const a of trilha) a.usada = false;
        inicial.descartada = true;
      }
      if (o.depurar) console.log('   [cadeia] semente', inicial.de.ponto, 'fechou =', fechou, 'trilha =', trilha.length);
    }
    return aneis;

    /**
     * Menor virada à esquerda entre as arestas que ainda saem do nó de destino.
     * Virar sempre à esquerda percorre a face da esquerda — é o que produz o anel
     * externo em sentido anti-horário e os furos em sentido horário.
     */
    function escolherProxima(aresta) {
      const candidatas = aresta.para.saidas.filter((s) => !s.aresta.usada);
      if (!candidatas.length) return null;
      let melhor = null, melhorAngulo = Infinity;
      for (const c of candidatas) {
        let ang = anguloEntre(aresta.dir, c.dir);
        if (ang <= 1e-12) ang += 2 * Math.PI; // prefere virar; nunca segue reto de volta
        if (ang < melhorAngulo) { melhorAngulo = ang; melhor = c.aresta; }
      }
      return melhor;
    }
  }

  /**
   * Unifica os nós que representam o MESMO ponto do plano em um único objeto.
   *
   * Sem isso a travessia não fecha: o cruzamento visto pelo anel A e o mesmo
   * cruzamento visto pelo anel B são objetos diferentes, e a aresta que chega por
   * um não encontraria a aresta que sai pelo outro. É o que faz o grafo ser planar
   * de verdade.
   *
   * A primeira versão disto remendava os ponteiros das duas listas circulares e
   * entrava em laço infinito quando um anel tinha um único nó (o `prox` ficava
   * apontando para si mesmo e `iterar` nunca voltava ao início). Aqui a unificação
   * é declarativa: monta um mapa canônico ponto -> nó e RECONSTRÓI os dois anéis.
   */
  function unificarNos(anelA, anelB) {
    const pontosA = anelA.pontos();
    const pontosB = anelB.pontos();
    const canonico = new Map();
    const pegar = (p) => {
      const k = chavePonto(p);
      if (!canonico.has(k)) canonico.set(k, p);
      return canonico.get(k);
    };
    const A = criarAnel(pontosA.map(pegar));
    const B = criarAnel(pontosB.map(pegar));
    anelA.nos = A.nos; anelA.primeiro = A.primeiro; anelA.vazio = A.vazio;
    anelB.nos = B.nos; anelB.primeiro = B.primeiro; anelB.vazio = B.vazio;
  }

  /**
   * Clip de um anel por um anel.
   *
   * @param {boolean} querDentro true = interseção, false = diferença (sujeito - recorte)
   * @param {boolean} [semTurf] força o motor próprio (usado nos testes de comparação)
   */
  function clipUm(anelSujeito, anelRecorte, querDentro, opcoes, semTurf) {
    const o = opcoes || {};
    const s = abrirSeAberto(anelSujeito);
    const r = abrirSeAberto(anelRecorte);
    if (s.length < 3 || r.length < 3) return [];

    const bbA = bboxDeAnel(s);
    const bbB = bboxDeAnel(r);
    if (bbA[2] < bbB[0] || bbA[0] > bbB[2] || bbA[3] < bbB[1] || bbA[1] > bbB[3]) {
      return querDentro ? [] : [fechar(s)]; // retângulos sem sobreposição: não precisa de motor
    }

    // Caminho principal: Turf resolve inclusive contenção e furo, e é a biblioteca
    // que o portal já publica. O motor próprio só entra se o Turf faltar ou recusar
    // a geometria (auto-interseção, anel degenerado).
    if (usarTurf && !semTurf && !o.semTurfTotal) {
      try {
        const porTurf = clipComTurf(paraAntiHorario(s), paraAntiHorario(r), querDentro);
        // Caso normal: o Turf respondeu algo.
        if (porTurf && porTurf.length) return porTurf;
        // Vazio pode ser resposta legítima OU sintoma do caso conhecido em que
        // polígonos que só se encostam fazem a biblioteca devolver o sujeito
        // inteiro (que a peneira descarta). O motor próprio decide qual é.
        const proprio = clipProprio(criarAnel(paraAntiHorario(s)), criarAnel(paraAntiHorario(r)), querDentro, o);
        if (proprio.length) return proprio;
        return [];
      } catch (e) { /* cai no motor próprio */ }
    }
    return clipProprio(criarAnel(paraAntiHorario(s)), criarAnel(paraAntiHorario(r)), querDentro, o);
  }

  function bboxContem(a, b) {
    return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
  }

  function abrirSeAberto(anel) { return math.abrirAnel(anel); }
  function fechar(pontos) { return math.fecharAnel(pontos); }

  /** Nosso motor (travessia de face planar) — reserva e comparação nos testes. */
  function clipProprio(A, B, querDentro, opcoes) {
    if (A.vazio || B.vazio) return [];
    const ligados = cruzar(A, B);
    if (!ligados) {
      // Sem cruzamento próprio. A contenção é decidida com TODOS os vértices (e o
      // meio das arestas), nunca com um único ponto de amostra: dois "L" que apenas
      // se encostam têm o vértice (0,0) fora do outro e o teste de um ponto só
      // dizia "dentro", devolvendo o polígono inteiro.
      const pontosA = A.pontos(), pontosB = B.pontos();
      const aDentroDeB = poligonoDentro(pontosA, pontosB);
      const bDentroDeA = poligonoDentro(pontosB, pontosA);
      if (querDentro) {
        if (aDentroDeB) return [fechar(pontosA)];
        if (bDentroDeA) return [fechar(pontosB)];
        return [];
      }
      if (aDentroDeB) return [];
      if (bDentroDeA) return [];
      return [fechar(pontosA)];
    }
    unificarNos(A, B);
    const arestas = arestasInternas(A, B, querDentro);
    if (!arestas.length) return [];
    const brutos = encadearArestas(arestas, opcoes);
    return brutos.map((a) => limparAnel(a, 1e-12)).filter(Boolean);
  }

  /** true se todos os vértices e meios de aresta de `interno` estão em `externo`. */
  function poligonoDentro(interno, externo) {
    const aneisExt = [externo];
    for (let i = 0; i < interno.length; i++) {
      const p = interno[i];
      const q = interno[(i + 1) % interno.length];
      if (!pontoNoPoligono(p, aneisExt)) return false;
      if (!pontoNoPoligono([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], aneisExt)) return false;
    }
    return true;
  }

  /**
   * Clip pelo Turf, com deslocamento de origem para não perder precisão em
   * coordenadas geográficas e conversão do resultado de volta para anéis.
   *
   * Devolve:
   *   null  -> o Turf não produziu resultado (sem sobreposição); quem chama decide
   *            se cai no motor próprio;
   *   []     -> resultado vazio legítimo;
   *   anéis  -> resultado.
   */
  function clipComTurf(pontosA, pontosB, querDentro) {
    const origem = [pontosA[0][0], pontosA[0][1]];
    const desloca = (pontos) => pontos.map((p) => [p[0] - origem[0], p[1] - origem[1]]);
    const a = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [fechado(desloca(pontosA))] } };
    const b = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [fechado(desloca(pontosB))] } };

    const res = querDentro
      ? turf.intersect(turf.featureCollection([a, b]))
      : turf.difference(turf.featureCollection([a, b]));
    if (!res || !res.geometry) return null;

    const volta = (p) => [p[0] + origem[0], p[1] + origem[1]];
    const aneis = [];
    const geo = res.geometry;
    const partes = geo.type === 'Polygon' ? [geo.coordinates] : (geo.type === 'MultiPolygon' ? geo.coordinates : []);
    for (const parte of partes) {
      for (let i = 0; i < parte.length; i++) {
        const anel = limparAnel(parte[i].map((p) => volta(p)), 1e-12);
        if (!anel) continue;
        // GeoJSON: anel externo anti-horário, furos horários. O Turf já devolve
        // nessa convenção; a normalização explícita evita variação entre versões.
        const externo = i === 0;
        const area = math.areaAnelAssinada(anel);
        const correto = externo ? area >= 0 : area <= 0;
        aneis.push(correto ? anel : anel.slice().reverse());
      }
    }
    return peneirar(aneis, pontosA, pontosB, querDentro);
  }

  /**
   * Peneira o resultado do Turf.
   *
   * Motivo: a biblioteca de clipping do Turf tem caso conhecido em que dois
   * polígonos que apenas se ENCOSTAM fazem interseção devolver o polígono sujeito
   * inteiro (área 75 em vez de 0), e o mesmo desvio aparece na diferença. Aqui cada
   * anel externo devolvido é conferido: um ponto do seu interior tem de estar mesmo
   * dentro de um E do outro (interseção) ou fora do recorte (diferença). O que não
   * passa é descartado e, se nada sobrar, quem chama usa o motor próprio.
   */
  function peneirar(aneis, pontosA, pontosB, querDentro) {
    if (!aneis.length) return aneis;
    const validos = [];
    for (let i = 0; i < aneis.length; i++) {
      const anel = aneis[i];
      const externo = i === 0;
      if (!externo) { validos.push(anel); continue; } // furo acompanha o externo
      if (temPontoValido(anel, pontosA, pontosB, querDentro)) validos.push(anel);
    }
    return validos;
  }

  /**
   * Existe algum ponto INTERIOR do anel que satisfaça a condição da operação?
   *
   * Testar um único ponto não serve: num "L" que contém o recorte, metade do
   * interior está dentro e metade fora, e o ponto amostrado podia cair justamente
   * dentro do recorte — a peneira então descartava o anel externo inteiro e o
   * resultado virava só o furo. Aqui são testados vários pontos (varredura
   * horizontal em alturas diferentes, mais o centroide).
   */
  function temPontoValido(anel, pontosA, pontosB, querDentro) {
    const amostras = pontosAmostra(anel);
    for (const p of amostras) {
      const emA = pontoNoPoligono(p, [pontosA]);
      const emB = pontoNoPoligono(p, [pontosB]);
      if (querDentro ? (emA && emB) : (emA && !emB)) return true;
    }
    // Nenhuma amostra serviu: se o anel tem furo (mais de um anel nos aneis), mantém
    // por precaução; se é um anel simples, descarta.
    return false;
  }

  /** Vários pontos interiores do anel, para amostragem. */
  function pontosAmostra(anel) {
    const r = math.abrirAnel(anel);
    if (r.length < 3) return [];
    const bb = bboxDeAnel(r);
    const amostras = [];
    const centro = math.centroide(r);
    if (dentroSimples(centro, r) && !naBorda(centro, r)) amostras.push(centro);
    for (const f of [0.5, 0.37, 0.61, 0.23, 0.79, 0.11, 0.89, 0.29, 0.71]) {
      const y = bb[1] + (bb[3] - bb[1]) * f;
      if (r.some((p) => Math.abs(p[1] - y) < 1e-12)) continue; // altura de vértice: empata
      const xs = [];
      for (let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length];
        if ((p[1] > y) === (q[1] > y)) continue;
        xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        amostras.push([(xs[i] + xs[i + 1]) / 2, y]);
      }
    }
    return amostras;
  }

  /**
   * Ponto garantidamente no INTERIOR do anel.
   *
   * Não basta o centroide: num "L" (ou em qualquer côncavo) a média dos vértices cai
   * fora da forma, e o ponto de teste escolhido acabava dentro do outro polígono —
   * isso fazia a peneira descartar o anel externo e devolver só o furo.
   *
   * Método: varredura horizontal na altura do centro da bbox. Os cruzamentos com as
   * arestas são ordenados e o ponto médio de cada par (dentro) é testado; o primeiro
   * que servir é interior de verdade.
   */
  function pontoInterior(anel) {
    const r = math.abrirAnel(anel);
    if (r.length < 3) return null;
    const bb = bboxDeAnel(r);
    const alturas = [];

    // Varredura horizontal em várias alturas. A altura NÃO pode coincidir com a de
    // um vértice: o teste ponto-em-polígono empata (vértice conta como dentro e como
    // fora ao mesmo tempo) e o ponto escolhido sai dentro do outro polígono. Era esse
    // empate que fazia a peneira descartar o anel externo e devolver só o furo.
    const candidatas = [0.5, 0.37, 0.61, 0.23, 0.79, 0.11, 0.89, 0.05, 0.95, 0.31, 0.43, 0.55, 0.67];
    for (const f of candidatas) alturas.push(bb[1] + (bb[3] - bb[1]) * f);
    const alturasLimpas = alturas.filter((y) => r.every((p) => Math.abs(p[1] - y) > 1e-9));

    for (const y of alturasLimpas.concat(alturas)) {
      const xs = [];
      for (let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length];
        if ((p[1] > y) === (q[1] > y)) continue; // aresta tratada como semiaberta
        xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x = (xs[i] + xs[i + 1]) / 2;
        if (x <= xs[i] + 1e-12 || x >= xs[i + 1] - 1e-12) continue;
        const c = [x, y];
        if (dentroSimples(c, r) && !naBorda(c, r)) return c;
      }
    }
    // Último recurso: deslocar para dentro a partir do meio de uma aresta.
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const mod = Math.hypot(dx, dy) || 1;
      const ux = -dy / mod, uy = dx / mod;
      for (const passo of [1e-9, 1e-7, 1e-5, 1e-3]) {
        const c = [(p[0] + q[0]) / 2 + ux * passo, (p[1] + q[1]) / 2 + uy * passo];
        if (dentroSimples(c, r) && !naBorda(c, r)) return c;
      }
    }
    return null;
  }

  function fechado(pontos) {
    const c = pontos.map((p) => [p[0], p[1]]);
    if (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) c.push([c[0][0], c[0][1]]);
    return c;
  }

  /** Caminho público: recorta anéis de sujeito por uma lista de anéis de recorte. */
  function recortarAneis(aneisSujeito, aneisRecorte, operacao, opcoes) {
    const resultado = [];
    for (const anelS of aneisSujeito) {
      const partes = recortarUmAnel(anelS, aneisRecorte, operacao, opcoes);
      for (const p of partes) resultado.push(p);
    }
    return resultado;
  }

  function recortarUmAnel(anelS, aneisRecorte, operacao, opcoes) {
    let atual = [math.abrirAnel(anelS)];
    for (const anelR of aneisRecorte) {
      const proximo = [];
      for (const a of atual) {
        const pedacos = clipUm(a, anelR, operacao !== 'diferenca', opcoes);
        for (const p of pedacos) proximo.push(p);
      }
      atual = proximo;
      if (!atual.length) break;
    }
    return atual;
  }

  function intersecaoUm(a, r, opcoes) { return clipUm(a, r, true, opcoes); }
  function diferencaUm(a, r, opcoes) { return clipUm(a, r, false, opcoes); }

  // ------------------------------------------------------------ linhas e pontos
  /**
   * Recorta uma linha por um polígono.
   *
   * Detalhe que precisa ser explícito: quando um trecho atravessa a borda, o ponto
   * de corte não é o vértice — é a INTERSEÇÃO com a aresta do polígono. Quebrar a
   * linha "no vértice" devolvia o trecho inteiro e o comprimento saía errado (era o
   * caso da linha que atravessava o quadrado de lado a lado).
   */
  /**
   * Recorta uma linha por um polígono (interseção) ou remove a parte interna.
   *
   * Dois defeitos da primeira versão, que ficam registrados porque são fáceis de
   * repetir:
   *   1. decidir "manter" pelas PONTAS do trecho. Um trecho com as duas pontas fora
   *      (a linha atravessando o polígono de lado a lado) era descartado inteiro —
   *      e é justamente o caso mais comum. Quem decide é o meio de cada pedaço,
   *      depois de cortar o trecho nas interseções com a borda;
   *   2. quebrar a linha "no vértice" em vez de no ponto de interseção, o que
   *      devolvia o trecho inteiro e deixava o comprimento errado.
   */
  function recortarLinha(linha, aneis, operacao) {
    const querDentro = operacao !== 'diferenca';
    const saida = [];
    let atual = null;

    const fechar = () => {
      if (atual && atual.length >= 2) saida.push(atual);
      atual = null;
    };

    for (let i = 1; i < linha.length; i++) {
      const p1 = linha[i - 1];
      const p2 = linha[i];

      // Trecho claramente longe de todos os anéis: nada a fazer
      if (!trechoTocaAneis(p1, p2, aneis)) { fechar(); continue; }

      const cortes = cortesComAneis(p1, p2, aneis);
      const pontos = [[p1[0], p1[1]]];
      for (const c of cortes) pontos.push(c);
      pontos.push([p2[0], p2[1]]);

      for (let k = 1; k < pontos.length; k++) {
        const a = pontos[k - 1], b = pontos[k];
        const dentro = trechoDentro(a, b, aneis);
        if (querDentro ? dentro : !dentro) {
          if (!atual) atual = [[a[0], a[1]]];
          atual.push([b[0], b[1]]);
        } else {
          fechar();
        }
      }
    }
    fechar();
    return saida;
  }

  /** O segmento tem interseção de bbox com algum anel? */
  function trechoTocaAneis(p1, p2, aneis) {
    const bb = [
      Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]),
      Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1]),
    ];
    for (const anel of aneis) {
      const ba = bboxDeAnel(anel);
      if (!(bb[2] < ba[0] || bb[0] > ba[2] || bb[3] < ba[1] || bb[1] > ba[3])) return true;
    }
    return false;
  }

  /**
   * O trecho a-b está dentro dos anéis?
   *
   * Testar só o ponto médio falha no caso comum de uma linha que corre exatamente
   * SOBRE a borda do polígono (o eixo de uma faixa de servidão, por exemplo): o meio
   * cai na borda e o teste devolve indefinido. Aqui o meio é testado e, se estiver
   * na borda, vale a votação dos pontos deslocados para os dois lados do trecho —
   * que é justamente o que decide de que lado ele corre.
   */
  function trechoDentro(a, b, aneis) {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!sobreBorda(m, aneis)) return pontoNoPoligono(m, aneis);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const mod = Math.hypot(dx, dy) || 1;
    const ux = -dy / mod, uy = dx / mod; // perpendicular
    for (const passo of [1e-9, 1e-7, 1e-5]) {
      const lado1 = pontoNoPoligono([m[0] + ux * passo, m[1] + uy * passo], aneis);
      const lado2 = pontoNoPoligono([m[0] - ux * passo, m[1] - uy * passo], aneis);
      if (lado1 || lado2) return true;
    }
    return pontoNoPoligono(m, aneis);
  }

  function sobreBorda(p, aneis) {
    for (const anel of aneis) {
      const r = math.abrirAnel(anel);
      for (let i = 0; i < r.length; i++) {
        if (emSegmento(p, r[i], r[(i + 1) % r.length], 1e-12)) return true;
      }
    }
    return false;
  }

  /** Interseções do segmento p1-p2 com as arestas dos anéis, ordenadas de p1 para p2. */
  function cortesComAneis(p1, p2, aneis) {
    const cortes = [];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const den = dx * dx + dy * dy || 1;
    for (const anel of aneis) {
      const r = math.abrirAnel(anel);
      for (let i = 0; i < r.length; i++) {
        const q1 = r[i], q2 = r[(i + 1) % r.length];
        const it = intersecaoSegmentos(p1, p2, q1, q2);
        if (!it) continue;
        const t = ((it.ponto[0] - p1[0]) * dx + (it.ponto[1] - p1[1]) * dy) / den;
        if (t <= 1e-12 || t >= 1 - 1e-12) continue; // extremos não são cortes
        if (cortes.some((c) => Math.abs(c[0] - t) < 1e-12)) continue;
        cortes.push([it.ponto[0], it.ponto[1], t]);
      }
    }
    cortes.sort((a, b) => a[2] - b[2]);
    return cortes.map((c) => [c[0], c[1]]);
  }

  // ------------------------------------------------------------ simplificação
  /** Douglas–Peucker (para aliviar camada pesada antes do recorte). */
  function simplificar(pontos, tolerancia) {
    if (pontos.length <= 2) return pontos.slice();
    const tol2 = tolerancia * tolerancia;
    const manter = new Uint8Array(pontos.length);
    manter[0] = 1; manter[pontos.length - 1] = 1;
    const pilha = [[0, pontos.length - 1]];
    while (pilha.length) {
      const [i0, i1] = pilha.pop();
      let maxD = -1, idx = -1;
      const a = pontos[i0], b = pontos[i1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const den = dx * dx + dy * dy;
      for (let i = i0 + 1; i < i1; i++) {
        const p = pontos[i];
        let d;
        if (den === 0) {
          d = (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
        } else {
          let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den;
          t = Math.max(0, Math.min(1, t));
          const qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
          d = qx * qx + qy * qy;
        }
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol2 && idx > 0) {
        manter[idx] = 1;
        pilha.push([i0, idx], [idx, i1]);
      }
    }
    const saida = [];
    for (let i = 0; i < pontos.length; i++) if (manter[i]) saida.push(pontos[i]);
    return saida;
  }

  // ------------------------------------------------------------ validação
  /** Auto-interseção de um anel (ignora arestas vizinhas). */
  function temAutoIntersecao(anel) {
    const r = math.abrirAnel(anel);
    const n = r.length;
    if (n < 4) return false;
    for (let i = 0; i < n; i++) {
      const a1 = r[i], a2 = r[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i) continue;
        if ((j + 1) % n === i || (i + 1) % n === j) continue; // vizinhas
        const b1 = r[j], b2 = r[(j + 1) % n];
        const it = intersecaoSegmentos(a1, a2, b1, b2);
        if (it) return true;
      }
    }
    return false;
  }

  function orientacaoAnel(anel) {
    return math.areaAnelAssinada(math.abrirAnel(anel)) > 0 ? 1 : -1;
  }

  // ------------------------------------------------------------ features
  /**
   * Recorta uma coleção de feições contra um conjunto de anéis (área de influência).
   * Preserva as propriedades e acrescenta as colunas de resultado.
   */
  function recortarFeatures(features, aneis, operacao, opcoes) {
    const o = opcoes || {};
    const saida = [];
    const descartadas = [];
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      const tipo = g.type;

      if (tipo === 'Polygon' || tipo === 'MultiPolygon') {
        const aneisF = tipo === 'Polygon' ? [g.coordinates] : g.coordinates;
        const pedacos = [];
        for (const parte of aneisF) {
          const externo = parte[0];
          const furos = parte.slice(1);
          let recortes = recortarUmAnel(externo, aneis, operacao, o);
          if (furos.length && recortes.length) {
            for (const furo of furos) {
              const restante = [];
              for (const a of recortes) restante.push(...diferencaUm(a, furo, o));
              recortes = restante;
            }
          }
          for (const a of recortes) if (math.areaAnel(a) > (o.areaMinima || 1e-13)) pedacos.push([a]);
        }
        if (pedacos.length) {
          saida.push({
            type: 'Feature',
            properties: Object.assign({}, f.properties),
            geometry: pedacos.length === 1 && tipo === 'Polygon'
              ? { type: 'Polygon', coordinates: pedacos[0] }
              : { type: 'MultiPolygon', coordinates: pedacos },
          });
        } else descartadas.push(f);
        continue;
      }

      if (tipo === 'LineString' || tipo === 'MultiLineString') {
        const linhas = tipo === 'LineString' ? [g.coordinates] : g.coordinates;
        const mantidas = [];
        for (const l of linhas) {
          for (const pedaco of recortarLinha(l, aneis, operacao)) mantidas.push(pedaco);
        }
        if (mantidas.length) {
          saida.push({
            type: 'Feature',
            properties: Object.assign({}, f.properties),
            geometry: mantidas.length === 1 && tipo === 'LineString'
              ? { type: 'LineString', coordinates: mantidas[0] }
              : { type: 'MultiLineString', coordinates: mantidas },
          });
        } else descartadas.push(f);
        continue;
      }

      if (tipo === 'Point' || tipo === 'MultiPoint') {
        const pontos = tipo === 'Point' ? [g.coordinates] : g.coordinates;
        const mantidos = pontos.filter((p) => {
          const dentro = pontoNoPoligono(p, aneis);
          return operacao === 'diferenca' ? !dentro : dentro;
        });
        if (mantidos.length) {
          saida.push({
            type: 'Feature',
            properties: Object.assign({}, f.properties),
            geometry: mantidos.length === 1 && tipo === 'Point'
              ? { type: 'Point', coordinates: mantidos[0] }
              : { type: 'MultiPoint', coordinates: mantidos },
          });
        } else descartadas.push(f);
        continue;
      }
      descartadas.push(f);
    }
    return { features: saida, descartadas: descartadas };
  }

  return {
    EPS: EPS,
    orientacao: orientacao,
    emSegmento: emSegmento,
    pontoNoAnel: pontoNoAnel,
    pontoNoPoligono: pontoNoPoligono,
    intersecaoSegmentos: intersecaoSegmentos,
    bboxDeAnel: bboxDeAnel,
    bboxDeAneis: bboxDeAneis,
    recortarAneis: recortarAneis,
    recortarUmAnel: recortarUmAnel,
    intersecaoUm: intersecaoUm,
    diferencaUm: diferencaUm,
    recortarLinha: recortarLinha,
    recortarFeatures: recortarFeatures,
    simplificar: simplificar,
    limparAnel: limparAnel,
    temAutoIntersecao: temAutoIntersecao,
    orientacaoAnel: orientacaoAnel,
    // Internos expostos apenas para depuração e teste do encadeamento dos anéis.
    _interno: {
      No: No,
      Anel: Anel,
      listaDeAnel: listaDeAnel,
      criarAnel: criarAnel,
      iterar: iterar,
      cruzar: cruzar,
      inserirEmLista: inserirEmLista,
      inserirNaAresta: inserirNaAresta,
      mesmoPonto: mesmoPonto,
      chavePonto: chavePonto,
      unificarNos: unificarNos,
      paraAntiHorario: paraAntiHorario,
      arestasInternas: arestasInternas,
      encadearArestas: encadearArestas,
      cortesComAneis: cortesComAneis,
      pontoInterior: pontoInterior,
      poligonoDentro: poligonoDentro,
      peneirar: peneirar,
    },
  };
});
