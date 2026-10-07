'use strict';
/* ============================================================================
 * km.js — quilometragem: ler "70+500", achar o km no mapa
 *
 * O usuário digita um km e quer o mapa naquele ponto. Parece simples e não é, por três
 * motivos que este módulo resolve:
 *
 * 1) O MESMO KM SE ESCREVE DE VÁRIAS FORMAS. Numa rodovia o marco é "70+500" (70 km e 500
 *    metros, convenção do DNIT). No Excel vira 70,5 ou 70.500. No shapefile pode estar em
 *    coluna de texto com a forma de rodovia, ou em coluna numérica com a forma decimal. Quem
 *    digita no portal escreve como está acostumado, e cabe ao portal entender — não ao
 *    usuário adivinhar o formato do programa.
 *
 * 2) A CAMADA PODE SER DE PONTOS OU UMA LINHA. Se o usuário subiu os marcos
 *    quilométricos, o km está no ATRIBUTO de cada ponto. Se subiu o traçado da rodovia, o km
 *    não está em atributo nenhum: ele é a DISTÂNCIA PERCORRIDA ao longo da linha (referência
 *    linear). São os dois jeitos de guardar a mesma informação, e os dois existem no mercado.
 *
 * 3) A VÍRGULA É DECIMAL no Brasil, e "70,500" precisa valer 70,5 km — não 70500. Mas se
 *    vier "70.500,00" (com separador de milhar), o decimal é o último. Errar isso joga o
 *    usuário 70 mil km para o lado.
 *
 * A distância ao longo da linha usa Vincenty (a mesma função do resto do portal), então o
 * ponto encontrado está na posição certa dentro de ~1 metro — o que importa quando o km
 * localiza uma Supressão de Vegetação ou um sítio arqueológico.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const deps = node ? { math: require('./math.js') } : { math: raiz.EIA.math };
  const api = fabrica(deps);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.km = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EIA) {

  /* Nomes de coluna que costumam guardar quilometragem, do mais específico ao mais genérico.
   * `KM_INI`/`KM_FIN` entram porque em EIA é comum a feição ser um TRECHO, e o km de
   * interesse ser o do início. */
  const PALAVRAS_KM = [
    /^km$/i, /^km_?in[íi]?cio?$/i, /^km_?ini?$/i, /^km_?fim$/i, /^km_?final$/i,
    /^km_?f$/i, /^km_?i$/i, /quil[oô]metr/i, /kilometr/i, /^km[_\d]/i, /quilom/i,
    /marcos?/i, /^marco/i,
  ];
  /* Campos parecidos que NÃO são km: confundir distância de um ponto qualquer com posição na
   * rodovia daria um "km localizado" que não existe no projeto. */
  const PALAVRAS_NAO_KM = [/latitude/i, /longitude/i, /^lat$/i, /^lon$/i, /^x$/i, /^y$/i,
    /coordenada/i, /^id$/i, /^cod/i, /c[oó]digo/i, /^area/i, /^área/i, /ha$/i, /^fid$/i];

  /** Campo que parece guardar quilometragem, entre os campos disponíveis. */
  function campoDeKm(campos) {
    const nomes = (campos || []).map(function (c) { return typeof c === 'string' ? c : (c && c.nome); })
      .filter(Boolean);
    let melhor = null, melhorPeso = -1;
    for (const nome of nomes) {
      if (PALAVRAS_NAO_KM.some(function (re) { return re.test(nome); })) continue;
      let peso = -1;
      for (let i = 0; i < PALAVRAS_KM.length; i++) {
        if (PALAVRAS_KM[i].test(nome)) { peso = PALAVRAS_KM.length - i; break; }
      }
      if (peso > melhorPeso) { melhorPeso = peso; melhor = nome; }
    }
    return melhorPeso > 0 ? melhor : null;
  }

  /**
   * O maior km que ainda faz sentido numa rodovia. A mais longa do Brasil (BR-116) tem
   * ~4.500 km; acima disso o número é quase certamente uma leitura errada de "km + metros"
   * escrita com separador de milhar. Serve para desempatar as formas mistas.
   */
  const LIMITE_PLAUSIVEL = 5000;

  /**
   * Converte a parte numérica em decimal.
   * @param {string} numero
   * @param {boolean} primeiroSeparador se verdadeiro, o PRIMEIRO separador é o decimal (e o
   *   resto é lixo de milhar) — usado só como segunda tentativa nas formas mistas
   */
  function lerDecimal(numero, primeiroSeparador) {
    const temVirgula = numero.indexOf(',') >= 0;
    const temPonto = numero.indexOf('.') >= 0;
    let s = numero;
    if (temVirgula && temPonto) {
      const iv = numero.indexOf(',');
      const ip = numero.indexOf('.');
      const decimalEhPrimeiro = (primeiroSeparador ? iv < ip : iv > ip);
      if (decimalEhPrimeiro) {
        // o separador decimal é o primeiro: o outro é milhar (ou o resto de "km+metros")
        const dec = Math.min(iv, ip);
        s = numero.slice(0, dec) + '.' + numero.slice(dec + 1).replace(/[.,]/g, '');
      } else {
        const dec = Math.max(iv, ip);
        s = numero.slice(0, dec).replace(/[.,]/g, '') + '.' + numero.slice(dec + 1).replace(/[.,]/g, '');
      }
    } else if (temVirgula) {
      s = numero.replace(/,/g, '.');
    }
    if (!/^[0-9]*\.?[0-9]*$/.test(s)) return null;
    const v = Number(s);
    return isFinite(v) ? v : null;
  }

  /**
   * Lê um km escrito de qualquer jeito e devolve em quilômetros.
   *
   *   '70'  '70,5'  '70.5'  '70,500'  '70.500'   -> 70 ou 70,5
   *   '70+500'  'KM 70+500'  '70+500,00'          -> 70,5   (o que vem depois do + são METROS)
   *   '70+5'                                      -> 70,005
   *   '70.500,00'  '70,500.00'                    -> 70,5   (formas mistas, ver abaixo)
   *   'nada'  ''  '-5'                            -> null
   *
   * Nas formas mistas (dois separadores) vale a convenção brasileira — o último separador é
   * o decimal —, MAS com uma guarda de plausibilidade: se o resultado passar de 5.000 km
   * (mais que a rodovia mais longa do Brasil), tenta-se a leitura alternativa. É o que faz
   * "70.500,00" valer 70,5 km e não 70.500 km. Se nenhuma leitura for plausível, devolve
   * null: recusar é melhor que dar zoom num ponto que não existe.
   *
   * @returns {{km: number, metros: number, forma: string}|null}
   */
  function interpretar(texto) {
    if (texto === null || texto === undefined) return null;
    // aceita número puro vindo de coluna numérica do shapefile
    if (typeof texto === 'number') {
      return isFinite(texto) && texto >= 0 && texto <= LIMITE_PLAUSIVEL
        ? { km: texto, metros: Math.round(texto * 1000), forma: 'numero' } : null;
    }
    let s = String(texto).trim();
    if (!s) return null;
    // tira o que costuma vir junto: "KM 70+500", "km. 70", "#70"
    s = s.replace(/^\s*(km|k\.?m\.?|quil[oô]metro|marco)\s*[:.]?\s*/i, '').replace(/^#\s*/, '');
    s = s.replace(/\s+/g, '');
    if (!/[0-9]/.test(s)) return null;

    if (s.indexOf('+') >= 0) {
      // forma de rodovia: 70+500 — depois do + são METROS. A parte decimal dos metros é
      // descartada: "70+500,00" é o mesmo marco que "70+500", e ler os dois zeros como
      // metros daria 70+50000 = km 120.
      const partes = s.split('+');
      if (partes.length !== 2) return null;
      const inteiro = partes[0].replace(/[^0-9]/g, '');
      const resto = partes[1].split(/[.,]/)[0].replace(/[^0-9]/g, '');
      if (!inteiro || !resto) return null;
      const kmInt = Number(inteiro);
      const metros = Number(resto);
      if (!isFinite(kmInt) || !isFinite(metros)) return null;
      const km = kmInt + metros / 1000;
      if (km > LIMITE_PLAUSIVEL) return null;
      return { km: km, metros: kmInt * 1000 + metros, forma: 'rodovia' };
    }

    let km = lerDecimal(s, false);
    if (km !== null && km > LIMITE_PLAUSIVEL) {
      const alternativa = lerDecimal(s, true);
      if (alternativa !== null && alternativa <= LIMITE_PLAUSIVEL) km = alternativa;
      else return null;
    }
    if (km === null || km < 0) return null;
    return { km: km, metros: Math.round(km * 1000), forma: 'decimal' };
  }

  /** "70+500" — a forma como o marco é escrito na rodovia. */
  function formatar(km) {
    const v = Number(km);
    if (!isFinite(v) || v < 0) return '';
    let total = Math.round(v * 1000);           // metros inteiros
    const inteiro = Math.floor(total / 1000);
    const metros = total - inteiro * 1000;
    return inteiro + '+' + String(metros).padStart(3, '0');
  }

  /** "70,5 km" — para a tela, com a vírgula brasileira e sem zeros à direita. */
  function formatarCurto(km, casas) {
    const v = Number(km);
    if (!isFinite(v)) return '';
    const c = casas === undefined ? 3 : casas;
    let s = v.toFixed(c);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s.replace('.', ',') + ' km';
  }

  /** Valor de km guardado num registro, escrito de qualquer das formas. */
  function valorDoRegistro(props, campo) {
    if (!props || !campo) return null;
    const bruto = props[campo];
    if (bruto === null || bruto === undefined || String(bruto).trim() === '') return null;
    const lido = interpretar(bruto);
    return lido ? lido.km : null;
  }

  /** É uma camada de linhas (traçado) e não de pontos (marcos)? */
  function temLinha(geojson) {
    const fs = (geojson && geojson.features) || [];
    return fs.some(function (f) {
      const t = f && f.geometry && f.geometry.type;
      return t === 'LineString' || t === 'MultiLineString';
    });
  }

  function temPonto(geojson) {
    const fs = (geojson && geojson.features) || [];
    return fs.some(function (f) {
      const t = f && f.geometry && f.geometry.type;
      return t === 'Point' || t === 'MultiPoint';
    });
  }

  /** Posição (primeiro ponto) de uma geometria de ponto. */
  function posicaoDoPonto(geometria) {
    if (!geometria) return null;
    if (geometria.type === 'Point') return geometria.coordinates;
    if (geometria.type === 'MultiPoint' && geometria.coordinates.length) return geometria.coordinates[0];
    return null;
  }

  /**
   * Ponto a `kmAlvo` metros ao longo de uma linha (referência linear).
   * @param {Array} coords lista de posições [lon, lat]
   * @returns {{pos: Array, metrosPercorridos: number, metrosTotais: number}|null}
   */
  function posicaoNaLinha(coords, kmAlvo) {
    if (!coords || coords.length < 2) return null;
    const alvoM = kmAlvo * 1000;
    let acumulado = 0;
    let total = 0;
    const comprimentos = [];
    for (let i = 1; i < coords.length; i++) {
      const c = EIA.math.comprimentoGeodesico([coords[i - 1], coords[i]]);
      comprimentos.push(c);
      total += c;
    }
    if (total <= 0) return null;
    // além do fim da linha: devolve o fim, e quem chama avisa
    for (let i = 0; i < comprimentos.length; i++) {
      const c = comprimentos[i];
      if (acumulado + c >= alvoM) {
        const t = c > 0 ? (alvoM - acumulado) / c : 0;
        const a = coords[i], b = coords[i + 1];
        return {
          pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          metrosPercorridos: alvoM,
          metrosTotais: total,
          dentro: true,
        };
      }
      acumulado += c;
    }
    return {
      pos: coords[coords.length - 1].slice(),
      metrosPercorridos: total,
      metrosTotais: total,
      dentro: false,
    };
  }

  /** Todas as coordenadas de linha de um FeatureCollection, em sequência. */
  function linhasDaCamada(geojson) {
    const saida = [];
    for (const f of (geojson && geojson.features) || []) {
      const g = f && f.geometry;
      if (!g) continue;
      if (g.type === 'LineString') saida.push(g.coordinates);
      else if (g.type === 'MultiLineString') for (const l of g.coordinates) saida.push(l);
    }
    return saida;
  }

  /** Distância em metros entre duas posições (Vincenty, a mesma régua do resto do portal). */
  function distancia(a, b) {
    return EIA.math.comprimentoGeodesico([a, b]);
  }

  /**
   * Escolhe o TRAÇADO da camada: uma sequência de coordenadas para medir o km.
   *
   * Uma rodovia raramente vem num arquivo de uma linha só — vem dividida em trechos, e a
   * ordem deles no arquivo não é a ordem da rodovia. Medir o km na "linha mais longa" daria
   * km errado assim que o ponto de interesse caísse em outro trecho.
   *
   * Então os trechos são ENCADEADOS pelo ponto mais próximo, crescendo pelas DUAS pontas:
   * um trecho pode entrar no fim ou no começo da sequência, e invertido quando o sentido
   * dele é o contrário. Crescer só pelo fim era o defeito da primeira versão — se a semente
   * fosse o trecho do meio, os trechos anteriores não tinham por onde se ligar e ficavam de
   * fora, sem aviso nenhum.
   *
   * Trecho que não encaixa em ninguém NÃO é inventado na sequência: sobra é reportada e quem
   * chama avisa. Melhor dizer "não consegui encaixar 2 trechos" do que localizar o km no
   * lugar errado e o usuário não saber.
   *
   * @returns {{coords: Array, comprimentoKm: number, trechos: number, sobraram: number}|null}
   */
  function escolherTracado(geojson) {
    const linhas = linhasDaCamada(geojson).filter(function (l) { return l && l.length >= 2; });
    if (!linhas.length) return null;
    const TOLERANCIA_M = 25;

    // do mais longo para o mais curto (a semente é o trecho principal)
    const comTamanho = linhas.map(function (l) {
      let d = 0;
      for (let i = 1; i < l.length; i++) d += distancia(l[i - 1], l[i]);
      return { l: l, d: d };
    }).sort(function (a, b) { return b.d - a.d; });

    const usados = new Array(comTamanho.length).fill(false);
    let atual = comTamanho[0].l.slice();
    usados[0] = true;
    let trechos = 1;
    let comprimento = comTamanho[0].d;

    for (;;) {
      const ini = atual[0];
      const fim = atual[atual.length - 1];
      let melhor = null;
      for (let i = 0; i < comTamanho.length; i++) {
        if (usados[i]) continue;
        const l = comTamanho[i].l;
        const a = l[0];
        const b = l[l.length - 1];
        const opcoes = [
          { d: distancia(fim, a), modo: 'fim-ini' },
          { d: distancia(fim, b), modo: 'fim-fim' },
          { d: distancia(ini, b), modo: 'ini-fim' },
          { d: distancia(ini, a), modo: 'ini-ini' },
        ];
        for (const o of opcoes) {
          if (o.d <= TOLERANCIA_M && (!melhor || o.d < melhor.d)) melhor = { i: i, d: o.d, modo: o.modo };
        }
      }
      if (!melhor) break;

      const l = comTamanho[melhor.i].l;
      usados[melhor.i] = true;
      trechos++;
      comprimento += comTamanho[melhor.i].d;
      if (melhor.modo === 'fim-ini') atual = atual.concat(l.slice(1));
      else if (melhor.modo === 'fim-fim') atual = atual.concat(l.slice().reverse().slice(1));
      else if (melhor.modo === 'ini-fim') atual = l.slice(0, -1).concat(atual);
      else atual = l.slice().reverse().slice(0, -1).concat(atual);
    }

    const sobraram = usados.filter(function (u) { return !u; }).length;
    return { coords: atual, comprimentoKm: comprimento / 1000, trechos: trechos, sobraram: sobraram };
  }

  /**
   * Localiza um km na camada que o usuário subiu.
   *
   * Decide sozinho entre os dois jeitos de guardar a informação, e DIZ qual usou — o modo
   * entra no resultado para a tela poder explicar de onde veio o ponto:
   *   - traçado: km é a distância percorrida ao longo da linha (ou dos trechos encadeados);
   *   - marco  : km está no atributo de cada ponto (o mais próximo é o localizado).
   *
   * @returns {{pos, km, diferenca, modo, rotulo, aviso}|null}
   */
  function localizar(geojson, campo, kmAlvo) {
    if (!geojson || !isFinite(kmAlvo)) return null;
    const features = geojson.features || [];

    // ---- 1) traçado: referência linear ao longo da linha
    const tracado = escolherTracado(geojson);
    if (tracado) {
      const p = posicaoNaLinha(tracado.coords, kmAlvo);
      if (p) {
        let aviso = null;
        if (!p.dentro) {
          aviso = 'O traçado tem só ' + formatarCurto(p.metrosTotais / 1000, 1) + ': mostrei o fim dele.';
        } else if (tracado.sobraram > 0) {
          aviso = 'O traçado veio em ' + (tracado.trechos + tracado.sobraram) + ' trechos e encaixei '
            + tracado.trechos + '. Os outros ' + tracado.sobraram + ' ficaram de fora: se o km que você '
            + 'quer está neles, junte os trechos num arquivo só (ou corrija as pontas soltas).';
        }
        return {
          pos: p.pos, km: kmAlvo, diferenca: 0, modo: 'tracado',
          comprimentoKm: p.metrosTotais / 1000,
          trechos: tracado.trechos,
          rotulo: 'km ' + formatar(kmAlvo),
          aviso: aviso,
        };
      }
    }

    // ---- 2) marcos: o ponto de km mais próximo do pedido
    let melhor = null;
    for (const f of features) {
      const valor = valorDoRegistro(f.properties, campo);
      if (valor === null) continue;
      const pos = posicaoDoPonto(f.geometry);
      if (!pos) continue;
      const dif = Math.abs(valor - kmAlvo);
      if (!melhor || dif < melhor.diferenca) {
        melhor = {
          pos: pos, km: valor, diferenca: dif, modo: 'marco',
          rotulo: 'km ' + formatar(valor),
          nome: (f.properties && (f.properties.NOME || f.properties.nome || f.properties.MARCO)) || null,
        };
      }
    }
    if (!melhor) return null;
    if (melhor.diferenca > 0.05) {
      const m = Math.round(melhor.diferenca * 1000);
      melhor.aviso = 'Não há marco no km ' + formatar(kmAlvo) + '. O mais próximo é o km '
        + formatar(melhor.km) + ', a ' + (m >= 1000
          ? (m / 1000).toFixed(2).replace('.', ',') + ' km'
          : m + ' m') + ' do pedido.';
    }
    return melhor;
  }

  return {
    LIMITE_PLAUSIVEL: LIMITE_PLAUSIVEL,
    PALAVRAS_KM: PALAVRAS_KM,
    campoDeKm: campoDeKm,
    interpretar: interpretar,
    formatar: formatar,
    formatarCurto: formatarCurto,
    valorDoRegistro: valorDoRegistro,
    temLinha: temLinha,
    temPonto: temPonto,
    posicaoNaLinha: posicaoNaLinha,
    linhasDaCamada: linhasDaCamada,
    escolherTracado: escolherTracado,
    localizar: localizar,
  };
});
