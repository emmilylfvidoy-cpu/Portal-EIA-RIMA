# Portal EIA/RIMA

**Versão atual: v1.6** (a versão aparece no rodapé do mapa, sobre a área de coordenadas).

| Versão | O que entrou |
|---|---|
| v1.0 | Portal: recorte por áreas de influência, tabela, gráficos, mini-relatório e mapa articulado |
| v1.1 | Importador de camadas: leva a base de shapefiles para dentro do portal, com simplificação por escala |
| v1.2 | Leitura de simbologia (`.qml`, `.sld`, `.lyrx`) e **correção do layout do shapefile**, que estava inválido para QGIS/ArcGIS |
| v1.3 | Escolha do campo de classe corrigida, com lista de alternativas no `--inspecionar` |
| v1.4 | Cache: `/js` e `/style.css` revalidam sempre; versão visível no rodapé |
| v1.5 | **Correção do cálculo de área geodésica** (errava 31% em anel recortado) e Geologia real no lugar do exemplo |
| v1.6 | **Agrupamento escolhido pelo usuário** (tabela, gráfico e relatório) e legenda por folha, que suporta centenas de classes |
| v1.7 | **Cores do mapa do projeto** na Geologia: leitura de `<camada>.xml` (estilo com símbolos nomeados pela classe) — 306 de 306 unidades com a cor do cliente |
| v1.8 | **Correção do cache do dado**: a camada era buscada com `force-cache`, que nunca revalida — quem já tinha aberto o portal continuava recebendo a geometria antiga (e o mapa pintava de uma cor só, como se as cores não tivessem sido publicadas) |
| v1.9 | **Contorno das unidades** lido do arquivo de estilo: é a divisa que separa as unidades no mapa do projeto (sem ela, 306 manchas de cor viram uma aquarela) |
| v2.0 | **Transparência e rótulo por camada**, escolhidos na tela: o analista decide quanto a camada deixa ver do fundo e qual coluna quer ler no mapa |
| v2.1 | **Versão na URL de cada arquivo do site** (`app.js?v=2.1`): um arquivo já guardado como "imutável" pelo navegador nunca é revalidado, e foi assim que os controles novos apareceram sem os rótulos funcionarem. Se a função de posição faltar, o rótulo cai no centro da caixa e **avisa**, em vez de sumir em silêncio |
| v2.2 | **Carregar a área de influência virou confiável**: o despacho de entrada saiu do `app.js` para `js/entrada.js` (sem DOM, testável) e passou a olhar **todos** os arquivos enviados — antes olhava só o primeiro, então selecionar `.shp` + `.dbf` + `.prj` era recusado como "formato não reconhecido" |
| v2.3 | **Ordem das camadas é do usuário**: setas ▲▼ para subir e descer cada camada, opção "minhas áreas por cima das camadas", e os ajustes de transparência e rótulo passaram a viver numa **abinha recolhida** dentro de cada camada |
| v2.4 | **Cor, traço e grossura da linha**, nos dois lugares que têm linha: o **contorno das camadas** (aba *Linha*) e o **traço das áreas de influência** (⚙ de cada área). Escolha pelo olho, com amostra do traço ao lado |
| v2.5 | **A área da área de influência vinda de ARQUIVO era sempre ZERO** (`0,00 ha · 0,00 km²`): a função que lista os anéis ignorava `FeatureCollection`. Corrigido na raiz — e com ela o recorte de arquivo com vários polígonos, que era recusado |
| v2.6 | Área carregada vem com **linha contínua** (o tracejado virou escolha, não padrão) e **transparência do preenchimento** ajustável; o ⚙ virou **✏ (lápis)**, que é o que a ação faz — editar |
| v2.7 | **Quilometragem**: o usuário sobe a camada de km (marcos ou traçado) e **digita o km** para o mapa ir até lá. Entende `70`, `70,5`, `70,500`, `70+500` e `KM 70+500` |
| v2.8 | **A base do portal é o Estado de São Paulo inteiro**: as 8 camadas de exemplo de Piracicaba saíram e entraram as 6 camadas reais (Geologia, Geomorfologia, Pedologia, Aquíferos, Biomas, Unidades de Conservação), cada uma com **as cores do seu arquivo de estilo** |
| v2.9 | **Faixa fina não é mais apagada pela simplificação**: a tolerância passou a ser limitada pela espessura do próprio anel. A Pedologia perdia **2,38% da área em fendas** (listras vazias onde havia solo de vale) — caiu para **0,44%** |

## O defeito da faixa fina (v2.9)

O cliente olhou o mapa da Pedologia e disse: *"a feição do shp está estranha"*. Estava. O que
se via eram **listras vazias** onde o mapa de origem tinha solo.

**O caminho até a causa** — vale registrar, porque a primeira leitura foi errada:

1. A geometria publicada estava **bem formada**: 0 anéis abertos, 23.500 anéis, e a área
   batendo com o campo `area_ha` da origem em **−0,33%**. Nada disso apontava defeito.
2. A checagem "os pontos do publicado são um subconjunto ordenado da origem?" acusou
   **todos os 6 layers** — inclusive a Geologia, que estava visivelmente certa. Quando um
   teste acusa tudo, o teste está errado: anel invertido (sentido anti-horário → horário) e o
   ponto de fechamento apareciam como "fora de ordem", e polígonos vizinhos compartilham
   vértices, o que estraga o casamento ponto a ponto.
3. A medida **objetiva** resolveu: rasterizar a mesma região da origem e do publicado e
   comparar. Não a diferença de pixels (que inclui o deslocamento legítimo de borda), mas a
   **área preenchida** — fenda é área que sumiu.

| Camada | Área preenchida (origem → publicado) | Veredito |
|---|---|---|
| Geologia | 98,1% → 98,0% | −0,06% ✅ |
| Geomorfologia | 68,4% → 68,4% | −0,02% ✅ |
| Aquíferos | 100% → 99,9% | −0,08% ✅ |
| Unidades de Conservação | 66,9% → 66,8% | −0,13% ✅ (os 3,58% de pixels são só borda) |
| Biomas | 2,4% → 2,4% | +0,96% ✅ |
| **Pedologia** | **100% → 97,6%** | **−2,38%** ❌ |

**5 das 6 estavam corretas.** Só a Pedologia perdia área.

**A causa:** numa camada de solos, as faixas finas (solo de vale, inclusão estreita) têm
100–300 m de largura. Aplicar 400 m de tolerância **apaga a faixa** — o anel vira um sliver de
área zero, e o mapa fica com a fenda. Não era erro de leitura nem de simplificação: era a
tolerância escolhida, que num mapa de solos é grande demais.

**A correção:** nenhum anel é simplificado além de **1/4 da sua espessura aparente**
(`2·área/perímetro`). Faixa fina sobrevive; anel grande tem espessura grande e continua com a
tolerância global, então o arquivo não engorda por causa disso. Está travado por teste: uma
faixa de 200 m × 5 km simplificada a 400 m mantém **100% da área**.

**O preço, medido** (a escolha da Pedologia foi essa):

| Pedologia | Vértices | Arquivo | Perda de área |
|---|---|---|---|
| 400 m, sem o limite | 444 mil | 19,5 MB | −3,45% ❌ |
| 400 m, com o limite | 671 mil | 24,7 MB | −2,38% ❌ |
| **100 m, com o limite** (escolhido) | **920 mil** | **30,3 MB** | **−0,44%** ✅ |

Medi também onde está o peso: **73% do arquivo são os 7.677 polígonos acima de 100 ha**, que
têm 98,84% da área. Os menores de 20 ha são 9.271 feições (12,6% do arquivo) e **0,15% da
área** — se um dia for preciso emagrecer o arquivo, é ali, com perda de área desprezível.

> **O que ainda não é feito:** a simplificação não é *topológica*. Polígonos vizinhos são
> simplificados de forma independente, então a borda comum pode afastar-se e abrir uma fenda
> da ordem da tolerância. É por isso que a Pedologia — a camada com mais contatos finos —
> precisa de tolerância fina, e é por isso que o arquivo dela é o mais pesado. Corrigir de
> verdade exige simplificação com topologia compartilhada, que é outro trabalho.

### Como conferir uma camada publicada (o método)

O que provou o defeito e a correção, e que serve para qualquer camada futura:

1. Escolher uma região e extrair **os anéis da origem e do publicado** nos mesmos pixels.
2. Preencher os dois em máscaras separadas.
3. Comparar **área preenchida** (fenda) e **pixels diferentes** (deslocamento de borda).
   Fenda é área que sumiu; deslocamento de borda é diferença de pixels com a área preservada.
4. Se a área preenchida cair mais que ~0,5%, a tolerância está grande demais para aquela
   camada.

## A base de camadas (v2.8)

Seis camadas, todas reais e cobrindo o estado inteiro. Nenhuma é amostra sintética:

| Camada | Meio | Classe (agrupamento do mapa) | Feições | Arquivo |
|---|---|---|---|---|
| **Geologia** | físico | `SIGLA_UNID` — unidade litológica (306) | 2.102 | 5,6 MB |
| **Geomorfologia** | físico | `COD_REL` — compartimento de relevo (13) | 2.482 | 4,7 MB |
| **Pedologia** | físico | `Subordem` — subordem de solo (27) | 17.026 | 19,5 MB |
| **Aquíferos** | físico | `INT_VAZÃO` — intervalo de vazão (10) | 765 | 1,8 MB |
| **Biomas** | biótico | `Bioma` — Cerrado / Mata Atlântica (2) | 2 | 0,7 MB |
| **Unidades de Conservação** | socioeconômico | `grupo` — Proteção Integral / Uso Sustentável (2) | 2.742 | 6,9 MB |

**As cores vieram dos arquivos `.xml` de estilo do projeto**, camada por camada: conferi as 163
cores do conjunto e **nenhuma difere** da cor do arquivo correspondente. Na Geologia os 197
nomes que não batem literalmente são a troca dos símbolos gregos (`NP3p_gamma_2Ipe` →
`NP3pγ2Ipe`), com a mesma cor.

### O peso de cada camada foi uma decisão, não um acidente

A origem tem **332 MB de geometria na Pedologia** e 49 MB nas Unidades de Conservação. A
simplificação é declarada **por camada no manifesto** (`"escala"`), porque "deixe os arquivos
leves" não é a mesma decisão para todas:

| Camada | Escala | Tol. no terreno | Vértices | Resultado |
|---|---|---|---|---|
| Geologia | 1:500.000 | 100 m | 152.093 | 5,6 MB |
| Geomorfologia | 1:500.000 | 100 m | 160.072 | 4,7 MB |
| Aquíferos | 1:500.000 | 100 m | 68.746 | 1,8 MB |
| Biomas | 1:500.000 | 100 m | 28.975 | 0,7 MB |
| Unidades de Conservação | 1:1.000.000 | 200 m | 198.429 | 6,9 MB |
| **Pedologia** | **1:2.000.000** | **400 m** | **444.019** | **19,5 MB** |

A tolerância é o que o olho não distingue no impresso (0,2 mm no papel). Acima de 400 m eu
estaria **inventando geometria**: a precisão posicional de um mapa de solos estadual é dessa
ordem. Por isso a Pedologia para aí — e é a camada mais pesada do portal.

**O que ainda dá para tirar da Pedologia**, se ela incomodar (números medidos):

- `DESCRIÇÃO` é **2,4 MB** dos 19,5 MB (37% de todos os atributos) — é texto longo de
  descrição da unidade de solo;
- os 17.026 polígonos são a maior parte do resto: a geometria é 12,9 MB, e mesmo sem
  simplificar mais, 17 mil polígonos fecham ~85 mil vértices só de fechamento de anel.

> **Conferência de área contra o dado do cliente.** A Pedologia traz o campo `area_ha` da
> origem. Somando as 17.030 feições: **250.348,6 km²** na origem, **249.513,5 km²** no portal —
> **−0,33%**. É a validação independente do cálculo de área (v2.5) sobre dado real, e mostra
> que a simplificação de 400 m não mexeu na área. A área do Estado de São Paulo é 248.219 km²;
> as duas somas ficam ~0,5% acima porque as associações de solo se sobrepõem em faixa.

**Nota de origem:** os `.shp.xml` das camadas são **modelos vazios** (só o texto "REQUIRED:"),
então não há citação oficial a extrair deles. A `fonte` de cada camada é descritiva e cada
entrada do manifesto termina com **CONFIRMAR a citação oficial e a data de referência**.

## Quilometragem: localizar um km (v2.7)

```
2 · Quilometragem
Suba a camada de km — os marcos com a coluna de km, ou o traçado da rodovia.
[ Carregar camada de km ]
rodovia.shp · 42 feições · marcos · coluna KM
Coluna do km  [ KM ▾ ]
[ 70+500        ] [ Localizar km ]

Entendi: km 70+500 (70,5 km). Localizado em km 70+500 (marco da camada).
23°21'04,2"S · 45°12'38,7"O
```

**O mesmo km se escreve de várias formas**, e o usuário digita como está acostumado:

| Digitado | Vale | Por quê |
|---|---|---|
| `70` | 70 km | inteiro |
| `70,5` · `70.5` | 70,5 km | separador decimal |
| `70,500` · `70.500` | 70,5 km | a forma que o cliente citou |
| `70+500` | 70,5 km | convenção de rodovia: depois do `+` são **metros** |
| `70+5` | 70,005 km | 5 metros |
| `70+500,00` | 70,5 km | a parte decimal dos metros é descartada |
| `KM 70+500` · `marco 70+500` | 70,5 km | com prefixo |
| `70.500,00` | 70,5 km | **forma mista**, ver abaixo |

**Formas mistas (dois separadores).** Vale a convenção brasileira (o último separador é o
decimal) — mas com uma **guarda de plausibilidade**: se o resultado passar de 5.000 km (mais
que a rodovia mais longa do Brasil), tenta-se a leitura alternativa. É o que faz `70.500,00`
valer 70,5 km em vez de 70.500 km. Se nenhuma leitura for plausível, o portal **recusa e
explica**, em vez de dar zoom num ponto que não existe.

**A interpretação aparece na tela antes do resultado** — quem digitou algo ambíguo vê o que o
portal entendeu e corrige, em vez de o mapa ir para um lugar sem explicação.

### A camada pode vir de dois jeitos

| Se o usuário subiu | O km é | Como o portal acha |
|---|---|---|
| **marcos** (pontos com coluna de km) | um atributo de cada ponto | o marco mais próximo do pedido, e diz a diferença (`a 100 m do pedido`) |
| **traçado** (a linha da rodovia) | a distância percorrida | caminha ao longo da linha, somando Vincenty por trecho (~1 m de precisão) |

O portal **decide sozinho** e diz qual usou — nenhuma pergunta a mais para o usuário. A coluna
do km é detectada pelo nome (`KM`, `QUILOMETRO`, `KM_INICIO`, `MARCO`…), sem confundir com
`LONGITUDE`, `CODIGO` ou `AREA_HA`, e o usuário pode trocar no seletor.

**Traçado dividido em trechos** é o caso comum (a rodovia vem em várias feições, em ordem
qualquer e às vezes invertidas). Os trechos são **encadeados** pela ponta mais próxima
(tolerância de 25 m), crescendo pelas **duas pontas** e invertendo o sentido quando preciso.
Trecho que não encaixa **não é inventado na sequência**: o portal avisa quantos ficaram de
fora — melhor dizer isso do que localizar o km no lugar errado.

> A primeira versão crescia só pela ponta final: se a semente fosse o trecho do meio, os
> anteriores não tinham por onde se ligar e ficavam de fora **em silêncio**. O teste que pegou
> isso monta dois trechos ligados ponta a ponta e exige que o km atravesse a emenda.

A camada de km **não entra no recorte** — ela serve para localizar, não é caracterização do
meio. O marcador da busca fica no mapa até a próxima, e o zoom vai a 1:2.000 (nível 15) ou
mantém o atual se já estiver mais perto.

## Editar a aparência (v2.6)

```
☑ 🟫 Geologia    2102 feições · 306 classes   ▲ ▼ ✏
   ┌──────────────────────────────────────────┐
   │ [Transparência] [Rótulo] [Linha]         │
   └──────────────────────────────────────────┘

🟥 AI-01 Fazenda São José   12.480,00 ha      ✏  remover
   ┌──────────────────────────────────────────┐
   │ Transparência  ──────●────  95%          │
   │ Cor ▉  Traço [Linear ▾]  ──────  2.4     │
   └──────────────────────────────────────────┘
```

O ícone é um **lápis** porque a ação é editar: transparência, rótulo e linha na camada;
transparência do preenchimento, cor, traço e grossura na área. O glifo usa a apresentação de
texto (`✏\uFE0E`) para não virar o emoji colorido no meio de uma lista densa.

**Área carregada vem com linha contínua.** Antes o portal já desenhava o limite tracejado por
conta própria; agora o padrão é o limite como ele é, e o tracejado fica a um clique — para
quem quer diferenciar o limite do estudo do dado do mapa por baixo. O preenchimento segue
quase transparente (6%), agora **ajustável**: havia caso de precisar realçar a área quando
ela é o assunto do mapa, e de sumir com ela quando atrapalha a leitura das camadas.

O botão **"Voltar ao padrão"** devolve linha contínua e 6% de preenchimento.

## A área da área de influência (v2.5)

O defeito, e por que passou tanto tempo despercebido:

```js
// math.js, como estava
function aneisDe(geometria) {
  if (geometria.type === 'Polygon')      return [geometria.coordinates];
  if (geometria.type === 'MultiPolygon') return geometria.coordinates;
  return [];        // ← FeatureCollection cai aqui, EM SILÊNCIO
}
```

O leitor de shapefile entrega um **`FeatureCollection`** — então `areaHectares` somava uma
lista vazia e a área saía **zero**. E área zero não parece um defeito, parece um arquivo
vazio: o polígono aparecia desenhado no mapa, com o rótulo "0,00 ha · 0,00 km²".

**Passou por 600 verificações porque o polígono DESENHADO na tela é uma geometria simples.**
Ele sempre mostrou a área certa. O erro só existia no caminho do arquivo, e nenhum teste
conferia área de arquivo — todos usavam geometrias montadas à mão.

O mesmo furo atingia mais dois pontos:

| Onde | O que acontecia |
|---|---|
| `recorte.aneisDaGeometria` | arquivo com **vários polígonos** (guardado como `GeometryCollection`) era recusado no recorte: *"não tem polígono válido"* |
| `math.linhasDe` / `pontosDe` | mesma regra, mesmo silêncio |

Agora `aneisDe`, `linhasDe` e `pontosDe` percorrem `Feature`, `FeatureCollection` e
`GeometryCollection` — a mesma regra que `percorrerCoords` (usado pelo `bbox`) já seguia.
A área é calculada sobre a **geometria que é desenhada e recortada**, e a lista mostra
quantos polígonos o arquivo tem.

**A conferência que faltava** (agora na suíte, e é ela que impede a volta do defeito): um
quadrado de **1 km × 1 km em UTM 23S** tem de dar **100,0000 ha** passando pelo caminho do
arquivo — importar, reprojetar e calcular. Dois quadrados separados, 200 ha.

> **Atenção a um caso:** se o arquivo trouxer polígonos **aninhados** (ADA dentro de AID
> dentro de AII, comum em EIA), a área mostrada é a **SOMA** deles e a parte interna conta
> duas vezes. O portal avisa isso na tela. Para o recorte, o efeito não existe — a área de
> influência é usada como molde.

## Linha: cor, traço e grossura (v2.4)

```
⚙ Geologia  →  [Transparência] [Rótulo] [Linha]
               Cor ▉  Traço [Tracejado ▾]  ────  3.0
```

| Controle | O quê |
|---|---|
| **Cor** | a cor do contorno (o arquivo de estilo da Geologia traz preto) |
| **Traço** | **Linear** (contínua) · **Tracejado** · **Pontilhado** · **Traço e ponto** |
| **Grossura** | de 0,5 a 12 px, em décimos |
| **Amostra** | o traço desenhado do jeito que vai sair — escolher pelo olho, não pelo nome |

O mesmo componente serve para o **contorno das camadas** (aba *Linha*) e para o **traço das
áreas de influência** (o ⚙ de cada área na lista). É o mesmo problema — aparência de
contorno, pensada para impressão — e uma implementação só evita que as duas telas divirjam.

**Por que existe:** a divisa entre unidades geológicas que se lê bem na tela desaparece num
mapa 1:5.000 impresso, e o traço da área de influência costuma ir **tracejado** para não
competir com o dado do mapa por baixo. Antes, as duas coisas eram fixas no código.

Dois detalhes que os testes garantem:

- **Grossura absurda não some com a linha.** Valor fora da faixa é trazido para 0,5–12; texto
  no lugar de número cai no padrão; cor inválida volta para o preto do arquivo. Um projeto
  salvo estranho não pode deixar o mapa sem contorno.
- **Trocar o traço não apaga a cor nem a grossura** — são três escolhas independentes.

O botão **"Voltar ao desenho do arquivo"** descarta a escolha e devolve o que veio no `.qml` /
`.xml` do shapefile. A escolha vai junto no projeto salvo.

## Ordem no mapa (v2.3)

```
☑ 🟫 Geologia    2102 feições · 306 classes   ▲ ▼ ⚙
   ☑ ⬛ Minhas áreas por cima das camadas
```

**Setas ▲▼** em cada camada: a de cima na lista desenha por cima. **⚙** abre os ajustes
(transparência e rótulo) daquela camada, recolhidos — abertos nas 9 camadas viravam 18
controles empilhados que escondiam a própria lista.

**"Minhas áreas por cima das camadas"** decide se as áreas de influência que você carrega
ficam acima de todas as camadas de caracterização ou abaixo de todas. E o recorte sai sempre
acima das camadas (é a resposta da análise) e abaixo dos rótulos.

### Por que isso virou número, e não ordem de inserção

No Leaflet, quem desenha por cima é **quem foi adicionado por último** — e `desenharCamadas()`
limpa o grupo e readiciona tudo a cada ajuste de transparência ou ao ligar outra camada. Com
isso, as camadas de caracterização subiam por cima das áreas de influência do usuário, e as
áreas "sumiam" sem ninguém ter pedido. Dependia de qual controle foi mexido antes.

Agora cada camada tem **o seu painel** (`pane-cam-<id>`) com z-index tirado da posição na
lista, calculado em `js/mapa.js` e testado. As faixas são calculadas a partir do número de
camadas para não colidir com os painéis do Leaflet:

| Faixa | z-index | O quê |
|---|---|---|
| `tilePane` | 200 | imagem de satélite |
| `pane-cam-*` | 400 + posição | camadas de caracterização (a última da lista por cima) |
| `pane-resultado` | 400 + n + 1 | o recorte |
| `pane-areas` | 400 + n + 2 | as áreas do usuário, se "por cima" (senão 399) |
| `markerPane` | 600 | os rótulos — texto tem de ficar acima de polígono |

## Carregar a área de influência (v2.2)

O botão **Carregar arquivos** aceita, em qualquer combinação:

| Envio | Como |
|---|---|
| **Shapefile** | selecione o `.shp` **junto** com o `.dbf` (e o `.prj`, `.cpg`) — um shapefile é um conjunto, não um arquivo |
| **ZIP** | compacte o conjunto; pode ter uma pasta dentro (é o que o Windows faz ao compactar) |
| **KMZ / KML / GeoJSON** | um arquivo só |

Três coisas que passaram a ser ditas em vez de acontecerem em silêncio:

1. **Só o `.shp` é aceito**, mas com aviso: a geometria entra e a **tabela de atributos fica vazia** — falta o `.dbf`. Para uma área de influência (que serve de molde de recorte) isso funciona; para conferir atributo, não.
2. **Sem o `.prj`**, o sistema de referência é **deduzido** das coordenadas e a tela diz que deduziu.
3. **Formato desconhecido** devolve o nome do arquivo recebido e o que fazer (selecionar o conjunto, ou compactar num `.zip`).

> O defeito que originou a v2.2: a função olhava só `arquivos[0]`. Quem selecionava o `.shp` com os companheiros — o gesto natural — tinha o `.shp` recusado como "formato não reconhecido": o portal recusava o formato que ele mesmo aceita.
>
> O despacho morava no `app.js`, que depende do DOM e do Leaflet para carregar, e por isso **não podia ser exercitado por teste nenhum**. Agora mora em `js/entrada.js` (entra arquivo, sai GeoJSON, sem DOM) e a suíte de fumaça cobre os seis casos: conjunto solto, `.shp` sozinho, ZIP, ZIP com subpasta, formato desconhecido e o `.prj` presente. De quebra, o ZIP da **exportação** de shapefile passou a ser testado na ida e na volta — o escritor de ZIP era uma cópia dentro do `app.js`, e a do módulo corrompia binário em silêncio.

> **Ao publicar uma versão nova, troque o `?v=` das tags do `index.html`** para o mesmo
> número do `VERSAO` do `app.js`. O teste de referências reprova a publicação se os dois
> estiverem diferentes — é o que impede a repetição do problema: o navegador do visitante
> fica com o JavaScript antigo e a tela mostra metade das funcionalidades novas.

## Transparência e rótulo por camada (v2.0)

Na lista de camadas, cada uma ganha dois controles:

```
☑ 🟫 Geologia     2102 feições · 306 classes
   Transparência [====|-----] 40%    Rótulo [ SIGLA_UNID ▾ ]
```

**Transparência** é o que permite ver a imagem de satélite (ou a camada de baixo) por baixo
de uma camada densa — sem ela, uma camada de 306 unidades cobre o mapa inteiro. O padrão de
cada camada vem do catálogo (`estilo.opacidade`); o ajuste da tela manda enquanto durar a
sessão e vai junto no projeto salvo.

**Rótulo** escolhe qual coluna escrever no mapa — a sigla da unidade, o nome, a classe. As
opções são os atributos da própria camada, com a coluna de classe primeiro. Três decisões
que vêm do tamanho do dado real:

1. **A posição do texto é calculada com `posicaoRotulo`, que garante ponto DENTRO da
   feição.** A média dos vértices cai fora em forma côncava (num "L", o centroide fica no
   quadrante que não existe) e o texto sairia sobre a unidade vizinha — num mapa geológico
   isso é pior que não ter rótulo, porque afirma a unidade errada no lugar errado.
2. **Só rotula o que está na tela.** A Geologia tem 2.102 feições: rotular todas criaria
   2.102 elementos no DOM e travaria o navegador — e seria ilegível, porque num estado
   inteiro os polígonos têm poucos pixels. A lista se refaz ao mover e ao ampliar.
3. **Teto de 220 rótulos por vez**, com aviso do que ficou de fora. Aproximar o zoom mostra
   os outros.

O texto sai com contorno branco (legível sobre satélite e sobre polígono escuro) e é
desenhado por cima de tudo — texto embaixo de polígono não se lê. Os rótulos não capturam
clique: o popup da feição continua abrindo.

## Escolher as colunas de agrupamento (v1.6)

Na aba **Resultado → Tabela** aparece o bloco **Agrupar por**, com um seletor por camada do
resultado. O padrão é o campo de classe do catálogo; o usuário pode escolher **uma ou mais
colunas** — e a tabela, os gráficos e o relatório passam a somar por essa combinação.

Exemplo: escolhendo `NOME_UNIDA` e `LITOTIPO1` (Ctrl para marcar as duas), cada linha passa a
ser uma combinação — *"Granito · biotita granito"*, *"Xisto · (vazio)"* — em vez de uma linha
por unidade litológica.

Por que isso é barato de fazer: **o recorte já guarda todos os atributos originais** de cada
feição, então trocar o agrupamento não exige recortar de novo — a chave é recalculada na hora.
E por que importa: a pergunta da análise muda no meio do trabalho ("e se eu abrir por
litotipo?") e ter de reeditar o catálogo e reimportar a camada seria inviável.

Quatro decisões que valem saber:

1. **O mapa não muda de cor.** A cor continua vinda do campo de classe do catálogo, que é a
   definição cartográfica da camada (as cores do ArcGIS, no caso da Geologia). O agrupamento é
   da tabela, do gráfico e do relatório. No gráfico, a barra recebe a cor da **classe de mapa
   dominante** dentro do grupo, para o gráfico e o mapa lerem na mesma cor.
2. **Nada de área se perde.** Agrupar é repartir: o teste confere que a soma das linhas continua
   igual à soma das feições, em qualquer agrupamento — é a invariante que pega erro.
3. **Valor vazio vira `(vazio)`, não desaparece.** Se a coluna escolhida não existe na camada,
   todas as feições caem em `(vazio)` em vez de a tabela sair vazia em silêncio.
4. **O relatório declara o agrupamento.** Os totais por área de influência não mudam, mas a
   soma dentro de cada camada muda — e um número sem a pergunta ao lado não se sustenta.


Portal estático para estudo de impacto ambiental: carrega as **áreas de influência** (SHP, KMZ,
GeoJSON ou desenho na tela), **recorta** as camadas de caracterização dos meios físico, biótico e
socioeconômico, e devolve **dado** (GeoJSON, shapefile, KMZ), **tabela**, **gráficos**,
**mini-relatório** e **mapa** com layout padrão e articulação em 1:5.000.

Não tem servidor, não tem banco, não tem login. Tudo roda no navegador e o resultado é arquivo
para baixar. O que não é cálculo geométrico é interface.

---

## O que ele faz

| Etapa | O que acontece |
|---|---|
| **Áreas de influência** | Upload de SHP (soltos ou em ZIP), KMZ, KML ou GeoJSON. O `.prj` é lido e o dado é reprojetado para WGS 84. Sem `.prj`, o portal avisa antes de calcular. Também dá para desenhar a área no mapa. |
| **Camadas** | Catálogo em `data/catalogo.json`, com os três meios. Cada camada carrega sob demanda (nada de 50 MB no carregamento inicial). |
| **Recorte** | Matriz áreas × camadas. Interseção (dentro) ou diferença (fora). Polígono é recortado na borda, linha é cortada no cruzamento, ponto é selecionado por localização. |
| **Colunas de resultado** | Toda feição recortada recebe `eia_ai`, `eia_camada`, `eia_meio`, `eia_classe`, `eia_area_ha`, `eia_area_orig_ha`, `eia_pct_ai`, `eia_pct_feicao`, `eia_compr_km`, `eia_metodo`, `eia_fonte`, `eia_data_ref`. |
| **Exportação** | GeoJSON (um arquivo ou coleção), shapefile (um por camada, dentro de um ZIP), KMZ, XLSX e CSV. |
| **Tabela e gráficos** | Área por classe, área × camada, atributos das feições. Gráfico de barras, pizza e comparativo entre áreas, exportáveis em PNG e SVG. |
| **Relatório** | Texto-base gerado a partir dos números (com a ressalva e a metodologia) e PDF do mini-relatório com tabela e gráficos. |
| **Mapa** | Layout padrão (moldura, cabeçalho com logos, legenda, escala gráfica, norte, grade de coordenadas, fonte e responsável técnico) em A4…A0. PDF e PNG. |
| **Articulação** | Em 1:5.000 ou menos: o portal calcula a grade de folhas, numera, gera o mapa-índice e o PDF com todas as folhas. |
| **Projeto** | Salva tudo (áreas, recortes, layout, logos) em `.eiaproj.json` e reabre depois. |

---

## Colocar a SUA base no portal (base fixa)

Este é o ponto que faz o portal ter valor: a base de caracterização fica **dentro do portal**,
reunida e pronta. Quem abre a página já encontra as camadas, sem precisar subir nada.

A base não é um banco de dados — é o conteúdo de `data/`:

```
data/
├─ catalogo.json          ← lista das camadas que a tela mostra (o portal lê este arquivo)
├─ camadas-fonte.json     ← manifesto: de qual shapefile cada camada veio
├─ geologia.geojson       ← as camadas em si
└─ uso-do-solo.geojson
```

Ou seja: para a camada ficar fixa, ela precisa **existir em `data/`** e **estar declarada no
`catalogo.json`**. O `tools/importar_camadas.js` faz os dois a partir dos seus shapefiles.

### O fluxo, em 3 comandos

**1. Gerar o rascunho do manifesto** a partir da sua pasta de shapefiles:

```bash
node tools/importar_camadas.js --rascunho "C:\minha\base"
```

Ele varre a pasta (e as subpastas), acha cada `.shp` e cria o `data/camadas-fonte.json` com uma
entrada por camada, já adivinhando o nome, o meio (físico/biótico/socioeconômico) pelo nome do
arquivo e o campo de classe pelo `.dbf`:

```
Rascunho do manifesto em data\camadas-fonte.json
2 camada(s) encontrada(s):
  Geomorfologia Teste             meio: fisico   classe: FORMA
  Uso Teste                       meio: biotico   classe: CLASSE
```

**2. Abrir o `data/camadas-fonte.json` e conferir.** O arquivo tem as instruções no topo. O que
importa preencher:

```json
{
  "destino": "data",
  "camadas": [
    {
      "origem": "C:/minha/base/geologia.shp",
      "id": "geologia",
      "arquivo": "data/geologia.geojson",
      "nome": "Geologia",
      "meio": "fisico",
      "campo_classe": "UNIDADE",
      "fonte": "CPRM — carta geológica 1:50.000",
      "data_ref": "2024",
      "epsg_origem": "auto"
    }
  ]
}
```

- **`meio`** é obrigatório: `fisico`, `biotico` ou `socioeconomico`. É o que agrupa as camadas na tela.
- **`campo_classe`** é o campo que agrupa as feições (uso do solo, unidade geológica...). É por ele
  que a tabela, os gráficos e as cores do mapa são montados. Em dúvida, use o `--inspecionar`.
- **`fonte`** e **`data_ref`** aparecem na tela, no relatório e no mapa. Preencha com a fonte real —
  é o que sustenta o número no estudo.
- **`epsg_origem`**: `"auto"` lê o `.prj`. Se o shapefile não tiver `.prj`, informe o código
  (ex.: `"EPSG:31983"`), senão o importador se recusa a converter — e está certo em se recusar.

**3. Importar:**

```bash
node tools/importar_camadas.js                      # escala padrão: 1:50.000
node tools/importar_camadas.js --escala 10000       # mais detalhe
node tools/importar_camadas.js --simular            # mostra o que faria, sem escrever
```

Saída:

```
Importando 2 camada(s) — escala alvo 1:10.000, tolerância 2 m no terreno
  · Geomorfologia Teste … 120 feições, 6.000 vértices, 151 KB (0.1 s)

camada                      meio               feições   vértices (antes→depois)       SHP    GeoJSON
-----------------------------------------------------------------------------------------------------
Geomorfologia Teste         fisico                 120            19.320 → 6.000    308 KB     151 KB
-----------------------------------------------------------------------------------------------------
publicado em data/: 301 KB   ·   vértices: −69%
catálogo: 0 camada(s) nova(s), 2 atualizada(s), 9 preservada(s)
```

**4. Publicar** (a base vira fixa no portal):

```bash
git add data/
git commit -m "Base de caracterizacao: 2 camadas"
git push
```

A Vercel republica sozinha em ~30 segundos.

### O que o importador resolve por você

| Problema | O que ele faz |
|---|---|
| `.shp` + `.dbf` + `.prj` + `.cpg` separados | Junta os quatro, lê a codificação do `.cpg` (acento não vira "JoÃ£o") |
| Coordenada em UTM (metros) | Lê o `.prj` e reprojeta para graus (WGS 84), que é o que o portal usa |
| **Camada pesada** | **Simplifica a geometria** — 30–100 MB viram alguns MB |
| Coordenada com 15 decimais | Arredonda para 6 casas (~11 cm) e remove vértice repetido |
| Muitas classes sem cor | Sorteia uma cor por classe, para o mapa não ficar de uma cor só |
| Não sei qual campo é a classe | Sugere o campo com menos valores distintos cujo nome combina com classe/uso/tipo/unidade |

### A simplificação: por que e quanto

Um shapefile de 100 MB vira GeoJSON de centenas de MB e **trava qualquer navegador** — foi
exatamente o defeito nº 1 apontado na auditoria do portal atual (uma camada de hidrografia de
53 MB). Então a importação simplifica por padrão, com um critério técnico e não um chute:

> **0,2 mm no papel** — abaixo disso o olho não distingue no impresso.

| `--escala` | Tolerância no terreno | Para que serve |
|---|---|---|
| `--escala 5000` | ~1 m | mapa articulado em 1:5.000 |
| `--escala 10000` | ~2 m | mapa em 1:10.000 |
| `--escala 50000` | ~10 m | **padrão** — mapa em 1:50.000 |
| `--escala 250000` | ~50 m | mapa de contexto regional |

Se precisar do dado intacto (para calcular, não para desenhar), use `--sem-simplificar` — ele
ainda arredonda e limpa, mas não remove vértice. E `--tolerancia 0.0001` força um valor exato.

A simplificação compensa a distorção da longitude (`cos(latitude)`): a −22°, 1 grau de longitude
mede ~103 km contra ~111 km de latitude, e sem essa correção o traço cortaria demais no sentido
leste–oeste.

### As cores das camadas (simbologia)

**As cores não ficam dentro do shapefile.** O SIG grava um arquivo de estilo ao lado dele, e o
importador procura esse arquivo e aproveita o que der:

| Arquivo | De onde vem | O importador lê? |
|---|---|---|
| `<camada>.qml` | QGIS (Salvar estilo → QGIS Layer Style File) | ✅ cor de **cada classe** + campo de classe + opacidade |
| `<camada>.xml` | estilo do QGIS / complemento SLYR (`<qgis_style>` com símbolos **nomeados pela classe**) | ✅ cor de cada classe (o nome do símbolo é a classe) |
| `<camada>.sld` | OGC / GeoServer | ✅ cor de cada classe + campo de classe |
| `<camada>.lyrx` | ArcGIS **Pro** (Salvar como Layer File) | ✅ cor de cada classe + campo de classe |
| `<camada>.lyr` | ArcGIS **Desktop** | ❌ **binário** — só o CRS e o nome da rampa são texto |
| `<camada>.shp.xml` | metadados ESRI | ✅ título, fonte e data viram `fonte` e `data_ref` |

> O formato `<camada>.xml` (`<qgis_style><symbols><symbol name="CLASSE">`) é o que resolveu
> o caso real da Geologia: o `.lyr` do ArcMap é binário, mas o estilo exportado do projeto
> traz os símbolos **nomeados pelo valor da classe**, com a cor de cada um. Foram assim que
> as **306 unidades litológicas** receberam as cores do mapa do cliente — 306 de 306, sem
> sobrar nenhuma para a paleta automática.
>
> Desse mesmo arquivo sai também o **contorno** de cada unidade — a divisa que separa as
> unidades e que, num mapa geológico de 306 unidades, é o que impede que ele vire uma
> aquarela. Pegadinha do formato, que vale registrar: no QGIS **`outline_width = 0` não
> significa "sem contorno"** — significa fio de cabelo. Eu li como ausência e concluí errado;
> o mapa do cliente mostrou a divisa preta. E quando o preenchimento traz
> `outline_style="no"` **com** uma `outline_color` definida, essa cor está desligada — o
> contorno real vem de uma segunda camada (`SimpleLine`). Ler a cor do preenchimento ali
> pintaria uma divisa que o mapa não tem.
>
> Cuidado com a confusão de nome: `<camada>.xml` é **estilo**; `<camada>.shp.xml` é
> **metadado**. São arquivos diferentes e o importador trata cada um no seu papel.

Quando o estilo é lido, o `--rascunho` já preenche o campo de classe **e** a cor de cada classe, e
o `--inspecionar` mostra o que achou:

```
  campo de classe sugerido: FORMA   (arquivo de estilo)
  arquivo de estilo: geologia.qml  (categorizado)  8 cores por classe
```

E o mapa do portal passa a pintar **cada classe com a cor do seu SIG**, na legenda e no PDF.

#### Se o seu estilo for `.lyr` (ArcGIS Desktop)

O `.lyr` é formato binário fechado: as cores ficam em bytes, não em texto. O importador **não
inventa** cor a partir de binário não verificado — pintar o mapa do cliente com cor errada é pior
que não pintar. Você tem três caminhos:

1. **ArcGIS Pro:** abra a camada e faça *Salvar como Layer File* → gera `.lyrx`, que é JSON e o
   importador lê por completo.
2. **QGIS (gratuito):** abra o mesmo `.shp`, aplique *Categorizado* no mesmo campo, escolha as cores
   (ou copie os RGB do ArcGIS) e use *Salvar estilo → QGIS Layer Style File* → gera `.qml`.
3. **Preencher à mão:** o próprio manifesto tem o campo `cores_classe`, com a lista de classes já
   preenchida pelo `.dbf`. É trocar os códigos hexadecimais:

```json
"campo_classe": "SIGLA_UNID",
"cores_classe": {
  "NP3p_gamma_2Ipe": "#c8a165",
  "NP3s_gamma_1Ibb": "#7a4f8a",
  "Q1c": "#2f5b8a"
}
```

Sem nada disso, a camada entra com a **paleta automática** do portal (uma cor por classe), e o
`--inspecionar`/importação dizem isso claramente em vez de fingir que leram o estilo.



Para decidir o campo de classe e conferir o que veio:

```bash
node tools/importar_camadas.js --inspecionar "C:\minha\base\geologia.shp"
```

```
geologia.shp  (poligono)
  feições: 120   vértices: 19.320
  geometrias: Polygon (120)
  CRS: EPSG:4326   codificação: utf-8
  aviso: Coordenadas em graus — WGS 84 (graus) (declarado no .prj).
  extensão: -47.75265, -22.85270, -47.61535, -22.73951
  campo de classe sugerido: FORMA
  meio sugerido: fisico
  campos:
    ID                N   distintos: >40
    FORMA             C   distintos: 3
```

### Nomenclatura: as palavras que representam símbolos

O `.dbf` é um formato antigo, preso a uma página de código que **não comporta** `γ`, `δ`, `β`,
`λ`, `μ` nem o `Є` do Cambriano. Quem gerou o mapa escreveu as palavras no lugar — e é isso
que aparece na tabela, na legenda e nos rótulos:

```
NP3p_gamma_2Ipe          ->  NP3pγ2Ipe
K1_beta_sg               ->  K1βsg
K1_delta_sg              ->  K1δsg
K1_lambda_ja             ->  K1λja
C_cortado_1a_gamma_4Igt  ->  Є1aγ4Igt      (C cortado = Є, o símbolo do Cambriano)
NP3_C_cortado_1e         ->  NP3Є1e
```

A troca é declarada no manifesto e feita **no dado**, uma vez — então vale para a tabela, a
legenda, o rótulo no mapa, o relatório e o arquivo exportado:

```json
"substituicoes": {
  "_C_cortado_": "Є", "C_cortado_": "Є",
  "_gamma_": "γ", "_gamma": "γ",
  "_delta_": "δ", "_delta": "δ",
  "_beta_": "β",  "_beta": "β",
  "_lambda_": "λ", "_lambda": "λ",
  "_mu_": "μ",   "_mu": "μ"
}
```

Três detalhes que o formato exige e que estão testados:

1. **O sublinhado no padrão é o que separa símbolo de palavra comum.** `_beta` troca
   `K1_beta_sg`, mas deixa **"Betari"** (nome de unidade) intacto. O mesmo para **"Leque
   Deltaico"** (ambiente sedimentar), **"Muscovita"** (mineral) e **"metavulcânica"**.
2. **A ordem das chaves importa:** `_gamma_` antes de `_gamma`, senão sobra sublinhado órfão
   (`Є1aγ_4Igt` em vez de `Є1aγ4Igt`). A forma com os dois sublinhados cobre o meio do código;
   a forma solta cobre o fim (`NP3e_gamma` → `NP3eγ`).
3. **A paleta é re-chaveada junto.** As cores do `estilo` e o `cores_classe` do manifesto
   estão nomeados com o valor antigo (`NP3p_gamma_2Ipe`); sem trocar as chaves também, nenhuma
   cor casaria com nenhuma classe e o mapa inteiro cairia na cor de reserva.



O portal é do **Estado de São Paulo**, e a cobertura não está no código — está no catálogo,
para o mesmo programa servir outro estado sem alteração:

```json
// data/catalogo.json
"cobertura": "Estado de São Paulo",
"extensao_inicial": [-53.10530, -25.30832, -44.16996, -19.78756]
```

`extensao_inicial` é `[oeste, sul, leste, norte]` em graus: é o enquadramento com que o mapa
abre. Sem ele, o portal usa o retângulo de São Paulo como padrão.

**Para replicar em outro estado:** importe as camadas daquele estado, troque `cobertura` e
`extensao_inicial` no `catalogo.json` e publique. É o único passo — e existe por um motivo
concreto: o mapa abria fixo em Piracicaba no zoom 10, e com isso uma camada estadual de
920 km **parecia cortada**, porque só ~40 km cabiam na tela. Enquadramento é dado do
projeto, não constante de programa.


Aceita também uma pasta inteira (inspeciona todos os `.shp` de uma vez).

### O que o importador NÃO lê

| Formato | O que fazer |
|---|---|
| File Geodatabase (`.gdb`) | QGIS → botão direito na camada → Exportar → Salvar feições como → **ESRI Shapefile** |
| GeoPackage (`.gpkg`) | Mesmo caminho: exportar para shapefile |
| KML / KMZ | QGIS converte para shapefile; ou use o botão de upload do portal, que lê KMZ no navegador |
| GeoTIFF / raster | Fora do escopo: o portal trabalha com camada vetorial (polígono, linha, ponto) |

### Dois avisos

**Tamanho do repositório.** Base grande dentro do Git faz o clone ficar pesado (o GitHub reclama
acima de ~1 GB, e cada `git push` reenvia o histórico). Se a sua base passar de ~300 MB publicada,
vale considerar Git LFS ou servir os `.geojson` de outro lugar. O importador avisa quando uma
camada passa de 8 MB depois de simplificada.

**O manifesto guarda caminhos da sua máquina.** O `data/camadas-fonte.json` aponta para
`C:\minha\base\...`. Isso é o que torna a base reprodutível (você roda de novo e ele refaz), mas
significa que outra pessoa não consegue reimportar sem os shapefiles originais. Os `.geojson` já
publicados em `data/` são o que o portal usa — o manifesto é só para você.

**O `gerar_amostra.js` fica bloqueado depois que você importar.** Ele reescreveria o catálogo com
as camadas de exemplo e tiraria as suas da lista; por isso ele aborta e avisa. Se quiser mesmo
voltar para as camadas de exemplo, rode com `--forcar`.

---

## Como rodar localmente

O portal precisa de um servidor HTTP (usa `fetch` para o catálogo). Qualquer um serve:

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

Depois abra `http://localhost:8080`.

Para testar de imediato: clique em **Carregar arquivos** em "Áreas de influência" e escolha
`data/areas-influencia-exemplo.geojson` (vêm duas áreas fictícias prontas). Ligue as camadas e
clique em **Recortar camadas pelas áreas**.

> As camadas marcadas como `EXEMPLO SINTÉTICO` no catálogo são de mentira, e dizem isso na tela.
> Limite municipal, zoneamento e hidrografia são dado real do projeto. Substitua os exemplos por
> dado oficial antes de usar em estudo — e troque o conteúdo de `data/` pelo seu.

---

## Publicar no GitHub e na Vercel (repositório novo)

```bash
cd portal-eia-rima
git init
git add .
git commit -m "Portal EIA/RIMA: recorte, tabela, relatório e mapa articulado"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/portal-eia-rima.git
git push -u origin main
```

Na Vercel: **Add New → Project → Import Git Repository**, escolha o repositório e publique. O
`vercel.json` já traz `outputDirectory: "."` e os cabeçalhos de cache e segurança. Como é site
estático, não há build nem variável de ambiente.

Depois do primeiro deploy, para publicar alterações basta `git push` — a Vercel reimplanta sozinha.

---

## Estrutura

```
portal-eia-rima/
├─ index.html            interface única
├─ style.css
├─ app.js                amarra a interface ao motor (nenhum cálculo ambiental aqui)
├─ vercel.json
├─ ARQUITETURA.md        plano, decisões, riscos e fases
├─ js/
│  ├─ math.js            UTM (Krüger), área geodésica, comprimento, formatação
│  ├─ vetorial.js        recorte: interseção e diferença, linhas, pontos, validação
│  ├─ crs.js             .prj, EPSG, transformação entre sistemas
│  ├─ shapelib.js        leitura/escrita de .shp/.dbf/.prj/.cpg e ZIP
│  ├─ kml.js             KML e KMZ (ler e escrever)
│  ├─ recorte.js         motor áreas × camadas → camadas derivadas + relatório
│  ├─ tabela.js          agregação, conferência de fechamento, dados de gráfico
│  ├─ svg.js             barras, pizza, escala gráfica, norte, legenda
│  ├─ pdf.js             gerador de PDF (folhas, texto, vetor, JPEG)
│  ├─ relatorio.js       redação a partir dos números + PDF do relatório
│  ├─ mapa.js            layout padrão, escala, articulação, mapa-índice
│  └─ xlsx.js            planilha .xlsx e CSV
├─ data/                 catálogo e camadas (troque pelo seu dado)
├─ tools/
│  ├─ importar_camadas.js  ← leva a SUA base de shapefiles para data/
│  ├─ gerar_amostra.js     monta as camadas de exemplo a partir do dado real
│  ├─ servidor.js          servidor estático para testar localmente
│  ├─ verificar.js         roda todas as verificações
│  └─ verificacoes/        testes (Node, sem navegador)
└─ vendor/               Leaflet e Turf (locais, sem CDN)
```

---

## Verificações

```bash
node tools/verificar.js          # todas as suítes
node tools/verificar.js 2000     # oráculo com 2000 polígonos aleatórios
node tools/verificacoes/verificar_math.js   # uma suíte só
```

| Suíte | O que prova |
|---|---|
| `math` | UTM ida e volta, área de controle, UTM × geodésica, comprimento, formatação |
| `vetorial` | Interseção, diferença, contenção, furo, côncavo, rotacionado, linhas, pontos |
| `formatos` | SHP/DBF/KML/KMZ ida e volta **e o layout conferido contra a especificação ESRI** |
| `saidas` | Tabela, conferência de fechamento, CSV, XLSX, relatório, PDF, escala e articulação |
| `importador` | Simplificação de camada pesada, detecção de campo de classe, catálogo, erros explicados |
| `simbologia` | Leitura de `.qml`, `.sld`, `.lyrx`; recusa honesta do `.lyr`; metadados do `.shp.xml` |
| `sintaxe` | Compila todo arquivo servido e confere as referências do HTML e os ids usados |
| `integracao` | Fluxo completo sobre os arquivos reais de `data/`, com PDF de amostra |
| `fumaca` | Módulos no `window` falso, na mesma ordem do HTML, com o fluxo completo |
| `oraculo` | Compara o recorte com o Turf em polígonos aleatórios (área a área) |

> A suíte `formatos` merece uma nota. Um teste de **ida e volta** não prova formato: se o escritor e
> o leitor erram os mesmos bytes, o dado volta certo e o arquivo sai inválido para o QGIS. Foi o que
> aconteceu — o `NumParts` era gravado 4 bytes antes do lugar, **dentro do `double` do `Ymax`**.
> O teste passava e o shapefile exportado estava corrompido. A suíte agora lê e escreve os campos
> com `DataView` cru, nos deslocamentos da especificação, **sem passar por nenhuma função do
> portal**. Esse defeito só apareceu ao rodar o importador num shapefile de verdade, feito no
> ArcGIS — que é o motivo de existir o passo de validar com dado real.

O PDF de amostra sai em `tools/verificacoes/_amostra-mapa.pdf`.

---

## Decisões que valem registrar

- **Área sempre em projeção.** Área de polígono em graus não tem significado físico. Todo hectare
  sai de UTM (SIRGAS 2000 / EPSG:31983 em São Paulo), conferido contra área geodésica — as duas
  rotas concordam em menos de 1%, e a diferença aparece no relatório.
- **Recorte com biblioteca + motor próprio.** O clip de polígonos usa o Turf (já vendorizado no
  projeto, baseado na polygon-clipping) e o resultado passa por uma peneira geométrica; existe um
  motor de travessia de face planar como reserva, exercitado pelo teste de oráculo. Foi a forma de
  ter o caso côncavo correto sem depender de uma única implementação.
- **Escala é norma, não valor livre.** A lista de escalas é fechada (1:1.000 … 1:100.000).
- **Articulação é layout, não dado.** A mesma camada aparece em várias folhas; o que muda é o
  enquadramento da folha.
- **Camada de exemplo se declara exemplo.** O campo `fonte` diz "EXEMPLO SINTÉTICO" e a interface
  mostra isso — camada de mentira sem aviso é pior que não ter exemplo.

Limitações conhecidas e o que ficou para a próxima fase estão em [ARQUITETURA.md](ARQUITETURA.md)
(seção 8, riscos, e seção 9, fases): raster (declividade real, uso do solo por pixel), DOCX do
relatório e cache de tiles para uso offline.

---

## Ressalva

O portal quantifica; não substitui a análise técnica. Os números dependem da qualidade e da
atualidade das camadas carregadas — cujas fontes ficam declaradas em cada tabela — e o responsável
técnico deve conferir recortes, legenda e enquadramento antes de assinar o estudo.
