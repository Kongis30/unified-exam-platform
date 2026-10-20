export const DEFAULT_INITIAL_PASSWORD = '9297019872';

// 根据 Full Name 生成账户预览；后端会再次生成并处理重名，保证接口调用也遵循同一规则。
export function usernameFromFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '';
  }

  const normalize = (value) => value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

  const firstName = normalize(parts[0]);
  const lastName = normalize(parts[parts.length - 1]);
  if (!firstName) {
    return '';
  }

  return `${firstName}${lastName.charAt(0)}@jin`;
}
