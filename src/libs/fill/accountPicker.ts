import type { Account } from '@/shared/types';

export type AccountPicker = {
  close(): void;
};

export function showAccountPicker(
  anchor: HTMLElement,
  accounts: Account[],
  onSelect: (account: Account) => void,
): AccountPicker {
  closeExistingPicker();

  const host = document.createElement('div');
  host.dataset.totpVaultPicker = 'true';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .picker {
        position: fixed;
        z-index: 2147483647;
        min-width: 220px;
        max-width: 320px;
        border: 1px solid #e5e5e5;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 10px 30px rgb(0 0 0 / 18%);
        overflow: hidden;
        font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #1a1a1a;
      }
      button {
        display: block;
        width: 100%;
        border: 0;
        padding: 10px 12px;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      button:hover { background: #f1f5f9; }
      strong, span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      span { margin-top: 2px; color: #666; font-size: 12px; }
    </style>
    <div class="picker"></div>
  `;

  const picker = shadow.querySelector('.picker') as HTMLDivElement;
  for (const account of accounts.slice(0, 5)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector('strong')!.textContent = account.username || account.url;
    button.querySelector('span')!.textContent = account.url;
    button.addEventListener('click', () => {
      onSelect(account);
      close();
    });
    picker.append(button);
  }

  document.body.append(host);
  positionPicker(anchor, picker);

  const keyHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const clickHandler = (event: MouseEvent) => {
    if (event.composedPath().includes(host)) return;
    close();
  };
  window.addEventListener('resize', close);
  document.addEventListener('keydown', keyHandler);
  document.addEventListener('click', clickHandler, true);

  function close(): void {
    window.removeEventListener('resize', close);
    document.removeEventListener('keydown', keyHandler);
    document.removeEventListener('click', clickHandler, true);
    host.remove();
  }

  return { close };
}

function positionPicker(anchor: HTMLElement, picker: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
  const top = rect.bottom + 6;
  picker.style.top = `${top + 180 > window.innerHeight ? Math.max(8, rect.top - 186) : top}px`;
}

function closeExistingPicker(): void {
  document.querySelector('[data-totp-vault-picker="true"]')?.remove();
}
