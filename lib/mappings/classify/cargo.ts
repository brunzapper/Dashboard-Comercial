// Versão: 1.0 | Data: 07/08/2026
// Classificador HEURÍSTICO de cargos — port FIEL do "Sistema V5" do Apps
// Script legado (classificarCargoInteligenteV5): análise em 3 dimensões
// (keywords diretas 40% + contexto semântico 50% + padrões estruturais 10%),
// regras de OVERRIDE que sempre se aplicam e classificação de nível
// hierárquico por padrões. Puro (sem I/O) — alimenta o `suggest` do domínio
// "cargo" (lib/mappings/domains.ts): valor novo é classificado e vira entrada
// `origin='auto'` do de-para, revisável em /operacao/mapeamentos.
// Ao ajustar pesos/regras, mantenha a paridade com os casos reais pinados em
// cargo.test.ts (amostras do cache legado "Map Cargos").
import { UNCLASSIFIED } from "./shared";

export interface CargoClassification {
  area: string;
  nivel: string;
}

/** Áreas canônicas do classificador (dropdowns + validação da IA). */
export const CARGO_AREAS = [
  "TI",
  "Compliance",
  "Legal",
  "RH",
  "Vendas",
  "Customer Success",
  "Marketing",
  "Finanças",
  "Operacional",
  "Produto",
  "Administração",
] as const;

/** Níveis hierárquicos canônicos. */
export const CARGO_NIVEIS = [
  "C-Level",
  "Diretor",
  "Gerente",
  "Analista",
  "Outros",
] as const;

type Scores = Record<string, number>;

const bump = (scores: Scores, area: string, delta: number) => {
  scores[area] = (scores[area] ?? 0) + delta;
};

// ---------------------------------------------------------------------------
// Dimensão 1 — keywords diretas (peso 40%)
// ---------------------------------------------------------------------------
const KEYWORDS: Record<string, string[]> = {
  TI: [
    "cto", "cio", "ciso", "cso", "chief technology", "chief information", "chief security",
    "tecnologia", "informacao", "ti", "sistemas", "infraestrutura", "dados", "software",
    "desenvolvimento", "digital", "plataforma", "aplicacoes", "suporte", "servicos",
    "engenharia", "inovacao", "transformacao digital",
    "technology", "information", "it", "system", "infrastructure", "data", "software",
    "development", "digital", "platform", "application", "support", "service",
    "engineering", "innovation", "digital transformation",
    "cloud", "nuvem", "devops", "sre", "finops", "devsecops", "aws", "azure", "gcp",
    "google cloud", "oracle cloud", "hybrid cloud", "multicloud",
    "cybersecurity", "cyber security", "cyber", "ciber", "security", "seguranca",
    "information security", "infosec", "appsec", "iam",
    "database", "banco dados", "bi", "business intelligence", "analytics", "data engineering",
    "data science", "big data", "datalake", "datawarehouse",
    "network", "rede", "telecom", "telecommunications", "unified communications",
    "architecture", "arquitetura", "solution architect", "arquiteto solucoes",
    "automation", "automacao", "middleware", "integration", "integracao",
  ],
  Compliance: [
    "compliance", "conformidade",
    "grc", "governanca", "governance", "controles internos", "internal control",
    "audit", "auditoria", "auditor", "internal audit", "auditoria interna",
    "risk", "riscos", "risco", "risk management", "gestao riscos",
    "regulatory", "regulatorio", "regulatoria",
    "privacy", "privacidade", "dpo", "data protection", "protecao dados", "lgpd", "gdpr",
    "aml", "pld", "ftp", "kyc", "cft", "anti money laundering", "prevencao lavagem",
    "esg", "sustentabilidade", "sustainability", "responsabilidade social", "social responsibility",
    "iso", "sox", "sarbanes", "sgi", "sgq", "oea",
    "integrity", "integridade", "ethics", "etica",
  ],
  Legal: [
    "juridico", "juridica", "legal", "advogado", "advogada", "direito",
    "attorney", "lawyer", "counsel", "law",
    "litigation", "litigio", "contencioso", "societario", "corporate",
    "contract", "contratos", "trabalhista", "labor", "m&a", "merger", "acquisition",
    "general counsel", "chief legal officer", "clo",
  ],
  RH: [
    "rh", "hr", "chro",
    "recursos humanos", "pessoas", "gente", "humano", "humana", "talentos",
    "recrutamento", "selecao", "desenvolvimento humano", "desenvolvimento organizacional",
    "gestao pessoas", "cultura organizacional", "treinamento", "capacitacao",
    "human resources", "people", "human", "talent", "recruitment", "selection",
    "human development", "organizational development", "people management",
    "organizational culture", "training", "learning", "employee", "workforce",
  ],
  Vendas: [
    "cro", "chief revenue",
    "vendas", "comercial", "receita", "negocio", "negocios", "partnership", "parceria",
    "crescimento", "revenue operations", "revops",
    "sales", "commercial", "revenue", "business", "selling", "growth",
    "account", "account manager", "key account", "inside sales", "field sales",
    "enterprise sales", "corporate sales", "institutional sales",
    "sales development", "sdr", "bdr", "pre-sales", "pre vendas",
    "channel", "partner", "distribution", "distribuicao",
  ],
  "Customer Success": [
    "customer success", "cs", "csm", "sucesso cliente",
    "customer experience", "cx", "experiencia cliente", "client experience",
    "support", "suporte", "atendimento", "customer support", "customer care",
    "customer service", "servico cliente", "technical support", "suporte tecnico",
    "customer relationship", "relacionamento cliente", "account management",
  ],
  Marketing: [
    "cmo", "chief marketing",
    "marketing", "marca", "comunicacao", "publicidade", "midia", "conteudo",
    "digital marketing", "performance", "growth marketing", "demand generation",
    "brand", "communication", "advertising", "media", "content", "campaign",
    "social media", "midias sociais", "public relations", "relacoes publicas", "pr",
    "marketing cloud", "martech", "crm marketing", "email marketing", "seo", "sem",
  ],
  Finanças: [
    "cfo", "chief financial",
    "financas", "financeiro", "financeira", "tesouraria", "controladoria",
    "contabilidade", "orcamento", "custos", "planejamento financeiro",
    "finance", "financial", "treasury", "controlling", "controller",
    "accounting", "budget", "cost", "financial planning",
    "fp&a", "fpa", "financial planning analysis", "tax", "fiscal", "tributario",
    "accounts payable", "accounts receivable", "contas pagar", "contas receber",
  ],
  Operacional: [
    "coo", "chief operating",
    "operac", "operacional", "operacoes", "supply", "cadeia", "supply chain",
    "logistica", "producao", "manufatura", "qualidade", "processos",
    "facilities", "manutencao", "industrial", "fabrica", "planta",
    "compras", "suprimentos", "procurement",
    "operation", "operational", "operations", "logistics",
    "production", "manufacturing", "quality", "process", "facility",
    "maintenance", "plant", "factory",
    "purchasing", "sourcing", "buyer",
    "contract", "contratos", "contract management", "gestao contratos",
  ],
  Produto: [
    "cpo", "chief product",
    "produto", "product", "pdp", "product development",
    "product manager", "product owner", "po", "gerente produto",
    "product lead", "product director", "diretor produto",
    "portfolio", "roadmap", "product strategy", "estrategia produto",
  ],
  Administração: [
    "ceo", "chief executive", "presidente", "president", "founder", "fundador",
    "co-founder", "cofundador", "owner", "proprietario", "socio", "partner",
    "administrac", "administration", "administrative", "administrativo", "administrativa",
    "geral", "general", "executivo", "executive", "gestao", "management",
    "governanca corporativa", "corporate governance", "board", "conselho",
    "esg", "sustentabilidade", "sustainability", "responsabilidade social",
  ],
};

function analyzeKeywords(cargoNorm: string): Scores {
  const scores: Scores = {};
  for (const [area, kws] of Object.entries(KEYWORDS)) {
    for (const kw of kws) {
      if (cargoNorm.includes(kw)) bump(scores, area, 100);
    }
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Dimensão 2 — contexto semântico (peso 50%, a mais importante)
// ---------------------------------------------------------------------------
interface ContextRule {
  test: (s: string) => boolean;
  area: string;
  score: number;
}

const CONTEXT_RULES: ContextRule[] = [
  { test: (s) => /\b(gente|people|humano|humana|human|pessoas)\b/.test(s), area: "RH", score: 300 },
  { test: (s) => /desenvolvimento.*(humano|organizacional|pessoas)/.test(s), area: "RH", score: 250 },
  { test: (s) => /(comunicacao|communication).*(gente|people|rh)/.test(s), area: "RH", score: 200 },

  { test: (s) => /\b(coo|chief operating officer|diretor.*operac|operacional)\b/.test(s), area: "Operacional", score: 400 },
  { test: (s) => /\bindustrial\b/.test(s) && !/engineer/.test(s), area: "Operacional", score: 200 },
  { test: (s) => /supply.*(governance|governanca)/.test(s), area: "Operacional", score: 300 },
  { test: (s) => /\b(contractor|homologation|homologacao|supplier)\b/.test(s), area: "Operacional", score: 150 },
  { test: (s) => /\b(logistics|logistica|supply chain)\b/.test(s), area: "Operacional", score: 150 },
  { test: (s) => /qualidade/.test(s) && !/software|sistem/.test(s), area: "Operacional", score: 120 },
  { test: (s) => /\b(contract|contratos)\b/.test(s) && !/legal/.test(s), area: "Operacional", score: 100 },

  { test: (s) => /(governance|governanca).*(ti|it|technology)/.test(s), area: "TI", score: 300 },
  { test: (s) => /qualidade.*(software|sistem)/.test(s), area: "TI", score: 200 },
  { test: (s) => /\b(data|dados|analytics)\b/.test(s), area: "TI", score: 150 },
  { test: (s) => /\b(engineering|engenharia)\b/.test(s) && !/industrial|civil/.test(s), area: "TI", score: 150 },
  { test: (s) => /\b(infrastructure|infraestrutura)\b/.test(s), area: "TI", score: 120 },

  { test: (s) => /\b(commercial|comercial|sales|vendas)\b/.test(s), area: "Vendas", score: 200 },
  { test: (s) => /\baccount\b/.test(s) && !/accountant|contabil/.test(s), area: "Vendas", score: 150 },

  { test: (s) => /(responsabilidade social|sustentabilidade|esg)/.test(s), area: "Administração", score: 300 },
  { test: (s) => /\b(ceo|founder|presidente)\b/.test(s), area: "Administração", score: 200 },
  { test: (s) => /\b(governance|governanca)\b/.test(s) && !/ti|it|supply/.test(s), area: "Administração", score: 100 },

  { test: (s) => /\b(compliance|grc|dpo|aml|pld)\b/.test(s), area: "Compliance", score: 300 },
  { test: (s) => /\brisk.*management\b/.test(s) && /compliance/.test(s), area: "Compliance", score: 250 },

  { test: (s) => /\b(legal|juridico|attorney|lawyer|counsel)\b/.test(s) && !/compliance/.test(s), area: "Legal", score: 250 },

  { test: (s) => /\bproduct\b/.test(s) && !/governance|data/.test(s), area: "Produto", score: 200 },
];

function analyzeContext(cargoNorm: string): Scores {
  const scores: Scores = {};
  for (const rule of CONTEXT_RULES) {
    if (rule.test(cargoNorm)) bump(scores, rule.area, rule.score);
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Dimensão 3 — padrões estruturais (peso 10%)
// ---------------------------------------------------------------------------
const CHIEF_MAP: Record<string, string> = {
  compliance: "Compliance",
  legal: "Legal",
  technology: "TI",
  information: "TI",
  data: "TI",
  revenue: "Vendas",
  sales: "Vendas",
  people: "RH",
  human: "RH",
  marketing: "Marketing",
  product: "Produto",
  financial: "Finanças",
  operating: "Operacional",
};

function analyzeStructural(cargoNorm: string): Scores {
  const scores: Scores = {};
  if (/chief\s+\w+\s+officer/.test(cargoNorm)) {
    for (const [kw, area] of Object.entries(CHIEF_MAP)) {
      if (cargoNorm.includes(kw)) bump(scores, area, 50);
    }
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Regras de OVERRIDE — sempre se aplicam, na ordem do V5.
// ---------------------------------------------------------------------------
function applyOverrides(cargoNorm: string, scores: Scores): void {
  const s = cargoNorm;
  // 1. Gente/Humano = RH SEMPRE
  if (/\b(gente|people|humano|humana|human)\b/.test(s)) bump(scores, "RH", 1000);
  // 2. Supply Governance = Operacional (zera TI)
  if (/supply.*(governance|governanca)/.test(s)) {
    bump(scores, "Operacional", 1000);
    scores["TI"] = 0;
    scores["Administração"] = 0;
  }
  // 3. Compliance > Legal
  if (scores["Compliance"] && scores["Legal"]) {
    if (scores["Compliance"] > scores["Legal"] * 0.3) scores["Legal"] = 0;
  }
  // 4. Comunicação + RH context = RH (não Marketing)
  if (/(comunicacao|communication).*(gente|people|rh)/.test(s)) {
    bump(scores, "RH", 500);
    scores["Marketing"] = (scores["Marketing"] ?? 0) * 0.1;
  }
  // 5. Responsabilidade Social = Administração
  if (/(responsabilidade social|sustentabilidade|esg)/.test(s)) {
    bump(scores, "Administração", 800);
    scores["Marketing"] = 0;
  }
  // 6. Sales = Vendas (prioridade)
  if (/\b(sales|vendas)\b/.test(s)) bump(scores, "Vendas", 300);
  // 7. COO = Operacional SEMPRE (não TI!)
  if (/\b(coo|chief operating officer)\b/.test(s)) {
    bump(scores, "Operacional", 2000);
    scores["TI"] = 0;
  }
  // 8. Compliance + ESG = Compliance (reduz Administração)
  if (/compliance/.test(s) && /esg/.test(s)) {
    bump(scores, "Compliance", 1500);
    scores["Administração"] = (scores["Administração"] ?? 0) * 0.2;
  }
  // 9. Jurídico + Compliance = Compliance
  if (/juridico.*compliance|legal.*compliance/.test(s)) {
    bump(scores, "Compliance", 1500);
    scores["Legal"] = (scores["Legal"] ?? 0) * 0.3;
  }
  // 10. Product sem contexto TI = Produto
  if (/\bproduct\b/.test(s) && !/governance|data|it|ti/.test(s)) {
    bump(scores, "Produto", 1000);
  }
  // 11. Engineering sem "industrial" = TI
  if (/\b(engineering|engenharia)\b/.test(s) && !/industrial|civil/.test(s)) {
    bump(scores, "TI", 800);
  }
  // 12. Industrial Manager = Operacional
  if (/\bindustrial\b/.test(s) && !/engineer/.test(s)) {
    bump(scores, "Operacional", 1000);
    scores["TI"] = 0;
  }
  // 13. Contract Manager (sem Legal) = Operacional
  if (/\bcontract/.test(s) && !/legal|juridico/.test(s)) {
    bump(scores, "Operacional", 800);
  }
  // 14. Commercial = Vendas
  if (/\b(commercial|comercial)\b/.test(s)) bump(scores, "Vendas", 1000);
  // 15. Pessoas = RH (força extra)
  if (/\bpessoas\b/.test(s)) bump(scores, "RH", 1500);
  // 16. CEO/Chief Executive = Administração (não TI!)
  if (/\b(ceo|chief executive)\b/.test(s)) {
    bump(scores, "Administração", 2000);
    scores["TI"] = 0;
  }
  // 17. COO/Chief Operating = Operacional (não TI!)
  if (/\bchief.*operat/.test(s) || /\bcoo\b/.test(s)) {
    bump(scores, "Operacional", 2000);
    scores["TI"] = 0;
  }
  // 18. Product + Governança TI = TI (não Produto!)
  if (/product/.test(s) && /governanca.*(ti|it|technology)|ti.*governanca/.test(s)) {
    bump(scores, "TI", 2000);
    scores["Produto"] = 0;
  }
  // 19. Quality Manager (sem software) = Operacional
  if (/quality manager|gerente.*qualidade/.test(s) && !/software|ti|it/.test(s)) {
    bump(scores, "Operacional", 1000);
    scores["TI"] = 0;
  }
  // 20. Medical/Health context = Administração (não TI!)
  if (/\b(medical|health|saude)\b/.test(s)) {
    bump(scores, "Administração", 1500);
    scores["TI"] = 0;
  }
  // 21. Compliance + Sustentabilidade = Compliance
  if (/compliance/.test(s) && /sustentabilidade/.test(s)) {
    bump(scores, "Compliance", 1800);
    scores["Administração"] = (scores["Administração"] ?? 0) * 0.3;
  }
  // 22. Sales + Marketing/Engineering Director = Vendas
  if (/sales.*marketing|sales.*engineering/.test(s)) {
    bump(scores, "Vendas", 1500);
    scores["TI"] = (scores["TI"] ?? 0) * 0.3;
  }
  // 23. Jurídico + Governança = Legal (não TI!)
  if (/juridico|legal/.test(s) && /governanca/.test(s)) {
    bump(scores, "Legal", 1800);
    scores["TI"] = 0;
  }
  // 24. RH + Comunicação = RH (não Administração!)
  if (/\b(rh|recursos humanos)\b/.test(s) && /comunicacao/.test(s)) {
    bump(scores, "RH", 1800);
    scores["Administração"] = 0;
  }
}

function pickWinner(scores: Scores): string {
  const entries = Object.entries(scores);
  if (entries.length === 0) return UNCLASSIFIED;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// ---------------------------------------------------------------------------
// Nível hierárquico
// ---------------------------------------------------------------------------
const C_LEVEL_PATTERNS = [
  /\bchief\b/,
  /\b(ceo|cto|cio|cfo|coo|cmo|cpo|cso|cdo|cro|cco|ciso|chro|clo|cdao|cino)\b/,
  /\b(vp|vice president|vice presidente|evp|svp)\b/,
  /\b(socio|socia|partner|founder|fundador|fundadora|co-founder|cofundador)\b/,
  /\b(owner|proprietario|proprietaria|president|presidente)\b/,
];

const DIRETOR_PATTERNS = [
  /\b(director|diretor|diretora)\b/,
  /\b(executive\s+director|diretor\s+executivo)\b/,
  /\b(senior\s+director|associate\s+director)\b/,
];

const GERENTE_PATTERNS = [
  /\b(manager|gerente|gerenta)\b/,
  /\b(general\s+manager)\b/,
  /\b(senior\s+manager|executive\s+manager)\b/,
  /\b(head|head\s+of)\b/,
  /\b(lider|lidera|lead|leader|team\s+lead|tech\s+lead)\b/,
  /\b(superintendente|superintendent)\b/,
  /\b(supervisor|supervisora|team\s+leader)\b/,
  /\b(responsavel)\b/,
];

const ANALISTA_PATTERNS = [
  /\b(analyst|analista)\b/,
  /\b(specialist|especialista)\b/,
  /\b(senior|sr|sr\.|pleno|plena)\b/,
  /\b(junior|jr|jr\.|trainee)\b/,
  /\b(staff|principal)\b/,
  /\b(consultor|consultora|consultant|advisor)\b/,
  /\b(associate|associado|associada)\b/,
  /\b(assistant|assistente)\b/,
  /\b(estagiario|estagiaria|intern)\b/,
];

export function classifyCargoNivel(cargoNorm: string): string {
  // Coordenador PRIMEIRO (não é C-Level!)
  if (/\b(coordenador|coordenadora|coordinator)\b/.test(cargoNorm)) return "Gerente";
  for (const p of C_LEVEL_PATTERNS) if (p.test(cargoNorm)) return "C-Level";
  // Officer SEM chief: Compliance/Legal/Risk/Audit/Security Officer = Diretor.
  if (/\bofficer\b/.test(cargoNorm) && !/\bchief\b/.test(cargoNorm)) {
    if (/\b(compliance|legal|risk|audit|security)\b/.test(cargoNorm)) return "Diretor";
  }
  for (const p of DIRETOR_PATTERNS) {
    if (p.test(cargoNorm) && !/\bchief\b/.test(cargoNorm)) return "Diretor";
  }
  for (const p of GERENTE_PATTERNS) if (p.test(cargoNorm)) return "Gerente";
  for (const p of ANALISTA_PATTERNS) if (p.test(cargoNorm)) return "Analista";
  return "Outros";
}

// ---------------------------------------------------------------------------
// Normalização (preserva contexto — V5)
// ---------------------------------------------------------------------------
const STRONG_DELIMITERS = [" - ", " at ", " @ ", " | "];
const PALAVRAS_DE_CARGO = [
  "compliance", "legal", "ti", "it", "tecnologia", "technology",
  "vendas", "sales", "marketing", "rh", "hr", "pessoas", "people",
  "operacoes", "operations", "financas", "finance", "produto", "product",
  "dados", "data", "analytics", "customer", "success", "quality",
  "qualidade", "supply", "comunicacao", "communication",
];

export function normalizeCargo(raw: string): string {
  let norm = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const delim of STRONG_DELIMITERS) {
    if (norm.includes(delim)) {
      norm = norm.split(delim)[0].trim();
      break;
    }
  }
  // " em " só remove quando a 2ª parte parece EMPRESA (não área de cargo).
  if (norm.includes(" em ")) {
    const partes = norm.split(" em ");
    if (partes.length === 2) {
      const segunda = partes[1].trim();
      const ehCargo = PALAVRAS_DE_CARGO.some((p) => segunda.includes(p));
      if (!ehCargo) {
        const pareceEmpresa =
          segunda.length > 15 ||
          /\b(grupo|company|corp|inc|ltda|sa|banco|bank)\b/.test(segunda);
        if (pareceEmpresa) norm = partes[0].trim();
      }
    }
  }
  return norm;
}

/**
 * Classifica um cargo livre em Área + Nível — mesmo pipeline do V5. Lixo
 * (só números, < 3 chars, sem letras) devolve ambos "Não Classificado".
 */
export function classifyCargo(raw: unknown): CargoClassification {
  const original = String(raw ?? "").trim();
  if (
    original === "" ||
    /^\d+$/.test(original) ||
    original.length < 3 ||
    !/[a-zA-Z]/.test(original)
  ) {
    return { area: UNCLASSIFIED, nivel: UNCLASSIFIED };
  }
  const norm = normalizeCargo(original);

  const scores: Scores = {};
  for (const [area, v] of Object.entries(analyzeKeywords(norm)))
    bump(scores, area, v * 0.4);
  for (const [area, v] of Object.entries(analyzeContext(norm)))
    bump(scores, area, v * 0.5);
  for (const [area, v] of Object.entries(analyzeStructural(norm)))
    bump(scores, area, v * 0.1);
  applyOverrides(norm, scores);

  return { area: pickWinner(scores), nivel: classifyCargoNivel(norm) };
}
