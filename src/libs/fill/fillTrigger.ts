import type { LoginForm } from './detector';

export type FillTrigger = {
  update(loginForm: LoginForm): void;
  close(): void;
};

export function showFillTrigger(loginForm: LoginForm, onClick: (loginForm: LoginForm) => void): FillTrigger {
  closeExistingTrigger();

  const host = document.createElement('div');
  host.dataset.totpVaultTrigger = 'true';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        position: fixed;
        z-index: 2147483646;
        width: 24px;
        height: 24px;
        border: 1px solid #dbeafe;
        border-radius: 999px;
        padding: 0;
        background: #eff6ff;
        color: #2563eb;
        box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
        cursor: pointer;
        font: 15px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      button:hover { background: #dbeafe; }
    </style>
    <button type="button" title="totp-vault 填充账号">◉</button>
  `;

  const button = shadow.querySelector('button') as HTMLButtonElement;
  let currentForm = loginForm;
  let closed = false;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(currentForm);
  });

  document.body.append(host);
  positionTrigger(currentForm.password, button);

  const reposition = () => {
    if (!closed) positionTrigger(currentForm.password, button);
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  function update(nextForm: LoginForm): void {
    currentForm = nextForm;
    positionTrigger(currentForm.password, button);
  }

  function close(): void {
    closed = true;
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    host.remove();
  }

  return { update, close };
}

function positionTrigger(input: HTMLInputElement, button: HTMLElement): void {
  const rect = input.getBoundingClientRect();
  const hidden = rect.width <= 0 || rect.height <= 0;
  button.style.display = hidden ? 'none' : 'block';
  if (hidden) return;
  button.style.left = `${Math.max(8, rect.right - 30)}px`;
  button.style.top = `${Math.max(8, rect.top + Math.max(0, (rect.height - 24) / 2))}px`;
}

function closeExistingTrigger(): void {
  document.querySelector('[data-totp-vault-trigger="true"]')?.remove();
}
