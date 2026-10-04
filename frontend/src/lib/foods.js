// Local food table: common Brazilian foods, per 100 g of the edible portion as usually
// eaten (cooked items are listed cooked — "Arroz branco cozido", not raw grain).
//
// Values are plausible figures from the Brazilian Table of Food Composition (TBCA) /
// USDA ranges, rounded for readability: kcal, protein, carbs, fat — in that order in RAW,
// expanded into the same { source, name, per100g } shape the external APIs return
// (lib/foodApis.js), so the log and the search UI never care where a result came from.
//
// searchFoods is accent- and case-insensitive: "feijao", "FEIJÃO" and "Feijão" all match.

const RAW = [
  // --- cereais, tubérculos e massas (cozidos salvo indicação) ---
  ['Arroz branco cozido', 128, 2.6, 28.1, 0.2],
  ['Arroz integral cozido', 124, 2.6, 25.8, 1.0],
  ['Arroz parboilizado cozido', 128, 2.5, 28.2, 0.2],
  ['Arroz com brócolis', 89, 2.4, 17.4, 1.0],
  ['Macarrão cozido', 158, 5.8, 30.8, 0.9],
  ['Macarrão integral cozido', 147, 5.0, 26.0, 2.0],
  ['Quinoa cozida', 120, 4.4, 21.3, 1.9],
  ['Cuscuz de milho pronto', 112, 2.3, 24.5, 0.4],
  ['Cuscuz paulista', 150, 7.0, 19.0, 5.0],
  ['Aveia em flocos', 394, 13.9, 66.6, 8.5],
  ['Granola', 489, 10.0, 64.0, 22.0],
  ['Polenta cozida', 70, 1.7, 15.8, 0.4],
  ['Batata frita', 267, 3.8, 35.6, 13.0],
  ['Batata assada com casca', 93, 2.5, 20.6, 0.1],
  ['Batata cozida com casca', 87, 1.9, 20.1, 0.1],
  ['Batata doce cozida', 77, 2.0, 18.0, 0.1],
  ['Batata doce assada', 90, 2.0, 21.0, 0.1],
  ['Mandioca cozida', 125, 0.6, 30.1, 0.3],
  ['Aipim frito', 254, 1.5, 35.0, 12.6],
  ['Inhame cozido', 72, 1.5, 16.4, 0.1],
  ['Farinha de mandioca crua', 357, 2.1, 84.9, 0.3],
  ['Farinha de milho', 370, 7.2, 79.0, 0.4],
  ['Farinha de trigo crua', 364, 12.0, 76.0, 1.0],
  ['Tapioca (goma)', 358, 0.5, 88.0, 0.1],

  // --- feijões e leguminosas (cozidos) ---
  ['Feijão carioca cozido', 76, 4.8, 13.6, 0.5],
  ['Feijão preto cozido', 77, 4.5, 14.0, 0.5],
  ['Feijão fradinho cozido', 76, 4.5, 13.6, 0.5],
  ['Feijão amarelo cozido', 77, 4.8, 14.0, 0.5],
  ['Lentilha cozida', 93, 6.3, 16.3, 0.5],
  ['Grão-de-bico cozido', 130, 8.4, 21.2, 2.1],
  ['Ervilha cozida', 81, 5.4, 14.5, 0.4],
  ['Soja cozida', 173, 16.6, 9.9, 8.7],
  ['Proteína de soja texturizada cozida', 140, 16.0, 14.0, 3.0],
  ['Milho amarelo cozido', 96, 3.4, 21.0, 1.5],
  ['Milho verde enlatado', 78, 5.4, 14.6, 1.3],

  // --- carnes e aves ---
  ['Carne bovina patinho grelhada', 278, 26.0, 0, 19.0],
  ['Carne moída refogada', 290, 26.0, 0, 20.0],
  ['Carne de panela cozida', 250, 28.0, 0, 15.0],
  ['Contrafilé grelhado', 271, 29.0, 0, 17.0],
  ['Picanha grelhada', 350, 26.0, 0, 27.0],
  ['Costela bovina assada', 350, 25.0, 0, 27.0],
  ['Carne de sol', 250, 30.0, 0, 14.0],
  ['Charque cozido', 370, 25.0, 2.0, 29.0],
  ['Frango peito grelhado', 159, 31.0, 0, 3.6],
  ['Frango desfiado cozido', 165, 30.0, 0, 4.5],
  ['Frango coxa e perna assada', 185, 24.0, 0, 10.0],
  ['Frango inteiro assado', 190, 27.0, 0, 8.0],
  ['Frango à passarinho', 230, 20.0, 5.0, 14.0],
  ['Peru peito grelhado', 135, 30.0, 0, 1.0],
  ['Bife de hambúrguer grelhado', 250, 26.0, 0, 16.0],
  ['Bife acebolado', 250, 24.0, 4.0, 15.0],
  ['Linguiça calabresa', 296, 12.7, 2.3, 25.4],
  ['Linguiça toscana grelhada', 300, 14.0, 2.0, 26.0],
  ['Presunto cozido', 145, 20.9, 1.6, 5.5],
  ['Salsicha', 290, 10.0, 4.0, 26.0],

  // --- peixes e frutos do mar ---
  ['Tilápia grelhada', 128, 26.0, 0, 2.7],
  ['Salmão grelhado', 206, 20.0, 0, 13.0],
  ['Atum fresco grelhado', 132, 28.0, 0, 1.0],
  ['Atum enlatado em óleo escorrido', 260, 26.0, 0, 17.0],
  ['Sardinha enlatada em óleo', 246, 25.0, 0, 15.0],
  ['Merluza grelhada', 112, 24.0, 0, 1.0],
  ['Corvina grelhada', 130, 25.0, 0, 3.0],
  ['Camarão grelhado', 99, 24.0, 0, 0.3],
  ['Pescada cozida', 100, 20.0, 0, 2.0],

  // --- ovos ---
  ['Ovo cru', 143, 12.6, 0.7, 9.5],
  ['Ovo cozido', 155, 12.6, 1.1, 10.6],
  ['Ovo frito', 196, 13.6, 0.8, 15.0],
  ['Omelete', 150, 10.0, 2.0, 11.0],
  ['Clara de ovo cozida', 52, 10.9, 0.7, 0.2],

  // --- leite e derivados ---
  ['Leite integral', 61, 3.2, 4.7, 3.3],
  ['Leite desnatado', 35, 3.4, 5.0, 0.1],
  ['Leite sem lactose', 58, 3.2, 4.7, 3.0],
  ['Leite em pó integral', 496, 26.0, 38.0, 26.0],
  ['Queijo minas frescal', 264, 17.5, 3.1, 20.6],
  ['Queijo prato', 350, 22.0, 3.0, 28.0],
  ['Queijo mussarela', 294, 22.0, 3.4, 22.0],
  ['Queijo parmesão', 431, 35.0, 2.8, 29.0],
  ['Queijo coalho grelhado', 300, 20.0, 2.0, 24.0],
  ['Queijo cottage', 98, 11.0, 3.4, 4.3],
  ['Requeijão cremoso', 260, 10.0, 4.0, 23.0],
  ['Iogurte natural integral', 61, 3.5, 4.7, 3.3],
  ['Iogurte natural desnatado', 37, 3.9, 4.9, 0.2],
  ['Iogurte com frutas', 94, 3.0, 14.0, 2.0],
  ['Creme de leite fresco', 191, 2.1, 3.8, 19.3],
  ['Creme de leite (caixinha)', 219, 2.1, 3.4, 21.7],
  ['Leite condensado', 313, 7.4, 56.0, 6.7],
  ['Manteiga', 717, 0.9, 0.1, 81.0],
  ['Margarina', 717, 0.1, 0.6, 80.0],

  // --- pães e biscoitos ---
  ['Pão francês', 300, 8.4, 58.7, 4.6],
  ['Pão de forma branco', 265, 8.0, 49.0, 3.5],
  ['Pão de forma integral', 247, 9.0, 44.0, 3.5],
  ['Pão de queijo', 363, 7.6, 39.6, 20.0],
  ['Pão sírio (árabe)', 275, 9.1, 55.7, 1.2],
  ['Bisnaguinha', 320, 8.0, 60.0, 6.0],
  ['Pão de hot dog', 260, 9.0, 49.0, 4.0],
  ['Torrada', 400, 10.0, 73.0, 7.0],
  ['Biscoito cream cracker', 480, 10.0, 70.0, 20.0],
  ['Biscoito recheado de chocolate', 484, 6.0, 70.0, 21.0],

  // --- preparações brasileiras ---
  ['Feijoada', 173, 11.0, 12.0, 9.0],
  ['Arroz com feijão', 150, 5.0, 27.0, 2.0],
  ['Feijão tropeiro', 195, 8.5, 24.0, 8.6],
  ['Baião de dois', 150, 6.0, 20.0, 5.0],
  ['Moqueca de peixe', 150, 12.0, 5.0, 9.0],
  ['Bobó de camarão', 170, 8.0, 15.0, 9.0],
  ['Estrogonoff de frango', 175, 12.0, 9.0, 11.0],
  ['Estrogonoff de carne', 180, 12.0, 9.0, 11.0],
  ['Lasanha à bolonhesa', 152, 8.0, 13.0, 7.5],
  ['Pizza de mussarela', 266, 11.0, 30.0, 11.0],
  ['Pizza de calabresa', 280, 11.0, 31.0, 13.0],
  ['Coxinha de frango', 265, 8.0, 30.0, 12.0],
  ['Esfiha de carne', 270, 12.0, 30.0, 12.0],
  ['Pastel de carne', 280, 10.0, 28.0, 14.0],
  ['Empada de frango', 270, 9.0, 25.0, 15.0],
  ['Farofa pronta', 470, 2.5, 60.0, 24.0],
  ['Purê de batata', 84, 1.7, 13.7, 2.5],
  ['Sanduíche de misto quente', 270, 12.0, 28.0, 13.0],
  ['Hambúrguer simples', 254, 13.0, 23.0, 12.0],
  ['Arroz doce', 178, 3.2, 30.0, 5.8],
  ['Canjica', 130, 4.0, 21.0, 3.5],
  ['Pudim de leite', 256, 5.0, 40.0, 9.0],
  ['Brigadeiro', 379, 3.5, 60.0, 13.0],
  ['Paçoca de amendoim', 450, 12.0, 60.0, 20.0],
  ['Bolo de chocolate', 348, 5.0, 50.0, 15.0],
  ['Bolo de fubá', 316, 6.0, 48.0, 11.0],
  ['Vinagrete', 60, 1.0, 5.0, 4.0],

  // --- frutas ---
  ['Banana prata', 98, 1.3, 26.0, 0.1],
  ['Banana nanica', 89, 1.1, 22.8, 0.3],
  ['Banana maçã', 87, 1.1, 21.0, 0.2],
  ['Maçã com casca', 56, 0.3, 13.8, 0.4],
  ['Laranja pera', 47, 1.0, 11.6, 0.1],
  ['Tangerina', 47, 0.7, 12.0, 0.1],
  ['Manga palmer', 65, 0.5, 17.0, 0.3],
  ['Mamão papaia', 45, 0.5, 11.6, 0.1],
  ['Abacaxi', 50, 0.9, 13.1, 0.1],
  ['Melancia', 30, 0.6, 7.6, 0.2],
  ['Morango', 33, 0.7, 7.7, 0.3],
  ['Uva violeta', 67, 0.7, 16.5, 0.2],
  ['Limão', 30, 0.7, 8.4, 0.1],
  ['Pêra', 57, 0.4, 15.2, 0.1],
  ['Pêssego', 39, 0.9, 9.5, 0.3],
  ['Kiwi', 61, 1.1, 14.7, 0.5],
  ['Goiaba branca', 68, 1.0, 14.3, 0.9],
  ['Caju (polpa)', 51, 1.4, 12.5, 0.3],
  ['Açaí (polpa congelada)', 60, 1.2, 5.0, 4.7],
  ['Coco fresco (polpa)', 354, 3.3, 15.2, 33.5],
  ['Abacate', 160, 2.0, 8.5, 14.7],
  ['Pitaya', 50, 1.2, 13.0, 0.1],
  ['Graviola', 66, 1.0, 16.8, 0.2],
  ['Framboesa', 52, 1.2, 12.0, 0.7],
  ['Mirtilo', 57, 0.7, 14.5, 0.3],

  // --- legumes e verduras ---
  ['Tomate cru', 15, 1.1, 3.1, 0.2],
  ['Alface crespa', 15, 1.4, 2.9, 0.2],
  ['Rúcula crua', 25, 2.6, 3.7, 0.7],
  ['Cebola crua', 40, 1.1, 9.3, 0.1],
  ['Alho cru', 149, 6.4, 33.1, 0.5],
  ['Cenoura crua', 41, 0.9, 9.6, 0.2],
  ['Cenoura cozida', 35, 0.8, 8.0, 0.2],
  ['Beterraba crua', 43, 1.6, 9.6, 0.2],
  ['Beterraba cozida', 44, 1.6, 10.0, 0.2],
  ['Brócolis cru', 34, 2.8, 7.0, 0.4],
  ['Brócolis cozido', 35, 2.4, 7.2, 0.4],
  ['Couve-flor crua', 25, 1.9, 5.0, 0.3],
  ['Abobrinha crua', 17, 1.2, 3.1, 0.3],
  ['Abobrinha cozida', 20, 1.3, 3.5, 0.4],
  ['Chuchu cru', 19, 0.6, 4.6, 0.1],
  ['Pimentão cru', 21, 1.0, 4.6, 0.2],
  ['Pepino cru', 15, 0.7, 3.6, 0.1],
  ['Espinafre cru', 23, 2.9, 3.6, 0.4],
  ['Couve manteiga crua', 35, 2.9, 8.4, 0.5],
  ['Repolho cru', 25, 1.3, 5.8, 0.1],
  ['Palmito pupunha cozido', 29, 2.3, 5.4, 0.5],
  ['Cogumelo paris cru', 22, 3.1, 3.3, 0.3],
  ['Vagem cozida', 35, 2.4, 7.0, 0.2],

  // --- oléaginosas, sementes e óleos ---
  ['Amendoim torrado', 567, 26.0, 16.0, 49.0],
  ['Castanha de caju', 553, 18.0, 30.0, 44.0],
  ['Castanha-do-pará', 656, 14.0, 12.0, 57.0],
  ['Nozes', 654, 15.0, 14.0, 65.0],
  ['Amêndoa', 579, 21.0, 22.0, 50.0],
  ['Semente de girassol', 584, 21.0, 20.0, 51.0],
  ['Semente de abóbora', 559, 30.0, 11.0, 49.0],
  ['Chia', 486, 17.0, 42.0, 31.0],
  ['Linhaça', 534, 18.0, 29.0, 42.0],
  ['Pasta de amendoim', 588, 25.0, 20.0, 50.0],
  ['Azeitona', 145, 1.1, 3.8, 14.5],
  ['Óleo de soja', 884, 0, 0, 100.0],
  ['Óleo de oliva', 884, 0, 0, 100.0],
  ['Óleo de coco', 884, 0, 0, 100.0],
  ['Óleo de dendê', 884, 0, 0, 100.0],

  // --- molhos, doces, snacks e bebidas ---
  ['Molho de tomate', 29, 1.4, 5.9, 0.3],
  ['Ketchup', 112, 1.0, 26.0, 0.4],
  ['Maionese', 680, 1.0, 5.0, 74.0],
  ['Mostarda', 66, 4.0, 6.0, 4.0],
  ['Açúcar refinado', 387, 0, 100.0, 0],
  ['Mel', 304, 0.3, 82.0, 0],
  ['Chocolate ao leite', 534, 6.8, 59.4, 29.7],
  ['Chocolate meio amargo', 479, 5.0, 61.0, 31.0],
  ['Sorvete de creme', 207, 3.5, 24.0, 10.0],
  ['Pipoca de micro-ondas', 445, 10.0, 50.0, 23.0],
  ['Tofu firme', 76, 8.0, 1.9, 4.8],
  ['Whey protein (pó)', 400, 78.0, 8.0, 6.0],
  ['Refrigerante cola', 42, 0, 10.6, 0],
  ['Refrigerante diet', 0, 0, 0, 0],
  ['Suco de laranja natural', 45, 0.7, 10.4, 0.2],
  ['Suco de uva integral', 60, 0.6, 15.0, 0.1],
  ['Cerveja lata', 43, 0.5, 3.6, 0],
  ['Vinho tinto', 85, 0.1, 2.6, 0],
  ['Cachaça', 225, 0.1, 2.6, 0],
  ['Café coado sem açúcar', 1, 0.1, 0, 0],
  ['Água de coco', 18, 0.7, 3.7, 0],
]

// Same normalised shape the external sources return: { source, name, per100g }.
export const FOODS = RAW.map(([name, kcal, protein, carbs, fat]) => ({
  source: 'local',
  name,
  per100g: { kcal, protein, carbs, fat },
}))

// Accent/case folding for search: NFD-split and drop the combining marks, then lowercase.
// "FEIJÃO", "Feijao" and "feijao" all collapse to "feijao".
export const normalizeText = s =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

// Substring search over the local table, accent- and case-insensitive. Multi-word queries
// must all match ("arroz integral" skips "Arroz branco"); prefix matches rank above
// mid-word ones ("arroz" puts "Arroz branco cozido" before "Farinha de arroz integral" —
// when both rank equally, the shorter/earlier name wins alphabetically).
export function searchFoods(query, limit = 20) {
  const q = normalizeText(query).trim()
  if (!q) return []
  const terms = q.split(/\s+/).filter(Boolean)
  const hits = []
  for (const food of FOODS) {
    const hay = normalizeText(food.name)
    if (!terms.every(term => hay.includes(term))) continue
    const rank = hay.startsWith(q) ? 0 : hay.split(/\s+/).some(w => w.startsWith(terms[0])) ? 1 : 2
    hits.push({ food, rank })
  }
  hits.sort((a, b) => a.rank - b.rank || a.food.name.localeCompare(b.food.name))
  return hits.slice(0, Math.max(0, limit)).map(h => h.food)
}
