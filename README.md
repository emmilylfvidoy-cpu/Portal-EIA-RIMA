# Portal EIA/RIMA

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
│  ├─ gerar_amostra.js   monta as camadas de exemplo a partir do dado real
│  ├─ verificar.js       roda todas as verificações
│  └─ verificacoes/      testes (Node, sem navegador)
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
| `formatos` | Shapefile/DBF ida e volta (com acento, furo e booleano), KML, KMZ |
| `saidas` | Tabela, conferência de fechamento, CSV, XLSX, relatório, PDF, escala e articulação |
| `sintaxe` | Compila todo arquivo servido e confere as referências do HTML e os ids usados |
| `integracao` | Fluxo completo sobre os arquivos reais de `data/`, com PDF de amostra |
| `oraculo` | Compara o recorte com o Turf em polígonos aleatórios (área a área) |

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
