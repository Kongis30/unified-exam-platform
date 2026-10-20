export const SHSAT_SKILL_TAG_CONFIG_KEY = 'shsatSkillTag';

export const SHSAT_SKILL_TAGS = [
  {
    code: 'ELA',
    name: 'English Language Arts',
    domains: [
      {
        code: 'ELA_READING_COMPREHENSION',
        name: 'Reading Comprehension',
        skills: [
          { code: 'ELA_READING_INFERENCE', name: 'Inference' },
          { code: 'ELA_READING_DETAIL', name: 'Detail' },
          { code: 'ELA_READING_FUNCTION', name: 'Function' },
          { code: 'ELA_READING_MAIN_IDEA', name: 'Main Idea' },
          { code: 'ELA_READING_INFOGRAPHIC', name: 'Infographic' },
        ],
      },
      {
        code: 'ELA_REVISING_EDITING',
        name: 'Revising & Editing',
        skills: [
          { code: 'ELA_REVISING_GRAMMAR', name: 'Grammar' },
          { code: 'ELA_REVISING_CLARITY', name: 'Clarity' },
          { code: 'ELA_REVISING_PUNCTUATION', name: 'Punctuation' },
          { code: 'ELA_REVISING_STRUCTURE', name: 'Structure' },
        ],
      },
    ],
  },
  {
    code: 'MATH',
    name: 'Mathematics',
    domains: [
      {
        code: 'MATH_ARITHMETIC',
        name: 'Arithmetic',
        skills: [
          { code: 'MATH_ARITHMETIC_NUMBER_PROPERTIES', name: 'Number Properties' },
          { code: 'MATH_ARITHMETIC_RATIOS_PROPORTIONS', name: 'Ratios and Proportions' },
          { code: 'MATH_ARITHMETIC_FRACTIONS_DECIMALS_PERCENTAGES', name: 'Fractions, Decimals, and Percentages' },
          { code: 'MATH_ARITHMETIC_ORDER_OF_OPERATIONS', name: 'Order of Operations' },
          { code: 'MATH_ARITHMETIC_PROBABILITY_PERMUTATIONS_COMBINATIONS', name: 'Probability, Permutations, and Combinations' },
        ],
      },
      {
        code: 'MATH_ALGEBRA',
        name: 'Algebra',
        skills: [
          { code: 'MATH_ALGEBRA_EXPRESSIONS', name: 'Expressions' },
          { code: 'MATH_ALGEBRA_EQUATIONS', name: 'Equations' },
          { code: 'MATH_ALGEBRA_INEQUALITIES', name: 'Inequalities' },
        ],
      },
      {
        code: 'MATH_GEOMETRY',
        name: 'Geometry',
        skills: [
          { code: 'MATH_GEOMETRY_POLYGONS_AREA_PERIMETER', name: 'Polygons, Area, and Perimeter' },
          { code: 'MATH_GEOMETRY_TRIANGLES_CIRCLES', name: 'Triangles and Circles' },
          { code: 'MATH_GEOMETRY_SURFACE_AREA_VOLUME', name: 'Surface Area and Volume' },
        ],
      },
      {
        code: 'MATH_STATISTICS',
        name: 'Statistics',
        skills: [
          { code: 'MATH_STATISTICS_INFERENTIAL', name: 'Inferential Statistics' },
          { code: 'MATH_STATISTICS_DESCRIPTIVE', name: 'Descriptive Statistics' },
        ],
      },
    ],
  },
];

export function normalizeTypeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function shsatTagSubjectOptions() {
  return SHSAT_SKILL_TAGS;
}

export function shsatTagSubjectByCode(subjectCode) {
  const normalizedCode = normalizeTypeCode(subjectCode);
  return SHSAT_SKILL_TAGS.find((subject) => subject.code === normalizedCode) || null;
}

export function shsatTagDomainByCode(domainCode) {
  const normalizedCode = normalizeTypeCode(domainCode);
  for (const subject of SHSAT_SKILL_TAGS) {
    const domain = subject.domains.find((candidate) => candidate.code === normalizedCode);
    if (domain) {
      return { subject, domain };
    }
  }
  return { subject: null, domain: null };
}

export function shsatSkillTagByCode(skillCode) {
  const normalizedCode = normalizeTypeCode(skillCode);
  for (const subject of SHSAT_SKILL_TAGS) {
    for (const domain of subject.domains) {
      const skill = domain.skills.find((candidate) => candidate.code === normalizedCode);
      if (skill) {
        return { subject, domain, skill };
      }
    }
  }
  return { subject: null, domain: null, skill: null };
}

export function normalizeShsatSkillTag(value) {
  const tag = value && typeof value === 'object'
    ? {
        subjectCode: normalizeTypeCode(value.subjectCode),
        domainCode: normalizeTypeCode(value.domainCode),
        skillCode: normalizeTypeCode(value.skillCode),
      }
    : { subjectCode: '', domainCode: '', skillCode: normalizeTypeCode(value) };
  const resolvedSkill = shsatSkillTagByCode(tag.skillCode);
  if (resolvedSkill.skill) {
    return {
      subjectCode: resolvedSkill.subject.code,
      domainCode: resolvedSkill.domain.code,
      skillCode: resolvedSkill.skill.code,
    };
  }

  const resolvedDomain = shsatTagDomainByCode(tag.domainCode);
  if (resolvedDomain.domain && resolvedDomain.subject.code === tag.subjectCode) {
    return {
      subjectCode: resolvedDomain.subject.code,
      domainCode: resolvedDomain.domain.code,
      skillCode: '',
    };
  }

  const subject = shsatTagSubjectByCode(tag.subjectCode);
  if (subject) {
    return {
      subjectCode: subject.code,
      domainCode: '',
      skillCode: '',
    };
  }

  return {
    subjectCode: '',
    domainCode: '',
    skillCode: '',
  };
}

export function shsatTagDomainsForSubjectCode(subjectCode) {
  return shsatTagSubjectByCode(subjectCode)?.domains || [];
}

export function shsatTagSkillsForDomainCode(domainCode) {
  return shsatTagDomainByCode(domainCode).domain?.skills || [];
}

export function shsatSkillTagLabel(value, { includeSubject = false } = {}) {
  const tag = normalizeShsatSkillTag(value);
  const { subject, domain, skill } = shsatSkillTagByCode(tag.skillCode);
  if (skill) {
    return includeSubject ? `${subject.name} · ${domain.name} · ${skill.name}` : `${domain.name} · ${skill.name}`;
  }
  const resolvedDomain = shsatTagDomainByCode(tag.domainCode);
  if (resolvedDomain.domain) {
    return includeSubject ? `${resolvedDomain.subject.name} · ${resolvedDomain.domain.name}` : resolvedDomain.domain.name;
  }
  const resolvedSubject = shsatTagSubjectByCode(tag.subjectCode);
  return resolvedSubject?.name || '';
}

export function extractShsatSkillTag(questionConfig) {
  return normalizeShsatSkillTag(questionConfig?.[SHSAT_SKILL_TAG_CONFIG_KEY]);
}

export function applyShsatSkillTagToConfig(questionConfig, shsatSkillTag) {
  const nextConfig = { ...(questionConfig || {}) };
  const normalizedTag = normalizeShsatSkillTag(shsatSkillTag);

  if (normalizedTag.skillCode) {
    nextConfig[SHSAT_SKILL_TAG_CONFIG_KEY] = normalizedTag;
  } else {
    delete nextConfig[SHSAT_SKILL_TAG_CONFIG_KEY];
  }

  return nextConfig;
}
