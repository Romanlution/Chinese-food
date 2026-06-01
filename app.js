const EXAM_SIZE = 100;
const LETTERS = ["A", "B", "C", "D"];
const BLANK_RE = /[（(]\s*[）)]/g;
const analysisCache = new WeakMap();
const WRONG_BANK_KEY = "miandian_wrong_bank_v1";
const ARCHIVE_KEY = "miandian_archive_v1";
const SESSION_KEY = "miandian_exam_session_v1";

const els = {
  questionCounter: document.querySelector("#questionCounter"),
  scoreValue: document.querySelector("#scoreValue"),
  questionType: document.querySelector("#questionType"),
  categoryName: document.querySelector("#categoryName"),
  progressFill: document.querySelector("#progressFill"),
  questionBadge: document.querySelector("#questionBadge"),
  questionId: document.querySelector("#questionId"),
  questionStem: document.querySelector("#questionStem"),
  optionsList: document.querySelector("#optionsList"),
  feedback: document.querySelector("#feedback"),
  nextButton: document.querySelector("#nextButton"),
  quizScreen: document.querySelector("#quizScreen"),
  resultScreen: document.querySelector("#resultScreen"),
  resultScore: document.querySelector("#resultScore"),
  resultRate: document.querySelector("#resultRate"),
  restartButton: document.querySelector("#restartButton"),
  mistakesList: document.querySelector("#mistakesList"),
  libraryScreen: document.querySelector("#libraryScreen"),
  libraryLabel: document.querySelector("#libraryLabel"),
  libraryTitle: document.querySelector("#libraryTitle"),
  librarySummary: document.querySelector("#librarySummary"),
  libraryList: document.querySelector("#libraryList"),
  resumeButton: document.querySelector("#resumeButton"),
  wrongBankButton: document.querySelector("#wrongBankButton"),
  archiveButton: document.querySelector("#archiveButton"),
  continueButton: document.querySelector("#continueButton"),
};

const state = {
  bank: [],
  exam: [],
  currentIndex: 0,
  score: 0,
  answered: false,
  selectedAnswer: null,
  answers: [],
  wrongBank: {},
  archive: {},
  completed: false,
  activeScreen: "quiz",
};

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function sample(items, count) {
  return shuffle(items).slice(0, count);
}

function loadStoredMap(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(WRONG_BANK_KEY, JSON.stringify(state.wrongBank));
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state.archive));
}

function saveExamSession() {
  if (state.exam.length !== EXAM_SIZE) {
    return;
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    exam: state.exam,
    currentIndex: state.currentIndex,
    score: state.score,
    answered: state.answered,
    selectedAnswer: state.selectedAnswer,
    answers: state.answers,
    completed: state.completed,
  }));
}

function clearExamSession() {
  localStorage.removeItem(SESSION_KEY);
}

function loadExamSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.exam)) {
      return null;
    }
    if (parsed.exam.length !== EXAM_SIZE || !Number.isInteger(parsed.currentIndex)) {
      return null;
    }
    if (parsed.currentIndex < 0 || parsed.currentIndex >= EXAM_SIZE) {
      return null;
    }
    const bankIds = new Set(state.bank.map((question) => question.id));
    if (!parsed.exam.every((question) => bankIds.has(question.id) && Array.isArray(question.options))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function restoreExamSession(session) {
  state.exam = session.exam;
  state.currentIndex = session.currentIndex;
  state.score = Number(session.score) || 0;
  state.answered = Boolean(session.answered);
  state.selectedAnswer = session.selectedAnswer ?? null;
  state.answers = Array.isArray(session.answers) ? session.answers : [];
  state.completed = Boolean(session.completed);
}

function getProgressCounts() {
  return {
    wrong: Object.keys(state.wrongBank).length,
    archived: Object.keys(state.archive).length,
  };
}

function normalizeAnswer(value) {
  return String(value).replace(/\s+/g, "").trim();
}

function getComparableAnswerKey(answer) {
  const normalized = normalizeAnswer(answer)
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248))
    .toLowerCase();
  const numericMatches = normalized.match(/[0-9]+(?:\.[0-9]+)?/g);
  if (!numericMatches) {
    return normalized;
  }

  const values = numericMatches.map(Number).filter(Number.isFinite);
  if (values.length === 0) {
    return normalized;
  }
  const valueKey = values.join("-");

  if (/小时|h/.test(normalized)) {
    return `minutes:${values.map((value) => value * 60).join("-")}`;
  }
  if (/min|分钟/.test(normalized)) {
    return `minutes:${valueKey}`;
  }
  if (/℃|摄氏度/.test(normalized)) {
    return `temperature:${valueKey}`;
  }
  if (/%|％/.test(normalized)) {
    return `percent:${valueKey}`;
  }
  return normalized;
}

function getAnswerKind(answer) {
  if (/[0-9０-９%％℃°~～\-—/：:]/.test(answer)) {
    return "number";
  }
  if (answer.length <= 4) {
    return "short";
  }
  return "text";
}

function answerSelfProfile(answer) {
  const compact = String(answer).replace(/\s+/g, "");
  if (/±|e$|最大称量|误差|器差/.test(compact)) return "measurement";
  if (/[0-9０-９]/.test(compact)) return "number";
  if (/保存|存储|贮存|存放|保鲜|冷藏|冷冻|密封|干燥|保鲜袋|容器/.test(compact)) return "storage";
  if (/、|，|,/.test(compact)) return "list";
  if (/蛋白质|脂肪|维生素|氨基酸|无机盐|膳食纤维|道德|成本|毛利|净料|质量|安全|污染/.test(compact)) return "concept";
  if (/面团|面坯|粉团|水调|冷水|温水|热水|膨松|蓬松|发酵/.test(compact)) return "dough";
  if (/海带|牛奶|蔬菜|植物油|动物脂肪|肉|蛋|米|面|粉|粥|饭|饼|包|糕|酥|馒头|饺|窝头|玉米|小米|糯米|大米|粳米|绿豆|大豆|白菜|皮蛋|瘦肉|香料|十三香|食醋|小苏打|酵母|面肥|发酵粉|食用碱/.test(compact)) return "food";
  if (/入锅|下锅|出锅|开锅|加水|换水|旺火|小火|中火|急火|火候/.test(compact)) return "process";
  if (/蒸|煮|烙|烤|煎|贴|摊|拨|捏|揉|搓|叠|按|抄拌|拉剂|挖剂|印模|成形|熟制|调制|兑碱|装盘/.test(compact)) return "process";
  if (/机|秤|量杯|灶|烤箱|蒸柜|工具|模具|案板|设备|辊筒|旋钮|蒸笼|锅/.test(compact)) return "equipment";
  return getAnswerKind(answer);
}

function getQuestionFocus(question) {
  const stem = String(question.stem).replace(/\s+/g, "");
  const answer = String(question.answer).replace(/\s+/g, "");
  const profile = getAnswerProfile(question.answer, question.stem);

  if (/保存|存储|贮存|存放|保管|保鲜|冷藏|冷冻|密封|放在.*处|保持环境/.test(stem)) return "storage";
  if (/零点|示值|不大于|允差|允许误差|精度/.test(stem) && /±|e/.test(answer + stem)) return "tolerance";
  if (/偏载|标准.*码|最大称量|称量料斗/.test(stem) && /最大称量|1\//.test(answer)) return "load_fraction";
  if (/器差|误差.*变化|变化/.test(stem) && /变化/.test(answer + stem)) return "change_result";
  if (/误差/.test(stem) && /误差/.test(answer)) return "error_type";
  if (["temperature", "percent", "time", "weight", "ratio", "count", "number"].includes(profile)) return profile;
  if (/成本|核算|毛利|净料|售价|销售价格/.test(stem + answer)) return "cost";
  if (/火候|旺火|小火|中火|急火|微火|蒸制|烙制|烤制/.test(stem) && /火|温/.test(answer)) return "fire";
  if (/煮制|蒸制|烙制|烤制|煎制/.test(stem) && /入锅|下锅|沸水|冷水|旺火|小火|中火|火/.test(answer + stem)) return "cooking_condition";
  if (/香料|调味/.test(stem)) return "seasoning";
  if (/原料|主料|配料|食材|材料|调味|来源|食物来源|含有|包括|组成|用料/.test(stem)) return "ingredient";
  if (/安全|危险|避免|不能|不得|不正确|不建议|中毒|危害|污染|防止|触电|举报|法规/.test(stem)) return "safety";
  if (/具有|特点|特性|状态|呈现|口感|色泽|形态|作用|功能|效果|质量|原因|关键|要领|要求/.test(stem)) return "feature";
  if (/（\s*）面点|面点中/.test(question.stem) && /酥|糕|饼|面点/.test(answer)) return "pastry_type";
  if (/方法|手法|方式|工艺|流程|步骤|操作|成型|成形|制皮|熟制|煮制|蒸制|烙制|烤制|煎制|调制|成熟|采用|用.*制成|称为|需要/.test(stem)) return "method";
  if (/设备|工具|机|秤|量杯|模具|案板|面杖|蒸笼|锅|炉|烤箱|电饼铛|部件/.test(stem)) return "equipment";
  if (/道德|职业|成本|核算|法律|标准|原则|规范/.test(stem + answer)) return "concept";
  return "general";
}

function compactText(value) {
  return String(value)
    .replace(BLANK_RE, " ")
    .replace(/[，。,.;；:："'“”‘’（）()、\-—~～=+*/\\[\]【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAnswerProfile(answer, stem = "") {
  const text = `${answer} ${stem}`;
  const compact = text.replace(/\s+/g, "");
  const hasNumber = /[0-9０-９]/.test(answer);
  const unitRules = [
    ["temperature", /℃|摄氏度|水温|温度|火温|底温|面温|烤箱/],
    ["percent", /%|％|百分|占总|比例/],
    ["time", /分钟|min|小时|试用期|日期|年|月|日/],
    ["weight", /克|g|kg|千克|重量|质量|称量/iu],
    ["ratio", /[:：]|1[：:：]|水量|加水量|米：水|米:水|比例/],
    ["count", /种|类|条|步|层|倍|个|个月|颗|根|数量|几/],
  ];

  if (hasNumber) {
    for (const [unit, pattern] of unitRules) {
      if (pattern.test(compact)) {
        return unit;
      }
    }
  }

  if (hasNumber) {
    return "number";
  }
  if (/、|，|,/.test(answer)) {
    return "list";
  }
  if (/保存|存储|贮存|存放|保鲜|冷藏|冷冻|密封|干燥|保鲜袋|容器/.test(answer)) {
    return "storage";
  }
  if (/面团|面坯|粉团|水调|冷水|温水|热水|膨松|蓬松|发酵/.test(answer)) {
    return "dough";
  }
  if (/米|面|粉|粥|饭|饼|包|糕|酥|馒头|饺|窝头|玉米|小米|糯米|大米|粳米|豆沙|皮蛋|瘦肉|香料|主料|食材|原料|调味|食物|来源/.test(answer)) {
    return "food";
  }
  if (String(answer).length <= 3 && /方法|手法|成型|成形|工艺|操作|熟制/.test(stem)) {
    return "process";
  }
  if (/面团|面坯|粉团|水调|冷水|温水|热水|膨松|发酵/.test(compact)) {
    return "dough";
  }
  if (/米|面|粉|粥|饭|饼|包|糕|酥|馒头|饺|窝头|玉米|小米|糯米|大米|粳米|豆沙|皮蛋|瘦肉|香料|主料|食材|原料|调味|食物|来源/.test(compact)) {
    return "food";
  }
  if (/道德|职业|法律|安全|污染|营养|维生素|蛋白质|脂肪|成本|核算|毛利|净料/.test(compact)) {
    return "concept";
  }
  if (/保存|存储|贮存|存放|保鲜|冷藏|冷冻|密封|干燥|保鲜袋|容器/.test(compact)) {
    return "storage";
  }
  if (/入锅|下锅|出锅|开锅|加水|换水|旺火|小火|中火|急火|火候/.test(compact)) {
    return "process";
  }
  if (/蒸|煮|烙|烤|煎|贴|摊|拨|捏|揉|搓|叠|按|成形|熟制|操作|方法|工艺|制作/.test(compact)) {
    return "process";
  }
  if (/机|秤|量杯|灶|烤箱|蒸柜|工具|模具|案板|设备|辊筒|旋钮/.test(compact)) {
    return "equipment";
  }
  return getAnswerKind(answer);
}

function getContextText(stem) {
  const match = [...stem.matchAll(BLANK_RE)].pop();
  if (!match) {
    return compactText(stem);
  }
  const start = Math.max(0, match.index - 16);
  const end = Math.min(stem.length, match.index + match[0].length + 16);
  return compactText(stem.slice(start, end));
}

function getTokens(text) {
  const compact = compactText(text).replace(/\s+/g, "");
  const tokens = new Set();
  const phrases = compact.match(/[\u4e00-\u9fa5A-Za-z0-9%％℃]{2,}/g) || [];

  for (const phrase of phrases) {
    if (phrase.length <= 4) {
      tokens.add(phrase);
    }
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= phrase.length - size; index += 1) {
        tokens.add(phrase.slice(index, index + size));
      }
    }
  }

  [
    "下列",
    "以下",
    "属于",
    "不属",
    "的是",
    "选项",
    "制作",
    "使用",
    "一般",
    "主要",
    "正确",
    "错误",
  ].forEach((token) => tokens.delete(token));

  return tokens;
}

function intersectionSize(first, second) {
  let total = 0;
  first.forEach((value) => {
    if (second.has(value)) {
      total += 1;
    }
  });
  return total;
}

function getAnswerFormKey(answer) {
  const compact = String(answer).replace(/\s+/g, "");
  if (/面团/.test(compact)) return "面团";
  if (/面坯/.test(compact)) return "面坯";
  if (/粉团/.test(compact)) return "粉团";
  if (/旺火|小火|中火|急火|火候/.test(compact)) return "火候";
  return "";
}

function getQuestionAnalysis(question) {
  if (analysisCache.has(question)) {
    return analysisCache.get(question);
  }

  const analysis = {
    profile: getAnswerProfile(question.answer, question.stem),
    selfProfile: answerSelfProfile(question.answer),
    tokens: getTokens(question.stem),
    contextTokens: getTokens(getContextText(question.stem)),
    answerTokens: getTokens(question.answer),
    formKey: getAnswerFormKey(question.answer),
    focus: getQuestionFocus(question),
  };
  analysisCache.set(question, analysis);
  return analysis;
}

function scoreDistractor(question, candidate) {
  const questionAnalysis = getQuestionAnalysis(question);
  const candidateAnalysis = getQuestionAnalysis(candidate);
  let score = 0;

  if (candidate.category === question.category) score += 20;
  if (candidateAnalysis.focus === questionAnalysis.focus) {
    score += 75;
  } else if (questionAnalysis.focus !== "general") {
    score -= 85;
  }
  if (candidateAnalysis.profile === questionAnalysis.profile) score += 32;
  if (!["short", "text"].includes(questionAnalysis.selfProfile)) {
    score += candidateAnalysis.selfProfile === questionAnalysis.selfProfile ? 42 : -70;
  }
  if (questionAnalysis.formKey) {
    score += candidateAnalysis.formKey === questionAnalysis.formKey ? 45 : -55;
    if (String(candidate.answer).length > String(question.answer).length + 2) {
      score -= 45;
    }
  }
  if (getAnswerKind(candidate.answer) === getAnswerKind(question.answer)) score += 12;
  score += intersectionSize(questionAnalysis.tokens, candidateAnalysis.tokens) * 5;
  score += intersectionSize(questionAnalysis.contextTokens, candidateAnalysis.contextTokens) * 10;
  score += intersectionSize(questionAnalysis.contextTokens, candidateAnalysis.answerTokens) * 8;

  const lengthGap = Math.abs(String(candidate.answer).length - String(question.answer).length);
  score -= Math.min(lengthGap, 12);

  if (questionAnalysis.profile !== candidateAnalysis.profile && getAnswerKind(question.answer) === "number") {
    score -= 60;
  }
  if (/以上都是/.test(candidate.answer) && !/下列|以下|选项/.test(question.stem)) {
    score -= 25;
  }
  if (/^[A-DＡ-Ｄ]$/.test(candidate.answer)) {
    score -= 80;
  }

  return score;
}

function isCompatibleProfile(questionProfile, candidateProfile) {
  const numericProfiles = new Set(["temperature", "percent", "time", "weight", "ratio", "count", "number"]);
  if (numericProfiles.has(questionProfile)) {
    return candidateProfile === questionProfile || (questionProfile === "count" && candidateProfile === "number");
  }
  if (["dough", "food", "process", "equipment", "concept", "storage"].includes(questionProfile)) {
    return candidateProfile === questionProfile;
  }
  if (questionProfile === "list") {
    return candidateProfile === "list";
  }
  return candidateProfile === questionProfile;
}

function formatSyntheticNumber(baseAnswer, value) {
  const trimmed = String(baseAnswer).trim();
  const suffix = trimmed.match(/[℃%％]|摄氏度|分钟|min|小时|个月|克|g|kg|倍|种|类|条|步$/iu)?.[0] || "";
  return `${value}${suffix}`;
}

function getSyntheticDistractors(question, count, seen) {
  const profile = getAnswerProfile(question.answer, question.stem);
  const focus = getQuestionFocus(question);
  const compactStem = String(question.stem).replace(/\s+/g, "");
  const syntheticByFocus = {
    storage: [
      "覆盖湿布常温保存",
      "敞开放在案板上保存",
      "装入保鲜袋冷冻保存",
      "放在通风处自然晾放",
      "直接暴露在室温下保存",
    ],
    seasoning: ["八角", "花椒", "桂皮", "姜丝", "葱花"],
    fire: ["小火", "中火", "微火", "急火旺气", "底火稍大"],
    cost: ["毛利率法", "净料成本法", "售价倒推法", "定额成本法", "分类核算法"],
    pastry_type: ["混酥", "清酥", "发酵", "水调", "米粉"],
    cooking_condition: ["冷水入锅", "温水入锅", "旺火沸水", "小火慢煮", "开锅后入锅"],
    tolerance: ["±1.0e", "±1.5e", "±0.25e", "±2e", "±0.5g"],
    load_fraction: ["1/2最大称量", "1/4最大称量", "1/5最大称量", "最大称量", "2/3最大称量"],
    change_result: ["器差增大", "器差减小", "器差先增后减", "器差发生变化", "器差不稳定"],
    error_type: ["系统误差", "粗大误差", "相对误差", "绝对误差", "示值误差"],
  };

  if (focus === "ingredient") {
    let ingredientOptions = [];
    if (/碘|食物来源|来源/.test(compactStem)) {
      ingredientOptions = ["紫菜", "虾皮", "海鱼", "牛奶", "鸡蛋"];
    } else if (/玉米/.test(compactStem)) {
      ingredientOptions = ["玉米面", "玉米粉", "小米面", "糯米粉", "面粉"];
    } else if (/小米/.test(compactStem)) {
      ingredientOptions = ["小米", "玉米面", "大米", "糯米"];
    } else if (/粥|大米|糯米|粳米|米饭|米/.test(compactStem)) {
      ingredientOptions = ["大米", "糯米", "粳米", "小米", "玉米"];
    }
    const picked = [];
    for (const answer of ingredientOptions) {
      const key = getComparableAnswerKey(answer);
      if (seen.has(key) || hasAmbiguousContainment(question.answer, answer)) {
        continue;
      }
      seen.add(key);
      picked.push(answer);
      if (picked.length === count) {
        return picked;
      }
    }
    if (picked.length > 0) {
      return picked;
    }
  }

  if (focus === "feature" && /、|，|,/.test(question.answer)) {
    const featureOptions = ["黏性、延展性", "松散、可塑性", "柔软、弹性", "干硬、脆性", "疏松、膨大"];
    const picked = [];
    for (const answer of featureOptions) {
      const key = getComparableAnswerKey(answer);
      if (seen.has(key) || hasAmbiguousContainment(question.answer, answer)) {
        continue;
      }
      seen.add(key);
      picked.push(answer);
      if (picked.length === count) {
        return picked;
      }
    }
    return picked;
  }

  if (syntheticByFocus[focus]) {
    const picked = [];
    for (const answer of syntheticByFocus[focus]) {
      const key = getComparableAnswerKey(answer);
      if (seen.has(key) || hasAmbiguousContainment(question.answer, answer)) {
        continue;
      }
      seen.add(key);
      picked.push(answer);
      if (picked.length === count) {
        return picked;
      }
    }
    return picked;
  }

  const numericMatch = String(question.answer).match(/[0-9０-９]+(?:[.．][0-9０-９]+)?/);
  if (!numericMatch) {
    return [];
  }

  const normalizedNumber = numericMatch[0].replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).replace("．", ".");
  const value = Number(normalizedNumber);
  if (!Number.isFinite(value)) {
    return [];
  }

  const integerValue = Math.round(value);
  const plans = {
    temperature: [integerValue - 20, integerValue - 10, integerValue + 10, integerValue + 20],
    percent: [integerValue - 10, integerValue + 10, integerValue + 20, integerValue - 20],
    time: [integerValue - 10, integerValue - 5, integerValue + 5, integerValue + 10],
    weight: [integerValue - 50, integerValue + 50, integerValue + 100, integerValue - 100],
    ratio: [integerValue - 3, integerValue - 1, integerValue + 1, integerValue + 3],
    count: [integerValue - 2, integerValue - 1, integerValue + 1, integerValue + 2],
    number: [integerValue - 2, integerValue - 1, integerValue + 1, integerValue + 2],
  };
  const candidates = plans[profile] || plans.number;
  const picked = [];

  for (const candidate of candidates) {
    if (candidate <= 0 || candidate === value) {
      continue;
    }
    const answer = formatSyntheticNumber(question.answer, Number.isInteger(value) ? candidate : candidate.toFixed(1));
    const key = getComparableAnswerKey(answer);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    picked.push(answer);
    if (picked.length === count) {
      return picked;
    }
  }

  return picked;
}

function hasAmbiguousContainment(correctAnswer, candidateAnswer) {
  const correct = normalizeAnswer(correctAnswer);
  const candidate = normalizeAnswer(candidateAnswer);
  if (!correct || !candidate || correct === candidate) {
    return false;
  }
  return getComparableAnswerKey(correctAnswer) === getComparableAnswerKey(candidateAnswer) ||
    correct.includes(candidate) ||
    candidate.includes(correct);
}

function getDistractors(question, count, excludedIds = new Set()) {
  const available = state.bank.filter((item) => item.id !== question.id && !excludedIds.has(item.id));
  const picked = [];
  const seen = new Set([getComparableAnswerKey(question.answer)]);
  const questionAnalysis = getQuestionAnalysis(question);
  const syntheticFirstFocuses = new Set([
    "storage",
    "seasoning",
    "fire",
    "cost",
    "pastry_type",
    "cooking_condition",
    "ingredient",
    "tolerance",
    "load_fraction",
    "change_result",
    "error_type",
  ]);
  const useFeatureSynthetic = questionAnalysis.focus === "feature" && /、|，|,/.test(question.answer);

  if (syntheticFirstFocuses.has(questionAnalysis.focus) || useFeatureSynthetic) {
    const synthetic = getSyntheticDistractors(question, count, seen);
    if (synthetic.length === count) {
      return synthetic;
    }
    picked.push(...synthetic);
  }

  const scored = available
    .map((item) => ({
      item,
      score: scoreDistractor(question, item),
      profile: getQuestionAnalysis(item).profile,
      selfProfile: getQuestionAnalysis(item).selfProfile,
      focus: getQuestionAnalysis(item).focus,
    }))
    .filter(({ item, score }) =>
      score > -20 &&
      !/^[A-DＡ-Ｄ]$/.test(item.answer) &&
      !hasAmbiguousContainment(question.answer, item.answer) &&
      !seen.has(getComparableAnswerKey(item.answer))
    )
    .sort((a, b) => b.score - a.score || Math.random() - 0.5);

  const passes = [
    ...(questionAnalysis.formKey
      ? [scored.filter(({ item }) => getQuestionAnalysis(item).formKey === questionAnalysis.formKey)]
      : []),
    ...(questionAnalysis.focus !== "general"
      ? [scored.filter(({ focus }) => focus === questionAnalysis.focus)]
      : []),
    ...(!["short", "text"].includes(questionAnalysis.selfProfile)
      ? [scored.filter(({ item, selfProfile }) =>
          selfProfile === questionAnalysis.selfProfile &&
          (!questionAnalysis.formKey || getQuestionAnalysis(item).formKey === questionAnalysis.formKey)
        )]
      : []),
    scored.filter(({ profile }) => isCompatibleProfile(questionAnalysis.profile, profile)),
    scored.filter(({ score }) => score >= 38),
    scored.filter(({ score }) => score >= 20),
  ];

  for (const pass of passes) {
    for (const { item } of pass) {
      const key = getComparableAnswerKey(item.answer);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      picked.push(item.answer);
      if (picked.length === count) {
        return picked;
      }
    }
  }

  picked.push(...getSyntheticDistractors(question, count - picked.length, seen));
  if (picked.length === count) {
    return picked;
  }

  for (const { item } of scored) {
    const key = getComparableAnswerKey(item.answer);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    picked.push(item.answer);
    if (picked.length === count) {
      return picked;
    }
  }

  for (const item of shuffle(available)) {
    const key = getComparableAnswerKey(item.answer);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    picked.push(item.answer);
    if (picked.length === count) {
      return picked;
    }
  }

  return picked;
}

function buildChoiceQuestion(question) {
  const distractors = getDistractors(question, 3);
  if (distractors.length < 3) {
    return null;
  }

  return {
    ...question,
    type: "choice",
    displayStem: question.stem,
    options: shuffle([question.answer, ...distractors]),
    correctAnswer: question.answer,
  };
}

function createExam() {
  const selectedQuestions = [];
  const usedIds = new Set();
  const wrongIds = new Set(Object.keys(state.wrongBank).map(Number));
  const archivedIds = new Set(Object.keys(state.archive).map(Number));
  const wrongQuestions = state.bank.filter((question) => wrongIds.has(question.id) && !archivedIds.has(question.id));
  const regularQuestions = state.bank.filter((question) => !wrongIds.has(question.id));

  for (const question of shuffle(wrongQuestions)) {
    const choice = buildChoiceQuestion(question);
    if (choice) {
      choice.reviewSource = "wrong";
      selectedQuestions.push(choice);
      usedIds.add(question.id);
    }
    if (selectedQuestions.length === EXAM_SIZE) {
      break;
    }
  }

  for (const question of shuffle(regularQuestions)) {
    if (usedIds.has(question.id)) {
      continue;
    }
    const choice = buildChoiceQuestion(question);
    if (choice) {
      selectedQuestions.push(choice);
      usedIds.add(question.id);
    }
    if (selectedQuestions.length === EXAM_SIZE) {
      break;
    }
  }

  if (selectedQuestions.length !== EXAM_SIZE) {
    throw new Error("题库数量不足，无法生成 100 道单选题。");
  }

  return shuffle(selectedQuestions);
}

function setScreen(screen) {
  state.activeScreen = screen;
  const showQuiz = screen === "quiz";
  const showResult = screen === "result";
  const showLibrary = screen === "library";

  els.quizScreen.hidden = !showQuiz;
  els.resultScreen.hidden = !showResult;
  els.libraryScreen.hidden = !showLibrary;
  els.quizScreen.classList.toggle("active", showQuiz);
  els.resultScreen.classList.toggle("active", showResult);
  els.libraryScreen.classList.toggle("active", showLibrary);

  els.resumeButton.classList.toggle("active", showQuiz || showResult);
  els.wrongBankButton.classList.toggle("active", showLibrary && els.libraryScreen.dataset.mode === "wrong");
  els.archiveButton.classList.toggle("active", showLibrary && els.libraryScreen.dataset.mode === "archive");
}

function findCurrentAnswerRecord() {
  const question = state.exam[state.currentIndex];
  return [...state.answers].reverse().find((answer) =>
    answer.id === question.id &&
    (answer.examIndex === undefined || answer.examIndex === state.currentIndex)
  );
}

function applyAnswerFeedback(question, selectedAnswer, isCorrect, progressMessage = "") {
  const buttons = [...els.optionsList.querySelectorAll(".option-button")];

  buttons.forEach((button) => {
    button.disabled = true;
    button.classList.toggle("selected", normalizeAnswer(button.dataset.value) === normalizeAnswer(selectedAnswer));
    if (normalizeAnswer(button.dataset.value) === normalizeAnswer(question.correctAnswer)) {
      button.classList.add("correct");
    }
  });

  if (!isCorrect) {
    const selectedButton = buttons.find((button) => normalizeAnswer(button.dataset.value) === normalizeAnswer(selectedAnswer));
    selectedButton?.classList.add("wrong");
  }

  els.feedback.hidden = false;
  els.feedback.classList.add(isCorrect ? "correct" : "wrong");
  els.feedback.textContent = [
    isCorrect ? `回答正确。正确答案：${question.correctAnswer}` : `回答错误。正确答案：${question.correctAnswer}`,
    progressMessage,
  ].filter(Boolean).join(" ");
  els.nextButton.disabled = false;
  els.progressFill.style.width = `${((state.currentIndex + 1) / EXAM_SIZE) * 100}%`;
}

function renderCurrentQuestion({ resetInteraction = true } = {}) {
  const question = state.exam[state.currentIndex];
  const number = state.currentIndex + 1;
  const typeName = question.reviewSource === "wrong" ? "错题复习" : "单选题";
  const counts = getProgressCounts();

  if (resetInteraction) {
    state.answered = false;
    state.selectedAnswer = null;
  }
  els.questionCounter.textContent = `第 ${number} / ${EXAM_SIZE} 题`;
  els.scoreValue.textContent = state.score;
  els.questionType.textContent = typeName;
  els.categoryName.textContent = `${question.category} · 错题 ${counts.wrong} · 归档 ${counts.archived}`;
  els.questionBadge.textContent = typeName;
  els.questionId.textContent = `原题 ${question.id}`;
  els.questionStem.textContent = question.displayStem;
  els.feedback.hidden = true;
  els.feedback.className = "feedback";
  els.feedback.textContent = "";
  els.nextButton.disabled = true;
  els.nextButton.textContent = number === EXAM_SIZE ? "查看结果" : "下一题";
  els.progressFill.style.width = `${((number - 1) / EXAM_SIZE) * 100}%`;

  els.optionsList.innerHTML = "";
  question.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.className = "option-button";
    button.type = "button";
    button.dataset.value = option;
    button.innerHTML = `<span class="letter">${LETTERS[index] || ""}</span><span class="option-text"></span>`;
    button.querySelector(".option-text").textContent = option;
    button.addEventListener("click", () => selectAnswer(option, button));
    els.optionsList.append(button);
  });

  if (state.selectedAnswer !== null) {
    els.optionsList.querySelectorAll(".option-button").forEach((button) => {
      button.classList.toggle("selected", normalizeAnswer(button.dataset.value) === normalizeAnswer(state.selectedAnswer));
    });
    els.nextButton.disabled = false;
  }

  if (state.answered && state.selectedAnswer !== null) {
    const record = findCurrentAnswerRecord();
    const isCorrect = record ? record.isCorrect : normalizeAnswer(state.selectedAnswer) === normalizeAnswer(question.correctAnswer);
    applyAnswerFeedback(question, state.selectedAnswer, isCorrect);
  }
}

function selectAnswer(selectedAnswer, selectedButton) {
  if (state.answered) {
    return;
  }

  state.selectedAnswer = selectedAnswer;
  els.optionsList.querySelectorAll(".option-button").forEach((button) => {
    button.classList.toggle("selected", button === selectedButton);
  });
  els.nextButton.disabled = false;
  saveExamSession();
}

function updateQuestionProgress(question, isCorrect) {
  const id = String(question.id);
  const now = new Date().toISOString();
  const existing = state.wrongBank[id];

  if (!isCorrect) {
    state.wrongBank[id] = {
      id: question.id,
      streak: 0,
      addedAt: existing?.addedAt || now,
      lastWrongAt: now,
      lastSeenAt: now,
    };
    delete state.archive[id];
    saveProgress();
    return "已加入错题库，连续答对 3 次后归档。";
  }

  if (!existing) {
    return "";
  }

  const nextStreak = (existing.streak || 0) + 1;
  if (nextStreak >= 3) {
    delete state.wrongBank[id];
    state.archive[id] = {
      id: question.id,
      archivedAt: now,
      lastSeenAt: now,
    };
    saveProgress();
    return "错题已连续答对 3 次，已转入归档。";
  }

  state.wrongBank[id] = {
    ...existing,
    streak: nextStreak,
    lastSeenAt: now,
  };
  saveProgress();
  return `错题库进度：已连续答对 ${nextStreak}/3 次。`;
}

function evaluateSelectedAnswer() {
  if (state.answered || state.selectedAnswer === null) {
    return;
  }

  const question = state.exam[state.currentIndex];
  const selectedAnswer = state.selectedAnswer;
  const isCorrect = normalizeAnswer(selectedAnswer) === normalizeAnswer(question.correctAnswer);

  state.answered = true;
  if (isCorrect) {
    state.score += 1;
  }
  const progressMessage = updateQuestionProgress(question, isCorrect);
  const counts = getProgressCounts();

  els.scoreValue.textContent = state.score;
  els.categoryName.textContent = `${question.category} · 错题 ${counts.wrong} · 归档 ${counts.archived}`;
  applyAnswerFeedback(question, selectedAnswer, isCorrect, progressMessage);

  state.answers.push({
    examIndex: state.currentIndex,
    id: question.id,
    type: question.type,
    category: question.category,
    stem: question.displayStem,
    selectedAnswer,
    correctAnswer: question.correctAnswer,
    sourceAnswer: question.answer,
    isCorrect,
  });
  saveExamSession();
}

function renderResults() {
  const mistakes = state.answers.filter((answer) => !answer.isCorrect);
  const rate = Math.round((state.score / EXAM_SIZE) * 100);
  const counts = getProgressCounts();

  state.completed = true;
  setScreen("result");
  els.questionCounter.textContent = "考试完成";
  els.questionType.textContent = "结果";
  els.categoryName.textContent = `错题 ${counts.wrong} · 归档 ${counts.archived}`;
  els.progressFill.style.width = "100%";
  els.resultScore.textContent = `${state.score} / ${EXAM_SIZE}`;
  els.resultRate.textContent = `正确率 ${rate}% · 当前错题库 ${counts.wrong} 题 · 已归档 ${counts.archived} 题`;
  els.mistakesList.innerHTML = "";
  saveExamSession();

  if (mistakes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "本次没有错题。";
    els.mistakesList.append(empty);
    return;
  }

  mistakes.forEach((mistake, index) => {
    const item = document.createElement("article");
    item.className = "mistake-item";
    item.innerHTML = `
      <p class="mistake-meta">错题 ${index + 1} · ${mistake.category} · 原题 ${mistake.id}</p>
      <p></p>
      <p></p>
      <p></p>
    `;
    item.children[1].textContent = mistake.stem;
    item.children[2].textContent = `你的答案：${mistake.selectedAnswer}`;
    item.children[3].textContent = `正确答案：${mistake.correctAnswer}`;
    els.mistakesList.append(item);
  });
}

function getQuestionById(id) {
  return state.bank.find((question) => question.id === Number(id));
}

function getLibraryEntries(mode) {
  const source = mode === "archive" ? state.archive : state.wrongBank;
  return Object.values(source)
    .map((entry) => ({ ...entry, question: getQuestionById(entry.id) }))
    .filter((entry) => entry.question)
    .sort((a, b) => {
      const left = a.lastWrongAt || a.archivedAt || a.lastSeenAt || a.addedAt || "";
      const right = b.lastWrongAt || b.archivedAt || b.lastSeenAt || b.addedAt || "";
      return right.localeCompare(left);
    });
}

function renderLibrary(mode) {
  const entries = getLibraryEntries(mode);
  const counts = getProgressCounts();

  els.libraryScreen.dataset.mode = mode;
  setScreen("library");
  els.questionCounter.textContent = mode === "archive" ? "归档" : "错题库";
  els.questionType.textContent = mode === "archive" ? "已掌握" : "待复习";
  els.categoryName.textContent = `错题 ${counts.wrong} · 归档 ${counts.archived}`;
  els.progressFill.style.width = `${((state.currentIndex + (state.answered ? 1 : 0)) / EXAM_SIZE) * 100}%`;
  els.libraryLabel.textContent = "题库菜单";
  els.libraryTitle.textContent = mode === "archive" ? "归档" : "错题库";
  els.librarySummary.textContent = mode === "archive"
    ? `连续答对 3 次的题会进入这里，共 ${entries.length} 题。`
    : `答错的题会进入这里，再连续答对 3 次后归档，共 ${entries.length} 题。`;
  els.libraryList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = mode === "archive" ? "归档里还没有题。" : "错题库里还没有题。";
    els.libraryList.append(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const item = document.createElement("article");
    item.className = "library-item";
    const progressText = mode === "archive" ? "已归档" : `连续答对 ${entry.streak || 0}/3`;
    item.innerHTML = `
      <p class="mistake-meta">${index + 1} · ${entry.question.category} · 原题 ${entry.question.id} · ${progressText}</p>
      <p></p>
      <p></p>
    `;
    item.children[1].textContent = entry.question.stem;
    item.children[2].textContent = `正确答案：${entry.question.answer}`;
    els.libraryList.append(item);
  });
}

function resumeStudy() {
  if (state.completed) {
    renderResults();
    return;
  }

  setScreen("quiz");
  renderCurrentQuestion({ resetInteraction: false });
}

function nextQuestion() {
  if (!state.answered && state.selectedAnswer !== null) {
    evaluateSelectedAnswer();
    return;
  }

  if (!state.answered) {
    return;
  }

  if (state.currentIndex >= EXAM_SIZE - 1) {
    renderResults();
    return;
  }

  state.currentIndex += 1;
  state.completed = false;
  renderCurrentQuestion();
  saveExamSession();
}

function restartExam() {
  clearExamSession();
  state.exam = createExam();
  state.currentIndex = 0;
  state.score = 0;
  state.answered = false;
  state.selectedAnswer = null;
  state.answers = [];
  state.completed = false;
  setScreen("quiz");
  renderCurrentQuestion();
  saveExamSession();
}

async function init() {
  try {
    const response = await fetch("data/questions.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`题库读取失败：${response.status}`);
    }
    const payload = await response.json();
    state.bank = (payload.questions || []).filter((question) => question.answer && question.stem);
    state.wrongBank = loadStoredMap(WRONG_BANK_KEY);
    state.archive = loadStoredMap(ARCHIVE_KEY);
    const savedSession = loadExamSession();
    if (savedSession) {
      restoreExamSession(savedSession);
      if (state.completed) {
        renderResults();
      } else {
        setScreen("quiz");
        renderCurrentQuestion({ resetInteraction: false });
      }
      return;
    }
    restartExam();
  } catch (error) {
    els.questionCounter.textContent = "题库读取失败";
    els.questionType.textContent = "请使用本地服务打开";
    els.categoryName.textContent = "无法开始";
    els.questionStem.textContent = error.message;
    els.optionsList.innerHTML = "";
    els.nextButton.disabled = true;
  }
}

els.nextButton.addEventListener("click", nextQuestion);
els.restartButton.addEventListener("click", restartExam);
els.resumeButton.addEventListener("click", resumeStudy);
els.continueButton.addEventListener("click", resumeStudy);
els.wrongBankButton.addEventListener("click", () => renderLibrary("wrong"));
els.archiveButton.addEventListener("click", () => renderLibrary("archive"));
init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // The app still works online if registration is unavailable.
    });
  });
}
