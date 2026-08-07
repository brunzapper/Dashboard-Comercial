// Versão: 1.0 | Data: 07/08/2026
// Classificador HEURÍSTICO de segmentos — port FIEL do "Sistema V5" do Apps
// Script legado (classificarSegmentoInteligenteV5): verticais de tech
// primeiro (fintech → Serviços Financeiros…), detecção de valor genérico,
// e scoring por keywords com peso e lista de EXCLUSÃO por categoria (o
// excluir derruba a categoria inteira quando casa). Puro (sem I/O) — alimenta
// o `suggest` do domínio "segmento". Casos reais pinados em segmento.test.ts.
import { UNCLASSIFIED } from "./shared";

interface SegmentoConfig {
  keywords: string[];
  peso: number;
  excluir?: string[];
}

// Categorias canônicas + keywords — byte-fiéis ao V5.
const SEGMENTOS: Record<string, SegmentoConfig> = {
  Agronegócio: {
    keywords: [
      "agr", "farm", "farming", "agrop", "pecuar", "veterinar", "rural", "livestock",
      "cattle", "crops", "ranching", "vet",
    ],
    peso: 10,
    excluir: ["pharma", "pharmaceutic"],
  },
  "Atacado e Distribuição": {
    keywords: [
      "atacad", "distribui", "wholesal", "wholesale", "import", "export", "trading",
      "distribuidor", "trader", "bulk", "produtos atacado", "international trade",
    ],
    peso: 10,
    excluir: ["varejo", "retail"],
  },
  "Construção Civil e Engenharia": {
    keywords: [
      "construc", "construction", "engenhar", "engineer", "obra", "edific", "arquitet",
      "civil", "infrastructure", "building", "materiais construcao",
      "hub solucoes engenharia", "shipbuild",
    ],
    peso: 10,
    excluir: ["software", "technology", "ti"],
  },
  "Educação e Ensino": {
    keywords: [
      "educ", "ensino", "pedagog", "escol", "univers", "faculdad", "school", "university",
      "college", "training", "learning", "treinamento", "teaching", "education management",
      "higher education", "primary", "secondary", "elearning", "e-learning",
    ],
    peso: 10,
  },
  "Energia e Saneamento": {
    keywords: [
      "energ", "energy", "eletri", "electric", "saneament", "solar", "eolic", "power",
      "utilities", "oil", "gas", "petroleum", "renewable", "environment", "renewables",
      "environmental services", "agua", "esgoto", "sanitation", "water",
    ],
    peso: 10,
    excluir: ["mining", "mineracao"],
  },
  "Governo e Terceiro Setor": {
    keywords: [
      "govern", "public", "municipal", "estadual", "federal", "prefeitur", "civic", "ong",
      "nonprofit", "administracao publica", "social organization", "government administration",
      "legislative", "executive office", "military", "law enforcement",
    ],
    peso: 10,
  },
  "Indústria - Alimentos e Bebidas": {
    keywords: [
      "aliment", "food", "bebid", "beverage", "alimentic", "dairy", "meat", "poultry",
      "frigorif", "food production", "food & beverages", "acucar", "chocolate", "latic",
    ],
    peso: 10,
    excluir: ["restaurante", "restaurant"],
  },
  "Indústria - Automotiva e Veículos": {
    keywords: [
      "automotiv", "automov", "automotive", "veicul", "vehicle", "car", "truck", "auto", "pecas",
    ],
    peso: 10,
    excluir: ["cartorio"],
  },
  "Indústria - Farmacêutica": {
    keywords: [
      "pharmaceutic", "pharma", "farmaceutic", "medicament", "medicine", "drug", "biotech",
      "biotechnology", "medical device",
    ],
    peso: 10,
    excluir: ["farm"],
  },
  "Indústria - Geral e Manufatura": {
    keywords: [
      "industr", "manufactur", "manufatur", "fabricac", "fabric", "produc", "production",
      "manufacturing", "industrial", "eletrodomestico", "ferramenta", "mechanical",
      "electrical", "electronic", "automacao industrial", "industrial automation",
      "factory", "plant",
    ],
    peso: 8,
  },
  "Indústria - Máquinas e Equipamentos": {
    keywords: [
      "maquin", "machin", "machinery", "equipament", "equipment", "britagem", "peneiramento",
      "hidraulic", "locacao equipamento", "tools",
    ],
    peso: 10,
  },
  "Indústria - Metalurgia e Mineração": {
    keywords: [
      "miner", "mining", "minerac", "metalurg", "metal", "sider", "steel", "iron",
      "aluminum", "copper", "metals", "minerio",
    ],
    peso: 10,
    excluir: ["renewable", "environment"],
  },
  "Indústria - Papel, Celulose e Embalagens": {
    keywords: [
      "papel", "paper", "celulos", "pulp", "embalag", "packag", "forest product", "papelari",
      "distribuidora papel", "container", "papelaria", "material escritorio",
      "forest products", "packaging", "containers",
    ],
    peso: 10,
  },
  "Indústria - Química, Plástico e Petroquímica": {
    keywords: [
      "quim", "chemic", "plasti", "plastic", "petro", "polim", "polymer", "chemical",
    ],
    peso: 10,
  },
  "Indústria - Têxtil e Vestuário": {
    keywords: [
      "text", "textile", "vestuar", "apparel", "fashion", "moda", "confec", "tecid",
      "clothing", "roupa", "garment",
    ],
    peso: 10,
  },
  "Logística e Transportes": {
    keywords: [
      "logist", "transport", "transportador", "fret", "freight", "entrega", "delivery",
      "warehousing", "warehouse", "armazenagem", "cargo", "supply chain", "trucking",
      "railroad", "aviation", "airline", "maritime", "shipment", "package", "aerospace",
      "airlines",
    ],
    peso: 10,
    excluir: ["imob", "real estate"],
  },
  "Marketing e Comunicação": {
    keywords: [
      "marketing", "publicidad", "advertising", "comunicac", "propaganda", "midia", "media",
      "agencia marketing", "agencia publicidade", "relacoes publicas", "pr",
      "public relations", "marketing & advertising", "media production", "publishing",
      "newspapers",
    ],
    peso: 10,
    excluir: ["telecom", "technology"],
  },
  "Mercado Imobiliário": {
    keywords: [
      "imobiliar", "imov", "real estate", "property", "housing", "proptech",
    ],
    peso: 10,
    excluir: ["warehouse", "warehousing"],
  },
  "Restaurantes e Food Service": {
    keywords: [
      "restauran", "restaurant", "gastronom", "food service", "catering", "bar", "cafe",
      "hospitality", "hotel", "leisure", "travel", "tourism",
    ],
    peso: 10,
  },
  "Saúde e Serviços Hospitalares": {
    keywords: [
      "saud", "health", "hospit", "medic", "clinic", "hospitalar", "hospital", "healthcare",
      "wellness", "fitness", "fisioterapia", "consultoria medica", "plano saude",
      "atencao saude", "medical practice", "hospital & health care", "medical devices",
    ],
    peso: 10,
  },
  Seguros: {
    keywords: [
      "segur", "insurance", "insurer", "broker", "policy", "insurtech", "seguradora",
      "corretora", "security & investigations",
    ],
    peso: 10,
    excluir: ["ciber", "cyber", "seguranca informacao"],
  },
  "Serviços Corporativos e Consultoria": {
    keywords: [
      "consult", "corporativ", "empresar", "terceiriz", "outsourc", "contabil", "accounting",
      "business service", "facilities", "staffing", "limpeza", "escritorio contabilidade",
      "escritorio advocacia", "advocacia", "cartorio", "management consulting", "direito",
      "associativismo", "recrutamento", "consulting", "offshoring", "facilities services",
      "recruiting", "legal services", "law practice", "professional services",
    ],
    peso: 8,
  },
  "Serviços Financeiros": {
    keywords: [
      "financ", "bank", "banc", "credit", "invest", "financial", "banking", "investment",
      "capital market", "capital markets", "venture capital", "private equity", "payment",
      "correspondente bancario", "cooperativismo financeiro", "cobranca",
      "recuperacao credito", "consorcios", "fintech", "asset management", "wealth",
      "financial services", "investment management", "investment banking", "fund",
    ],
    peso: 10,
    excluir: ["technology", "software"],
  },
  "Tecnologia e Telecomunicações": {
    keywords: [
      "tecn", "tecnolog", "technology", "informat", "information", "software", "telecom",
      "telecommunication", "internet", "cloud", "saas", "ai", "data", "digital", "cyber",
      "ciber", "hardware", "semiconductor", "provedor internet", "servicos ambientais",
      "computer", "network", "wireless", "it services", "information technology",
      "computer games", "computer software", "computer hardware", "information services",
      "online media", "nanotechnology",
    ],
    peso: 10,
    excluir: ["atacad", "materiais construcao"],
  },
  "Varejo e Comércio": {
    keywords: [
      "varej", "retail", "comerci", "loj", "store", "mercad", "market", "ecommerce",
      "marketplace", "supermarket", "cosmetic", "consumer goods", "consumer services",
      "consumer electronics", "luxury goods", "sporting goods", "business supplies",
    ],
    peso: 10,
    excluir: ["atacado", "wholesal", "distribuidor", "marketing", "agencia"],
  },
};

/** Categorias canônicas de segmento (dropdowns + validação da IA). */
export const SEGMENTO_CATEGORIAS = Object.keys(SEGMENTOS);

// Verticais de tech: mapeadas ao setor de NEGÓCIO, não a Tecnologia.
const TECH_VERTICALS: { pattern: RegExp; categoria: string }[] = [
  { pattern: /fintech|financ.*tech/i, categoria: "Serviços Financeiros" },
  { pattern: /healthtech|saud.*tech|medtech/i, categoria: "Saúde e Serviços Hospitalares" },
  { pattern: /edutech|edtech|educ.*tech/i, categoria: "Educação e Ensino" },
  { pattern: /agritech|agrotech|agr.*tech/i, categoria: "Agronegócio" },
  { pattern: /proptech|imob.*tech/i, categoria: "Mercado Imobiliário" },
  { pattern: /insurtech|segur.*tech/i, categoria: "Seguros" },
  { pattern: /legaltech|jur.*tech|lawtech/i, categoria: "Serviços Corporativos e Consultoria" },
  { pattern: /retailtech|varej.*tech/i, categoria: "Varejo e Comércio" },
  { pattern: /logtech|log.*tech/i, categoria: "Logística e Transportes" },
];

const GENERICOS = ["-", "", "n/a", "empresa", "company", "business", "servicos", "grupo"];

function isGeneric(segmento: string): boolean {
  const seg = segmento.toLowerCase().trim();
  return GENERICOS.includes(seg) || seg.length < 3 || /^\d+$/.test(seg);
}

/**
 * Classifica um segmento livre na categoria padronizada — mesmo pipeline do
 * V5: vertical de tech > genérico > scoring com exclusões. Sem match devolve
 * "Não Classificado".
 */
export function classifySegmento(raw: unknown): string {
  const original = String(raw ?? "").trim();
  if (original === "") return UNCLASSIFIED;

  for (const { pattern, categoria } of TECH_VERTICALS) {
    if (pattern.test(original.toLowerCase())) return categoria;
  }
  if (isGeneric(original)) return UNCLASSIFIED;

  const norm = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/g, "&")
    .trim();

  const scores: Record<string, number> = {};
  for (const [categoria, config] of Object.entries(SEGMENTOS)) {
    if (config.excluir?.some((exc) => norm.includes(exc))) continue;
    let score = 0;
    for (const kw of config.keywords) {
      if (norm.includes(kw)) score += config.peso * 10;
    }
    if (score > 0) scores[categoria] = score;
  }

  const keys = Object.keys(scores);
  if (keys.length === 0) return UNCLASSIFIED;
  return keys.reduce((a, b) => (scores[a] > scores[b] ? a : b));
}
