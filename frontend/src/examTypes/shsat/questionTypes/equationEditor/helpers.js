import { normalizeAnswerToken, parseJson, parseJsonObject } from '../utils';

export const EQUATION_EDITOR_TYPE = 'EQUATION_EDITOR';

export const TOOL_GROUPS = [
  {
    key: 'basic',
    label: '123',
    description: 'Numbers and common operators',
    buttons: ['7', '8', '9', '+', '4', '5', '6', '-', '1', '2', '3', '*', '0', '.', '=', '/'],
  },
  {
    key: 'variables',
    label: 'x y',
    description: 'Variables and comparisons',
    buttons: ['x', 'y', '(', ')', '<', '>', '<=', '>='],
  },
  {
    key: 'templates',
    label: 'Templates',
    description: 'Fractions, powers, roots',
    buttons: [
      { label: 'Fraction', token: '\\frac{#0}{#0}' },
      { label: 'Power', token: '^{#0}' },
      { label: 'Root', token: '\\sqrt{#0}' },
      { label: 'Absolute value', token: '\\left|#0\\right|' },
    ],
  },
  {
    key: 'symbols',
    label: 'Symbols',
    description: 'Special symbols',
    buttons: ['pi', '≤', '≥', '≠', ',', '°'],
  },
  // Backward compatibility for configs saved before the tabbed palette.
  {
    key: 'advanced',
    label: 'Advanced',
    description: 'Legacy advanced tools',
    buttons: ['^', 'sqrt(', 'pi'],
    legacy: true,
  },
];

export function createDefaultEquationConfig() {
  return {
    editorMode: 'equation',
    placeholder: 'Enter an equation, expression, or number.',
    variables: ['x', 'y'],
    enabledTools: ['basic', 'variables', 'templates', 'symbols'],
    keypadStyle: 'tabbed',
    normalization: {
      ignoreWhitespace: true,
      normalizeOperators: true,
      caseInsensitive: true,
    },
  };
}

export function createDefaultEquationCorrectAnswerData() {
  return {
    acceptedAnswers: [
      { value: 'y=2x', compareMode: 'normalized_exact' },
    ],
  };
}

export function normalizeEquationConfig(rawConfig) {
  const parsedConfig = parseJsonObject(rawConfig, createDefaultEquationConfig());
  const defaults = createDefaultEquationConfig();
  const variables = normalizeVariables(parsedConfig.variables);
  const enabledTools = Array.isArray(parsedConfig.enabledTools)
    ? parsedConfig.enabledTools.filter((tool) => TOOL_GROUPS.some((group) => group.key === tool))
    : defaults.enabledTools;
  const migratedTools = enabledTools.includes('advanced')
    ? [...enabledTools.filter((tool) => tool !== 'advanced'), 'templates', 'symbols']
    : enabledTools;

  return {
    ...defaults,
    ...parsedConfig,
    editorMode: ['number', 'expression', 'equation'].includes(parsedConfig.editorMode)
      ? parsedConfig.editorMode
      : defaults.editorMode,
    variables: variables.length ? variables : defaults.variables,
    enabledTools: migratedTools.length ? [...new Set(migratedTools)] : defaults.enabledTools,
    normalization: {
      ...defaults.normalization,
      ...(parsedConfig.normalization || {}),
    },
  };
}

export function normalizeEquationAnswerData(rawData) {
  const data = parseJson(rawData, rawData);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.value !== undefined) {
      return normalizeAnswerToken(data.value);
    }
    const acceptedAnswers = data.acceptedAnswers ?? data.answers ?? data.values;
    if (acceptedAnswers !== undefined) {
      const answers = (Array.isArray(acceptedAnswers) ? acceptedAnswers : [acceptedAnswers])
        .map((item) => normalizeAnswerToken(item?.value ?? item?.text ?? item))
        .filter(Boolean);
      return answers.join(' / ');
    }
  }
  if (Array.isArray(data)) {
    return data
      .map((item) => normalizeAnswerToken(item?.value ?? item?.text ?? item))
      .filter(Boolean)
      .join(' / ');
  }
  return String(data ?? '');
}

export function normalizeAcceptedAnswers(rawData, { keepBlank = false } = {}) {
  const data = parseJson(rawData, rawData);
  const source = data?.acceptedAnswers || data?.answers || data?.values || data || [];
  const answers = (Array.isArray(source) ? source : [source])
    .map((item) => {
      if (item && typeof item === 'object') {
        return {
          value: normalizeAnswerToken(item.value ?? item.text ?? ''),
          compareMode: item.compareMode || 'normalized_exact',
        };
      }
      return {
        value: normalizeAnswerToken(item),
        compareMode: 'normalized_exact',
      };
    })
    .filter((item) => keepBlank || item.value);

  return answers.length ? answers : [];
}

export function normalizeEquationText(value = '', config = createDefaultEquationConfig()) {
  const settings = normalizeEquationConfig(config).normalization;
  let text = String(value ?? '');
  if (settings.normalizeOperators) {
    text = text
      .replace(/[×·]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/[−–—]/g, '-')
      .replace(/≤/g, '<=')
      .replace(/≥/g, '>=')
      .replace(/≠/g, '!=')
      .replace(/π/g, 'pi')
      .replace(/√\s*\(/g, 'sqrt(');
  }
  if (settings.ignoreWhitespace) {
    text = text.replace(/\s+/g, '');
  } else {
    text = text.trim();
  }
  if (settings.caseInsensitive) {
    text = text.toLowerCase();
  }
  return text;
}

export function formatEquationPreview(value = '') {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  return text
    .replace(/\\frac\s*(?:\{([^{}]+)}|([A-Za-z0-9]))\s*(?:\{([^{}]+)}|([A-Za-z0-9]))/g,
      (_, bracedNumerator, plainNumerator, bracedDenominator, plainDenominator) => (
        `(${bracedNumerator || plainNumerator}) ÷ (${bracedDenominator || plainDenominator})`
      ))
    .replace(/\\sqrt\s*\{([^{}]+)}/g, '√($1)')
    .replace(/\\left\|([^|]+)\\right\|/g, '|$1|')
    .replace(/\\leq?|≤/g, ' ≤ ')
    .replace(/\\geq?|≥/g, ' ≥ ')
    .replace(/\\neq?|≠/g, ' ≠ ')
    .replace(/\\times|\\cdot/g, ' × ')
    .replace(/\\div/g, ' ÷ ')
    .replace(/\\pi/g, 'π')
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/<=/g, ' ≤ ')
    .replace(/>=/g, ' ≥ ')
    .replace(/<>|!=/g, ' ≠ ')
    .replace(/\bpi\b/gi, 'π')
    .replace(/sqrt\s*\(/gi, 'sqrt(')
    .replace(/\s*([=+\-<>≤≥≠])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getEquationValidationIssues(question = {}) {
  const acceptedAnswers = normalizeAcceptedAnswers(question.correctAnswerData, { keepBlank: true });
  const issues = [];

  if (!acceptedAnswers.length) {
    issues.push('Add at least one accepted answer.');
  }
  if (acceptedAnswers.some((answer) => !answer.value.trim())) {
    issues.push('Accepted answers cannot be blank.');
  }

  return issues;
}

export function formatEquationAnswer(value, emptyText = 'Not answered') {
  const answer = normalizeEquationAnswerData(value);
  return answer.trim() ? answer : emptyText;
}

/**
 * 供 PDF/打印导出使用的答案格式：把 LaTeX 公式包进 $…$ 定界符，
 * 让 FormulaText 交给 MathLive 渲染成真正的数学排版，而不是输出 \frac{7}{10} 源码。
 * 多个可接受答案以 “ / ” 分隔，与 formatEquationAnswer 的既有展示约定保持一致。
 */
export function formatEquationPrintAnswer(value, emptyText = '') {
  const data = parseJson(value, value);
  const answers = normalizeAcceptedAnswers(data).map((answer) => answer.value).filter(Boolean);
  if (!answers.length) {
    const single = normalizeEquationAnswerData(value);
    if (!single.trim()) return emptyText;
    answers.push(single);
  }
  const text = answers.map(describeLatexForPrint).join(' / ');
  return text.trim() ? text : emptyText;
}

/** 把纯 LaTeX 片段转成行内公式；非公式内容原样返回，避免误伤普通文字。 */
function describeLatexForPrint(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  // 已经带定界符的内容不再重复包裹。
  if (text.startsWith('$') || text.startsWith('\\(')) return text;
  // 只有包含 LaTeX 命令或上下标时才作为公式渲染；"7/5" 这类普通写法保持原样。
  if (!/\\[A-Za-z]+|[\^_]/.test(text)) return text;
  return `$${text}$`;
}

export function normalizeVariables(variables = []) {
  const source = Array.isArray(variables) ? variables : String(variables || '').split(',');
  const seen = new Set();
  return source
    .map((item) => String(item || '').trim())
    .filter((item) => item && !seen.has(item) && seen.add(item));
}

export function enabledButtons(config = createDefaultEquationConfig()) {
  const normalizedConfig = normalizeEquationConfig(config);
  const variables = normalizedConfig.variables.length ? normalizedConfig.variables : ['x', 'y'];
  return TOOL_GROUPS
    .filter((group) => !group.legacy && normalizedConfig.enabledTools.includes(group.key))
    .map((group) => ({
      ...group,
      buttons: group.key === 'variables'
        ? [...variables, '(', ')', '<', '>', '<=', '>=']
        : group.buttons,
    }));
}
