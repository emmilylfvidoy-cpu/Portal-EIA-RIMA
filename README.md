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

### A área de cobertura do portal (São Paulo hoje, outro estado depois)

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
