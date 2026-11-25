import { sanitizeExternalUrl } from './keywords.ts';

export type CourseReferenceItem = {
  externalId: string;
  type: 'COURSE' | 'PAPER';
  title: string;
  provider: 'MIT_OCW' | 'CURATED_OCW' | 'OPENALEX';
  summary: string;
  url: string;
};

type CuratedCourseEntry = {
  externalId: string;
  title: string;
  provider: 'MIT_OCW' | 'CURATED_OCW';
  summary: string;
  url: string;
  keywords: string[];
};

const CURATED_OCW_CATALOG: CuratedCourseEntry[] = [
  {
    externalId: 'mit-6-824',
    title: 'MIT 6.824 Distributed Systems',
    provider: 'MIT_OCW',
    summary:
      '經典分散式系統工程課程，涵蓋 Raft 共識演算法、容錯機制、分散式交易與線性一致性實作。',
    url: 'https://pdos.csail.mit.edu/6.824/',
    keywords: ['distributed', 'systems', 'raft', 'consensus', 'fault', '分散式', '共識', '系統'],
  },
  {
    externalId: 'mit-6-s191',
    title: 'MIT 6.S191 Introduction to Deep Learning',
    provider: 'MIT_OCW',
    summary:
      '系統性介紹深度學習基礎架構、循環神經網路、Transformer 注意力機制與生成式模型數學推導。',
    url: 'https://introtodeeplearning.com/',
    keywords: [
      'deep',
      'learning',
      'neural',
      'transformer',
      'attention',
      'ai',
      'llm',
      '深度學習',
      '神經網路',
      '注意力',
    ],
  },
  {
    externalId: 'stanford-cs224n',
    title: 'Stanford CS224N Natural Language Processing with Deep Learning',
    provider: 'CURATED_OCW',
    summary:
      '深入剖析詞向量表徵、語言模型預訓練、指令微調、檢索增強生成（RAG）與語意理解評估方法。',
    url: 'https://web.stanford.edu/class/cs224n/',
    keywords: [
      'nlp',
      'language',
      'llm',
      'rag',
      'prompt',
      'embedding',
      '自然語言',
      '語言模型',
      '檢索',
    ],
  },
  {
    externalId: 'mit-18-06',
    title: 'MIT 18.06 Linear Algebra (Gilbert Strang)',
    provider: 'MIT_OCW',
    summary:
      '線性代數核心直覺與矩陣分解講義，包含特徵值分析、奇異值分解（SVD）與最小平方法在資料科學的應用。',
    url: 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/',
    keywords: ['linear', 'algebra', 'matrix', 'svd', 'eigenvalue', '線性代數', '矩陣', '數學'],
  },
  {
    externalId: 'mit-6-046j',
    title: 'MIT 6.046J Design and Analysis of Algorithms',
    provider: 'MIT_OCW',
    summary:
      '進階演算法設計與複雜度分析，涵蓋動態規劃、隨機化演算法、網路流與 NP-completeness 證明技巧。',
    url: 'https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2015/',
    keywords: ['algorithm', 'complexity', 'graph', 'dynamic', 'programming', '演算法', '複雜度'],
  },
  {
    externalId: 'mit-9-40',
    title: 'MIT 9.40 Introduction to Neural Computation',
    provider: 'MIT_OCW',
    summary:
      '計算神經科學與認知模型課程，探討神經編碼、突觸可塑性、貝葉斯決策理論與視覺皮層計算機制。',
    url: 'https://ocw.mit.edu/courses/9-40-introduction-to-neural-computation-spring-2018/',
    keywords: ['cognitive', 'neuroscience', 'brain', 'bayesian', '認知', '神經', '貝葉斯'],
  },
  {
    externalId: 'mit-14-01',
    title: 'MIT 14.01 Principles of Microeconomics',
    provider: 'MIT_OCW',
    summary:
      '個體經濟學核心理論，涵蓋消費者選擇、賽局論基礎、市場均衡與資訊不對稱下的機制設計。',
    url: 'https://ocw.mit.edu/courses/14-01-principles-of-microeconomics-fall-2018/',
    keywords: ['economics', 'game', 'theory', 'market', '經濟', '賽局', '市場'],
  },
  {
    externalId: 'stanford-hci',
    title: 'Stanford CS147 Introduction to Human-Computer Interaction Design',
    provider: 'CURATED_OCW',
    summary:
      '人機互動研究與介面設計方法論，包含使用者民族誌訪談、原型設計、認知負荷評估與無障礙介面規範。',
    url: 'https://hci.stanford.edu/courses/cs147/',
    keywords: [
      'hci',
      'interface',
      'design',
      'ux',
      'usability',
      'accessibility',
      '人機互動',
      '介面',
      '使用者',
    ],
  },
  {
    externalId: 'mit-6-858',
    title: 'MIT 6.858 Computer Systems Security',
    provider: 'MIT_OCW',
    summary:
      '資訊安全系統設計與威脅模型分析，涵蓋瀏覽器隔離、權限最小化原則、驗證協議與記憶體安全防護。',
    url: 'https://css.csail.mit.edu/6.858/',
    keywords: [
      'security',
      'auth',
      'oauth',
      'privacy',
      'web',
      'cryptography',
      '資安',
      '驗證',
      '隱私',
    ],
  },
  {
    externalId: 'harvard-stat110',
    title: 'Harvard Stat 110 Probability',
    provider: 'CURATED_OCW',
    summary:
      '機率論與隨機過程經典講義，講解條件期望值、馬可夫鏈、貝葉斯推論與極限定理在實驗設計的應用。',
    url: 'https://projects.iq.harvard.edu/stat110/',
    keywords: ['probability', 'statistics', 'markov', 'inference', '機率', '統計', '推論'],
  },
  {
    externalId: 'mit-sts-003',
    title: 'MIT STS.003 The Rise of Modern Science',
    provider: 'MIT_OCW',
    summary:
      '科學史與研究方法論，探討科學範式轉移、實證研究設計、同儕審查制度與知識生產脈絡。',
    url: 'https://ocw.mit.edu/courses/sts-003-the-rise-of-modern-science-fall-2010/',
    keywords: ['science', 'methodology', 'history', 'philosophy', 'research', '科學', '方法論', '研究'],
  },
  {
    externalId: 'berkeley-cs188',
    title: 'UC Berkeley CS188 Introduction to Artificial Intelligence',
    provider: 'CURATED_OCW',
    summary:
      '人工智慧基礎教材，涵蓋搜尋演算法、馬可夫決策過程（MDP）、強化學習與機率推理圖模型。',
    url: 'https://inst.eecs.berkeley.edu/~cs188/',
    keywords: ['ai', 'search', 'reinforcement', 'mdp', 'agent', '人工智慧', '強化學習', '代理'],
  },
];

export async function searchCuratedCourses(
  query: string,
  signal: AbortSignal,
  limit = 4,
): Promise<CourseReferenceItem[]> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const scored = CURATED_OCW_CATALOG.map((entry) => {
    const haystack = `${entry.title} ${entry.summary} ${entry.keywords.join(' ')}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (entry.keywords.some((kw) => kw.includes(term) || term.includes(kw))) {
        score += 3;
      } else if (haystack.includes(term)) {
        score += 1;
      }
    }
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const matched = scored.filter((item) => item.score > 0).slice(0, limit);
  const selected = matched.length > 0 ? matched : scored.slice(0, Math.min(2, limit));

  const results: CourseReferenceItem[] = [];
  for (const { entry } of selected) {
    const safeUrl = sanitizeExternalUrl(entry.url);
    if (!safeUrl) continue;
    results.push({
      externalId: entry.externalId,
      type: 'COURSE',
      title: entry.title,
      provider: entry.provider,
      summary: entry.summary,
      url: safeUrl,
    });
  }
  return results;
}
