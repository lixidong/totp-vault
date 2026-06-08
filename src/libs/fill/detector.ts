export type LoginForm = {
  form: HTMLFormElement | null;
  username: HTMLInputElement | null;
  password: HTMLInputElement;
};

const USERNAME_RE = /user|login|email|account|identifier|phone|mobile|用户名|账号|账户|邮箱|手机号/i;
const PASSWORD_RE = /pass|password|pwd|密码/i;
const CURRENT_PASSWORD_AUTOCOMPLETE = new Set(['current-password', 'password']);

export function detectLoginForm(root: ParentNode = document): LoginForm | null {
  const password = findPasswordInput(root);
  if (!password) return null;

  const form = password.form;
  const scope = form ?? nearestFieldScope(password) ?? root;
  return {
    form,
    username: findUsernameInput(scope, password),
    password,
  };
}

function findPasswordInput(root: ParentNode): HTMLInputElement | null {
  const passwords = findVisibleInputs(root).filter((input) => input.type === 'password');
  if (passwords.length === 0) return null;

  return passwords.find(isCurrentPasswordInput)
    ?? passwords.find((input) => input.value !== '')
    ?? passwords[0]
    ?? null;
}

function isCurrentPasswordInput(input: HTMLInputElement): boolean {
  const autocomplete = input.autocomplete.toLowerCase();
  if (CURRENT_PASSWORD_AUTOCOMPLETE.has(autocomplete)) return true;
  return PASSWORD_RE.test(`${input.name} ${input.id} ${input.placeholder} ${input.ariaLabel ?? ''}`);
}

function findUsernameInput(root: ParentNode, password: HTMLInputElement): HTMLInputElement | null {
  const inputs = findVisibleInputs(root);
  const candidates = inputs.filter((input) => {
    if (input === password || input.type === 'password') return false;
    if (!['', 'text', 'email', 'tel', 'search'].includes(input.type)) return false;
    return isUsernameLike(input);
  });
  if (candidates.length > 0) return nearestBefore(candidates, password) ?? candidates[0] ?? null;

  const fallback = inputs.filter((input) => {
    if (input === password || input.type === 'password') return false;
    return ['', 'text', 'email', 'tel'].includes(input.type);
  });
  return nearestBefore(fallback, password) ?? fallback[0] ?? null;
}

function nearestFieldScope(input: HTMLInputElement): ParentNode | null {
  return input.closest('[role="form"], [data-form], .login, .signin, .sign-in, .auth, .password, .account');
}

function nearestBefore(inputs: HTMLInputElement[], target: HTMLInputElement): HTMLInputElement | null {
  const targetRect = target.getBoundingClientRect();
  return inputs
    .map((input) => ({ input, rect: input.getBoundingClientRect() }))
    .filter(({ rect }) => rect.top <= targetRect.top + 12)
    .sort((a, b) => {
      const rowDelta = b.rect.top - a.rect.top;
      if (Math.abs(rowDelta) > 8) return rowDelta;
      return b.rect.left - a.rect.left;
    })[0]?.input ?? null;
}

function isUsernameLike(input: HTMLInputElement): boolean {
  const autocomplete = input.autocomplete.toLowerCase();
  if (['username', 'email', 'tel'].includes(autocomplete)) return true;
  return USERNAME_RE.test(`${input.name} ${input.id} ${input.placeholder} ${input.ariaLabel ?? ''}`);
}

function findVisibleInputs(root: ParentNode): HTMLInputElement[] {
  return Array.from(root.querySelectorAll('input')).filter((input) => {
    if (input.disabled || input.readOnly || input.type === 'hidden') return false;
    const rect = input.getBoundingClientRect();
    const style = window.getComputedStyle(input);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
}
