# Portal EIA/RIMA — Plano e arquitetura (v1)

**Projeto:** `portal-eia-rima` — aplicação estática, sem backend, publicável em Vercel.
**Base reaproveitada:** `MVP-geoportal-Piracicaba-main` / `_geopira` (Leaflet + Turf locais, importação KML/KMZ própria, `vercel.json` com cache por pasta, dados em `data/*.geojson`).
**Data:** v1 — arquitetura + primeiro MVP funcional na mesma entrega.
**Restrições assumidas:** tudo roda no navegador (opção 1 escolhida); repositório e projeto Vercel novos.

---

## 1. O problema e a resposta

O EIA/RIMA exige, para cada meio (físico, biótico, socioeconômico), quantificar **o que existe dentro de cada área de influência** (ADA, AID, AII, área diretamente afetada, faixa de servidão, bacia de contribuição) e transformar isso em tabelas, gráficos, mapas e texto de relatório.

Hoje isso é feito à mão em QGIS/ArcGIS: recorte, cálculo de área, exportação de tabela, montagem de layout. É repetitivo, sujeito a erro e lento quando o projeto tem 30 camadas e 4 áreas de influência.

O portal resolve a parte repetitiva:

| Etapa manual no SIG | No portal |
|---|---|
| Recortar 30 camadas por 4 áreas de influência | Um clique: matriz áreas × camadas |
| Calcular área de cada feição recortada | Coluna `area_ha` calculada automaticamente |
| Exportar shapefile/GeoJSON de cada recorte | Download em GeoJSON, SHP (ZIP) e KMZ |
| Montar planilha | Tabela na tela + XLSX/CSV |
| Fazer gráficos | Barras/pizza por classe, gerados dos mesmos números |
| Escrever o texto descritivo | Mini-relatório com redação-base a partir da tabela |
| Montar layout de mapa | Compositor com layout padrão, logos, escala e folha |
| Mapa articulado em 1:5.000 | Geração automática da grade de folhas + índice |

---

## 2. Decisões de arquitetura

| # | Decisão | Por quê |
|---|---|---|
| D1 | **100% cliente**, sem backend | Mantém o custo zero do Vercel estático, funciona em notebook de campo sem internet, e não expõe dado de cliente em servidor de terceiro. Toda a geometria roda em JS. |
| D2 | **Zero dependências de npm em runtime** — Leaflet e Turf vendorizados, o resto é código próprio | O `_geopira` já provou que funciona; evita quebra de CDN e mantém o bundle auditável. Onde faltava biblioteca (SHP, PDF, ZIP), foi escrito um leitor/gerador mínimo. |
| D3 | **Geometria própria em `js/`**, espelhada como módulo Node | Os mesmos arquivos rodam no navegador (`window.EIA.*`) e no Node (`require`), o que permite teste automatizado do recorte sem abrir navegador. |
| D4 | **Camadas em `data/*.geojson`** (um arquivo por camada + `catalogo.json`) | Simples de versionar no Git, o Vercel já cacheia `/data/*`. Substitui o padrão `data/*.js` do `_geopira`, que obriga o navegador a *parsear JavaScript* de 50 MB. |
| D5 | **Cálculo de área em projeção local (UTM 23S, EPSG:31983), não em graus** | Área de polígono em graus não tem significado físico. A projeção é calculada em código (`js/crs.js`), sem dependência de `proj4`. |
| D6 | **PDF gerado em código (`js/svg.js` → `js/pdf.js`)** | Permite montar folha A4…A0, com imagem do mapa em JPEG, tabela e textos vetoriais, sem biblioteca externa e sem servidor de impressão. |
| D7 | **Articulação como *folhas nomeadas + índice***, não como recorte do dado | A articulação é um problema de **layout**, não de dado: o mesmo recorte aparece em várias folhas. O motor calcula a grade, desenha o índice com a posição da folha e imprime a folha correspondente. |

### O que **não** entra na v1

- Mapa de fundo offline (tiles exigem internet; avisado na interface).
- Geoprocessamento raster (NDVI, declividade, uso do solo por pixel) — v2, via `geotiff.js`.
- Curvas de nível, MDE, hipsometria — v2.
- Autenticação, multiusuário, banco de dados — v2 se houver necessidade de repositório de processos.
- Edição colaborativa e versionamento de recortes.

---

## 3. Escopo funcional

### F1 — Catálogo de camadas (meios físico, biótico, socioeconômico)
- Três grupos fixos, cada um com N camadas, definidas em `data/catalogo.json`.
- Por camada: `id`, `nome`, `meio`, `tipo` (polígono, linha, ponto), `arquivo`, `campos`, `estilo` (cor, preenchimento), `fonte`, `data_ref`, `obs`.
- Ligar/desligar, opacidade, reordenar (z-index), enquadrar, ver legenda por classe.
- Cada camada carrega **sob demanda** (`fetch`) — nada de 50 MB no carregamento inicial.

### F2 — Upload do usuário
- **Shapefile** (`.shp` sozinho, `.zip` com `.shp/.dbf/.prj/.cpg`, ou seleção múltipla dos 4 arquivos).
- **KMZ/KML** (reaproveitando o extrator ZIP + `DecompressionStream` do `kml-import.js`).
- **GeoJSON**.
- O que sobe é tratado como **área de influência** (ADA/AID/AII) ou como camada temporária do usuário.
- Reprojeção automática para WGS 84 lendo o `.prj` (ou escolha manual do EPSG).
- Validação: anel fechado, orientação, auto-interseções, número de vértices, feições inválidas.

### F3 — Recorte (clip) por áreas de influência
Matriz `áreas de influência × camadas`:
- Para cada par, uma das operações: **interseção** (recorta), **diferença** (exclui), **seleção por localização** (mantém inteira a feição que toca).
- Saída: uma **camada derivada** por par, com os atributos originais preservados + colunas novas:
  `ai_nome`, `camada`, `area_ha`, `area_original_ha`, `pct_da_ai`, `pct_da_feicao`, `comprimento_km` (linhas), `n_vertices`, `metodo`, `data_ref`.
- Regras: feições parcialmente fora são recortadas; linhas são cortadas nas bordas; pontos são selecionados por localização.
- Relatório do processo: quantas feições entraram/saíram/foram divididas, tempo, avisos de geometria inválida.

### F4 — Exportação do dado recortado
- **GeoJSON** (um arquivo por camada derivada, ou coleção única).
- **Shapefile** — `.shp` + `.dbf` + `.prj` + `.cpg` escritos em código, empacotados em ZIP.
- **KMZ** (KML compactado, com `deflate-raw`).
- **CSV/XLSX** da tabela de atributos.

### F5 — Tabela, gráficos e mini-relatório
- Tabela na tela (por área de influência e por camada), ordenável, com totais.
- Gráficos: barras (área por classe dentro da AI), pizza (participação das classes), barras comparativas (mesma classe entre ADA/AID/AII), todos em SVG próprio, exportáveis em PNG/SVG.
- **Mini-relatório** em PDF (e DOCX/XLSX na v2): identificação do projeto, metodologia, tabela, gráficos e parágrafos descritivos gerados a partir dos números (ex.: "A classe *Pastagem* ocupa 412,37 ha, correspondendo a 38,4% da Área Diretamente Afetada").

### F6 — Compositor de mapa
- Layout padrão com moldura dupla, cabeçalho (logos + nome do projeto), área do mapa, legenda, escala gráfica e numérica, norte, grade de coordenadas, rodapé com fonte/datum/data e numeração da folha.
- O usuário escolhe: **folha** (A4/A3/A2/A1/A0, retrato/paisagem), **escala** (1:5.000 … 1:250.000, ou livre), **logos** (upload, canto configurável), **nome do projeto** e textos, **título do mapa**, posição da legenda.
- Pré-visualização fiel na tela (mesma geometria do PDF) e exportação **PNG** e **PDF** na resolução da folha.
- Enquadramento automático pela extensão da área de influência ou por retângulo desenhado.

### F7 — Mapa articulado (1:5.000 e menores)
- Dado `escala`, `folha` e a extensão do projeto, o motor calcula a **grade de folhas** com sobreposição configurável e nomes no padrão `PROJ-01/24`, `PROJ-02/24`…
- Gera: (a) o **mapa-índice** com a grade e a folha destacada; (b) cada folha individualmente; (c) todas em um PDF único.
- Aviso de coerência: escala 1:5.000 em A4 não comporta legenda legível — o portal recomenda A1/A0 e informa a área coberta por folha.

### F8 — Projeto (salvar/abrir)
- **Salvar projeto** em `.eiaproj.json`: áreas de influência, camadas ativas, configuração de layout, logos (em base64), parâmetros de recorte.
- **Abrir projeto** restaura o estado completo — permite voltar dias depois sem refazer o trabalho.

---

## 4. Modelo de dados

### 4.1 Catálogo de camadas — `data/catalogo.json`

```json
{
  "versao": 1,
  "meios": [
    { "id": "fisico", "nome": "Meio Físico", "cor": "#8a6d3b" },
    { "id": "biotico", "nome": "Meio Biótico", "cor": "#2f6b3a" },
    { "id": "socioeconomico", "nome": "Meio Socioeconômico", "cor": "#2f5b8a" }
  ],
  "camadas": [
    {
      "id": "geologia",
      "nome": "Geologia",
      "meio": "fisico",
      "tipo": "poligono",
      "arquivo": "data/geologia.geojson",
      "campos": ["unidade", "litologia", "idade"],
      "campo_classe": "unidade",
      "estilo": { "cor": "#c8a165", "opacidade": 0.35 },
      "fonte": "CPRM — Carta geológica",
      "data_ref": "2024",
      "obs": ""
    }
  ]
}
```

### 4.2 Área de influência

```json
{
  "id": "ada",
  "nome": "Área Diretamente Afetada",
  "sigla": "ADA",
  "cor": "#d94f3d",
  "geometry": { "type": "MultiPolygon", "coordinates": [] },
  "area_ha": 1234.56,
  "origem": "upload:ADA.shp",
  "crs_origem": "EPSG:31983"
}
```

### 4.3 Camada derivada (resultado do recorte)

Propriedades por feição, sempre com estas colunas fixas (prefixo `eia_` para não colidir com o dado do cliente):

| Campo | Tipo | Descrição |
|---|---|---|
| `eia_ai` | texto | sigla da área de influência |
| `eia_camada` | texto | id da camada de origem |
| `eia_meio` | texto | físico / biótico / socioeconômico |
| `eia_classe` | texto | valor do campo de classe |
| `eia_area_ha` | número | área da feição **depois** do recorte |
| `eia_area_orig_ha` | número | área antes do recorte |
| `eia_pct_ai` | número | % da área de influência ocupada |
| `eia_pct_feicao` | número | % da feição original que ficou dentro |
| `eia_compr_km` | número | comprimento (linhas) |
| `eia_metodo` | texto | `intersecao` / `diferenca` / `localizacao` |
| `eia_fonte` | texto | fonte declarada na camada |
| `eia_data_ref` | texto | data de referência |

### 4.4 Projeto — `.eiaproj.json`

```json
{
  "formato": "eiaproj",
  "versao": 1,
  "gerado_em": "2026-01-01T00:00:00Z",
  "projeto": { "nome": "", "cliente": "", "processo": "", "responsavel": "", "crea": "" },
  "areas_influencia": [],
  "camadas_ativas": ["geologia", "solos"],
  "recortes": [],
  "layout": { "folha": "A1", "orientacao": "paisagem", "escala": 5000, "articulacao": true, "logos": [] }
}
```

---

## 5. Estrutura de arquivos

```
portal-eia-rima/
├─ index.html                  interface única (painéis + mapa)
├─ style.css
├─ app.js                      orquestração da interface
├─ vercel.json                 cache por pasta + cabeçalhos de segurança
├─ README.md                   como publicar no GitHub/Vercel e como usar
├─ ARQUITETURA.md              este documento
├─ js/
│  ├─ math.js                  projeção UTM, área geodésica, geometria auxiliar
│  ├─ svg.js                   mini DataViz SVG (eixos, barras, pizza, escala) + PNG
│  ├─ vetorial.js              clip de polígonos, linhas e pontos (motor próprio)
│  ├─ crs.js                   leitura de .prj / EPSG → transformação
│  ├─ shapelib.js              leitura e escrita de .shp/.dbf/.prj/.cpg
│  ├─ kml.js                   KML/KMZ: ler e escrever (ZIP + deflate-raw)
│  ├─ recorte.js               motor áreas × camadas → camadas derivadas
│  ├─ tabela.js                agregação, CSV, XLSX, totalizações
│  ├─ relatorio.js             mini-relatório (texto + PDF)
│  ├─ pdf.js                   gerador de PDF (JPEG + vetor)
│  └─ mapa.js                  compositor de layout, escala e articulação
├─ data/
│  ├─ catalogo.json            definição das camadas
│  └─ *.geojson                camadas de exemplo (amostra didática)
├─ vendor/
│  ├─ leaflet.js  leaflet.css
│  └─ turf.min.js              usado só onde já resolve (bbox, buffers)
└─ tools/
   ├─ gerar_amostra.py         cria as camadas de exemplo
   └─ verificacoes/            testes em Node (sem navegador)
```

---

## 6. Núcleo geométrico

### 6.1 Projeção e área

- **WGS 84 geográfico (EPSG:4326)** é o formato de entrada/saída.
- **Área e comprimento** são calculados em projeção: UTM 23S (EPSG:31983) para Piracicaba/SP e região; fuso escolhido automaticamente pela longitude central da feição, ou informado pelo usuário. As fórmulas de Transversa de Mercator (série de Krüger) e da inversa estão em `js/math.js`.
- Confirmação por **excesso esférico** (área geodésica em esfera de raio médio) — os dois métodos devem concordar em < 0,5% para latitude da ordem de −22°; a diferença fica registrada no relatório como indicador de sanidade.
- Comprimento de linha em projeção (precisão de projeto) e em geodésica (conferência).

### 6.2 Recorte

**Decisão revista durante a implementação.** O plano inicial era escrever o motor de clip do
zero. Ao executar, ficou claro o custo: interseção e diferença de polígono côncavo é onde erro
sutil vira número errado no EIA, e o **Turf já estava vendorizado no projeto** (baseado na
biblioteca `polygon-clipping`/Martinez), sendo a mesma engine que o geoportal atual usa em
produção. O resultado é uma arquitetura de duas camadas:

| Camada | Papel |
|---|---|
| **Turf** (primário) | Interseção e diferença de polígonos, com anéis deslocados por origem comum para não perder precisão em grau. |
| **Peneira geométrica** (própria) | Confere cada anel devolvido: um ponto do seu interior tem de estar mesmo dentro de um **e** do outro (interseção) ou fora do recorte (diferença). Motivo: a biblioteca do Turf tem caso conhecido em que polígonos que apenas se **encostam** fazem a interseção devolver o sujeito inteiro. |
| **Motor próprio** (reserva) | Travessia de face planar (aresta dirigida + regra da menor virada à esquerda), usada quando o Turf falta ou recusa a geometria, e como oráculo de comparação nos testes. |

O motor próprio trata o que o Turf não resolve sozinho: linhas (corte no ponto exato de
cruzamento), pontos (seleção por localização) e a validação de geometria (auto-interseção, anel
aberto, orientação, área nula).

Limite operacional declarado na interface: ~2 milhões de vértices por operação no navegador;
acima disso, o portal sugere simplificar a camada (`js/vetorial.js` tem Douglas–Peucker).

### 6.3 Como isso foi verificado

Não por inspeção: por teste. Além dos casos escritos à mão (`verificar_vetorial.js`, 41 casos),
`verificar_oraculo.js` compara o resultado do portal com o do Turf em **centenas de polígonos
aleatórios** (estrelas, "L" côncavos, rotações), conferindo a área a área e exigindo que
`interseção + diferença = sujeito`. Foi esse teste que encontrou os defeitos reais de
implementação — inserção de cruzamento em ordem arbitrária, classificação de ponto sobre a borda,
vértice de um polígono exatamente sobre a aresta do outro, e o `pontoInterior` caindo dentro do
recorte num côncavo.

---

## 7. Compositor de mapa e articulação

### 7.1 Dimensionamento

Para escala `E` e folha de `L × A` mm (área de mapa útil, já descontados cabeçalho e rodapé), a cobertura no terreno é:

```
largura_km = L / 1000 * E / 1000
altura_km  = A / 1000 * E / 1000
```

Exemplo, área útil de 800 × 540 mm:

| Escala | Largura | Altura | Área por folha |
|---|---|---|---|
| 1:5.000 | 4,00 km | 2,70 km | 10,8 km² |
| 1:10.000 | 8,00 km | 5,40 km | 43,2 km² |
| 1:25.000 | 20,0 km | 13,5 km | 270 km² |

A articulação divide a extensão do projeto nessa grade, com sobreposição configurável (padrão 10%), e numera as folhas em ordem de leitura (oeste→leste, norte→sul), com o índice mostrando a posição de cada uma.

### 7.2 PDF

`js/pdf.js` escreve o PDF direto (objetos, `xref`, catálogo, páginas), com:
- páginas em mm exatos (A4…A0, retrato/paisagem, customizado);
- imagem do mapa embutida em **JPEG** (`DCTDecode`) — o mapa é rasterizado a 200/300 dpi pela própria folha;
- textos e linhas vetoriais (moldura, escala gráfica, grade, norte) — nítidos em qualquer ampliação;
- múltiplas páginas em um único arquivo para a articulação completa.

---

## 8. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Camada grande (hidrografia detalhada, 1 M de vértices) travando a aba | Alto | Carga sob demanda, recorte em `Worker`, simplificação opcional, aviso de limite, versão simplificada da camada publicada junto. |
| Área calculada em graus | Alto (número errado no EIA) | Sempre projetar; teste automatizado comparando UTM × geodésica. |
| `.prj` ausente ou errado no upload | Alto | Pedir confirmação do CRS na interface quando o `.prj` faltar; mostrar extensão resultante no mapa para conferência visual. |
| Shapefile com codificação antiga (Latin-1) no `.dbf` | Médio | Detectar `.cpg`; opção manual UTF-8/Latin-1 na importação. |
| Layout de mapa "quase igual" ao oficial do órgão | Médio | Layout é padrão configurável; o usuário ajusta textos, logos e rodapé antes de exportar. |
| Mapa de fundo sem internet em campo | Médio | Dado do projeto é local; interface avisa. v2: cache de tiles. |
| Uso indevido do resultado como peça técnica assinada | Alto | Marca d'água opcional, campo de responsável técnico + CREA, e ressalva de que o produto não substitui a responsabilidade do profissional. |

---

## 9. Fases

| Fase | Entrega | Situação |
|---|---|---|
| **F0** | Arquitetura, estrutura, camadas de exemplo | **entregue** |
| **F1** | Núcleo geo: math, vetorial, SHP, KMZ, CRS | **entregue e verificado** |
| **F2** | Recorte + exportação GeoJSON/SHP/KMZ | **entregue e verificado** |
| **F3** | Tabela + gráficos + mini-relatório PDF | **entregue e verificado** |
| **F4** | Compositor de mapa + articulação | **entregue e verificado** |
| **F5** | Projeto salvar/abrir, Worker para camadas gigantes, DOCX do relatório, cache de tiles | próxima |
| **F6** | Raster (declividade real, uso do solo por pixel), perfis topográficos | v2 |
| **F7** | Repositório de processos, multiusuário, banco | se houver demanda |

### 9.1 Estado da verificação

`node tools/verificar.js` roda 7 suítes — **337 verificações, todas passando**:

| Suíte | Verificações |
|---|---|
| `math` — UTM, área, comprimento, formatação | 23 |
| `vetorial` — recorte, linhas, pontos, validação | 41 |
| `formatos` — SHP/DBF/KML/KMZ ida e volta | 38 |
| `saidas` — tabela, CSV, XLSX, PDF, escala, articulação | 57 |
| `sintaxe` — compilação de todo arquivo servido + referências do HTML | 102 |
| `integracao` — fluxo completo sobre os dados reais de `data/` | 38 |
| `fumaca` — módulos no `window` falso + fluxo completo | 38 |
| `oraculo` — comparação com o Turf em polígonos aleatórios | centenas de casos |

**Limitação de verificação declarada:** o teste de navegador (`tools/_fumaca.html`) está escrito,
mas **não pôde ser executado neste ambiente** — o Chrome não inicia sob o sandbox
(`FATAL: platform_channel.cc: Access denied`, canal IPC/Mojo bloqueado). O que substitui esse
teste é `verificar_fumaca.js`, que carrega os mesmos arquivos na mesma ordem num `window` falso e
roda o fluxo completo; o `app.js` em si, por depender de Leaflet e DOM reais, **ainda precisa da
primeira execução num navegador** para ser dado como validado.
