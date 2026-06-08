import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Account, AppSettings, TOTPAlgorithm, TOTPBinding, TOTPDigits, TOTPPeriod } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/types';
import { AppError } from '@/shared/errors';
import { sendMessage } from '@/libs/messaging/send';
import { generateTOTP, getRemainingSeconds } from '@/libs/totp/generate';
import { isValidBase32, normalizeBase32 } from '@/libs/totp/base32';
import { parseOtpauthUri } from '@/libs/totp/otpauth';

const EMPTY_FORM = {
  url: '',
  username: '',
  password: '',
  notes: '',
};

const EMPTY_TOTP_FORM = {
  secretBase32: '',
  algorithm: 'SHA1' as TOTPAlgorithm,
  digits: 6 as TOTPDigits,
  period: 30 as TOTPPeriod,
  issuer: '',
};

export function App() {
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [bindingAccountId, setBindingAccountId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [totpForm, setTotpForm] = useState(EMPTY_TOTP_FORM);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copiedTOTPAccountId, setCopiedTOTPAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unixSeconds, setUnixSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const appVersion = chrome.runtime.getManifest().version;

  useEffect(() => {
    sendMessage({ type: 'isUnlocked' })
      .then((data) => {
        setUnlocked(data.unlocked);
        if (data.unlocked) void loadAccounts();
      })
      .catch(showError)
      .finally(() => setLoading(false));

    sendMessage({ type: 'getSettings' })
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUnixSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.url.localeCompare(b.url)),
    [accounts],
  );

  const bindingAccount = accounts.find((account) => account.id === bindingAccountId) ?? null;

  async function loadAccounts() {
    const list = await sendMessage({ type: 'listAccounts' });
    setAccounts(list);
  }

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendMessage({ type: 'unlock', password });
      setUnlocked(true);
      await loadAccounts();
      setPassword('');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await sendMessage({
        type: 'createAccount',
        account: {
          url: form.url.trim(),
          username: form.username.trim(),
          password: form.password,
          notes: form.notes.trim() || undefined,
        },
      });
      setAccounts((items) => [...items, created]);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(event: FormEvent) {
    event.preventDefault();
    if (!editingAccountId) return;
    const currentAccount = accounts.find((account) => account.id === editingAccountId);
    if (!currentAccount) return;
    const patch: Partial<Account> = {
      url: editForm.url.trim(),
      username: editForm.username.trim(),
      password: editForm.password,
      notes: editForm.notes.trim() || undefined,
    };
    if (currentAccount.totp) {
      const binding = formToBinding(totpForm);
      if (!isValidBase32(binding.secretBase32)) {
        setError('无效的 Base32 Secret');
        return;
      }
      patch.totp = binding;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await sendMessage({
        type: 'updateAccount',
        id: editingAccountId,
        patch,
      });
      setAccounts((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setEditingAccountId(null);
      setEditForm(EMPTY_FORM);
      setTotpForm(EMPTY_TOTP_FORM);
      setNotice('账号已更新。');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(account: Account) {
    const ok = confirm(`确认删除 ${account.username || account.url}？`);
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await sendMessage({ type: 'deleteAccount', id: account.id });
      setAccounts((items) => items.filter((item) => item.id !== account.id));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  function openEdit(account: Account) {
    setError('');
    setNotice('');
    setEditingAccountId(account.id);
    setBindingAccountId(null);
    setEditForm({
      url: account.url,
      username: account.username,
      password: account.password,
      notes: account.notes ?? '',
    });
    setTotpForm(account.totp ? bindingToForm(account.totp) : EMPTY_TOTP_FORM);
  }

  function openBindTOTP(account: Account) {
    setError('');
    setNotice('');
    setBindingAccountId(account.id);
    setEditingAccountId(null);
    setTotpForm(account.totp ? bindingToForm(account.totp) : EMPTY_TOTP_FORM);
  }

  async function handleBindTOTP(event: FormEvent) {
    event.preventDefault();
    if (!bindingAccountId) return;
    const binding = formToBinding(totpForm);
    if (!isValidBase32(binding.secretBase32)) {
      setError('无效的 Base32 Secret');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await sendMessage({ type: 'bindTOTP', accountId: bindingAccountId, binding });
      await loadAccounts();
      setBindingAccountId(null);
      setTotpForm(EMPTY_TOTP_FORM);
      setNotice('TOTP 已绑定。');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnbindTOTP(account: Account) {
    const ok = confirm(`确认解除 ${account.username || account.url} 的 TOTP 绑定？`);
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await sendMessage({ type: 'unbindTOTP', accountId: account.id });
      await loadAccounts();
      setNotice('TOTP 已解除绑定。');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword(account: Account) {
    try {
      await navigator.clipboard.writeText(account.password);
      setNotice('密码已复制。');
    } catch (e) {
      showError(e);
    }
  }

  async function copyTOTP(account: Account) {
    if (!account.totp) return;
    try {
      const code = generateTOTP(account.totp, unixSeconds);
      await navigator.clipboard.writeText(code);
      setCopiedTOTPAccountId(account.id);
      window.setTimeout(() => {
        setCopiedTOTPAccountId((current) => (current === account.id ? null : current));
      }, 1800);
    } catch (e) {
      showError(e);
    }
  }

  async function handleLock() {
    await sendMessage({ type: 'lock' });
    setUnlocked(false);
    setAccounts([]);
  }

  function handleTOTPSecretInput(value: string) {
    const parsed = parseOtpauthUri(value.trim());
    if (parsed) {
      setTotpForm(bindingToForm(parsed.binding));
      setNotice('已解析 otpauth URI。');
      return;
    }
    setTotpForm({ ...totpForm, secretBase32: value });
  }

  function toggleAccount(accountId: string) {
    setExpandedAccountId((current) => (current === accountId ? null : accountId));
  }

  function openOptions() {
    if (chrome.runtime.openOptionsPage) {
      void chrome.runtime.openOptionsPage();
    }
  }

  function showError(errorValue: unknown) {
    if (errorValue instanceof AppError || errorValue instanceof Error) {
      setError(errorValue.message);
    } else {
      setError('操作失败');
    }
  }

  if (loading) {
    return <div className="app center">加载中...</div>;
  }

  if (!unlocked) {
    return (
      <div className="app unlock-screen">
        <h1>totp-vault</h1>
        <p className="muted">输入主密码解锁密码库。</p>
        {settings.masterPasswordHint ? (
          <p className="password-hint">主密码提示：{settings.masterPasswordHint}</p>
        ) : null}
        <form className="stack" onSubmit={handleUnlock}>
          <input
            type="password"
            value={password}
            placeholder="主密码"
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            required
          />
          <button type="submit" disabled={busy || !password}>
            {busy ? '解锁中...' : '解锁'}
          </button>
        </form>
        <button className="link-button" type="button" onClick={openOptions}>
          配置 WebDAV
        </button>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>密码库</h1>
          <p className="muted">{accounts.length} 个账号</p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => {
            setShowForm(true);
            setEditingAccountId(null);
          }} disabled={busy}>
            +
          </button>
          <button type="button" onClick={openOptions}>
            设置
          </button>
          <button type="button" onClick={handleLock}>
            锁定
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      {showForm ? (
        <form className="card stack" onSubmit={handleCreate}>
          <h2>添加账号</h2>
          <input
            type="url"
            value={form.url}
            placeholder="网址，例如 https://github.com"
            onChange={(event) => setForm({ ...form, url: event.target.value })}
            required
          />
          <input
            value={form.username}
            placeholder="用户名"
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            required
          />
          <input
            type="password"
            value={form.password}
            placeholder="密码"
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required
          />
          <textarea
            value={form.notes}
            placeholder="备注（可选）"
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
          <div className="actions right">
            <button type="button" onClick={() => setShowForm(false)}>
              取消
            </button>
            <button type="submit" disabled={busy}>
              保存
            </button>
          </div>
        </form>
      ) : null}

      {bindingAccount ? (
        <form className="card stack" onSubmit={handleBindTOTP}>
          <h2>绑定 TOTP</h2>
          <p className="muted">{bindingAccount.username || bindingAccount.url}</p>
          <input
            value={totpForm.secretBase32}
            placeholder="Base32 Secret 或 otpauth:// URI"
            onChange={(event) => handleTOTPSecretInput(event.target.value)}
            required
          />
          <div className="grid two">
            <label>
              算法
              <select
                value={totpForm.algorithm}
                onChange={(event) =>
                  setTotpForm({ ...totpForm, algorithm: event.target.value as TOTPAlgorithm })
                }
              >
                <option value="SHA1">SHA1</option>
                <option value="SHA256">SHA256</option>
                <option value="SHA512">SHA512</option>
              </select>
            </label>
            <label>
              位数
              <select
                value={totpForm.digits}
                onChange={(event) =>
                  setTotpForm({ ...totpForm, digits: Number(event.target.value) as TOTPDigits })
                }
              >
                <option value={6}>6</option>
                <option value={8}>8</option>
              </select>
            </label>
            <label>
              周期
              <select
                value={totpForm.period}
                onChange={(event) =>
                  setTotpForm({ ...totpForm, period: Number(event.target.value) as TOTPPeriod })
                }
              >
                <option value={30}>30 秒</option>
                <option value={60}>60 秒</option>
              </select>
            </label>
            <label>
              Issuer
              <input
                value={totpForm.issuer}
                placeholder="可选"
                onChange={(event) => setTotpForm({ ...totpForm, issuer: event.target.value })}
              />
            </label>
          </div>
          {previewTOTP(formToBinding(totpForm), unixSeconds)}
          <div className="actions right">
            <button type="button" onClick={() => setBindingAccountId(null)}>
              取消
            </button>
            <button type="submit" disabled={busy}>
              保存 TOTP
            </button>
          </div>
        </form>
      ) : null}

      <section className="account-list">
        {sortedAccounts.length === 0 ? <p className="empty">还没有账号。</p> : null}
        {sortedAccounts.map((account) => {
          const expanded = expandedAccountId === account.id;
          const editing = editingAccountId === account.id;
          if (editing) {
            return (
              <article className="account-item expanded editing" key={account.id}>
                <form className="account-edit-form stack" onSubmit={handleUpdate}>
                  <div className="account-heading">
                    <div className="account-avatar">{getAccountInitial(account)}</div>
                    <div className="account-title">
                      <strong>编辑账号</strong>
                      <p className="muted">{formatAccountTitle(account.url)}</p>
                    </div>
                  </div>
                  <input
                    type="url"
                    value={editForm.url}
                    placeholder="网址，例如 https://github.com"
                    onChange={(event) => setEditForm({ ...editForm, url: event.target.value })}
                    required
                  />
                  <input
                    value={editForm.username}
                    placeholder="用户名"
                    onChange={(event) => setEditForm({ ...editForm, username: event.target.value })}
                    required
                  />
                  <input
                    type="text"
                    value={editForm.password}
                    placeholder="密码"
                    onChange={(event) => setEditForm({ ...editForm, password: event.target.value })}
                    required
                  />
                  <textarea
                    value={editForm.notes}
                    placeholder="备注（可选）"
                    onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                  />
                  {account.totp ? (
                    <div className="totp-edit-section">
                      <h2>TOTP</h2>
                      <input
                        value={totpForm.secretBase32}
                        placeholder="Base32 Secret 或 otpauth:// URI"
                        onChange={(event) => handleTOTPSecretInput(event.target.value)}
                        required
                      />
                      <div className="grid two">
                        <label>
                          算法
                          <select
                            value={totpForm.algorithm}
                            onChange={(event) =>
                              setTotpForm({ ...totpForm, algorithm: event.target.value as TOTPAlgorithm })
                            }
                          >
                            <option value="SHA1">SHA1</option>
                            <option value="SHA256">SHA256</option>
                            <option value="SHA512">SHA512</option>
                          </select>
                        </label>
                        <label>
                          位数
                          <select
                            value={totpForm.digits}
                            onChange={(event) =>
                              setTotpForm({ ...totpForm, digits: Number(event.target.value) as TOTPDigits })
                            }
                          >
                            <option value={6}>6</option>
                            <option value={8}>8</option>
                          </select>
                        </label>
                        <label>
                          周期
                          <select
                            value={totpForm.period}
                            onChange={(event) =>
                              setTotpForm({ ...totpForm, period: Number(event.target.value) as TOTPPeriod })
                            }
                          >
                            <option value={30}>30 秒</option>
                            <option value={60}>60 秒</option>
                          </select>
                        </label>
                        <label>
                          Issuer
                          <input
                            value={totpForm.issuer}
                            placeholder="可选"
                            onChange={(event) => setTotpForm({ ...totpForm, issuer: event.target.value })}
                          />
                        </label>
                      </div>
                      {previewTOTP(formToBinding(totpForm), unixSeconds)}
                    </div>
                  ) : null}
                  <div className="actions right">
                    <button type="button" onClick={() => setEditingAccountId(null)}>
                      取消
                    </button>
                    <button type="submit" disabled={busy}>
                      保存修改
                    </button>
                  </div>
                </form>
              </article>
            );
          }
          return (
            <article className={expanded ? 'account-item expanded' : 'account-item'} key={account.id} onClick={() => toggleAccount(account.id)}>
              <div className="account-main">
                <div className="account-heading">
                  <div className="account-avatar">{getAccountInitial(account)}</div>
                  <div className="account-title">
                    <strong>{formatAccountTitle(account.url)}</strong>
                    <p className="muted">{account.username}</p>
                  </div>
                </div>
                {account.totp ? (
                  <TOTPCode
                    binding={account.totp}
                    unixSeconds={unixSeconds}
                    copied={copiedTOTPAccountId === account.id}
                    onCopy={() => void copyTOTP(account)}
                  />
                ) : null}
                {expanded ? (
                  <div className="account-details">
                    <div className="detail-row">
                      <span>网址</span>
                      <code>{account.url}</code>
                    </div>
                    <div className="detail-row">
                      <span>密码</span>
                      <code>{account.password}</code>
                    </div>
                    {account.notes ? (
                      <div className="detail-row">
                        <span>备注</span>
                        <p>{account.notes}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="account-actions" onClick={(event) => event.stopPropagation()}>
                <button className="icon-button" type="button" onClick={() => toggleAccount(account.id)} disabled={busy}>
                  {expanded ? '收起' : '查看'}
                </button>
                <button className="icon-button" type="button" onClick={() => openEdit(account)} disabled={busy}>
                  编辑
                </button>
                <button className="icon-button" type="button" onClick={() => void copyPassword(account)} disabled={busy}>
                  复制密码
                </button>
                {account.totp ? (
                  <>
                    <button className="icon-button danger" type="button" onClick={() => void handleUnbindTOTP(account)} disabled={busy}>
                      解绑
                    </button>
                  </>
                ) : (
                  <button className="icon-button" type="button" onClick={() => openBindTOTP(account)} disabled={busy}>
                    绑定 TOTP
                  </button>
                )}
                <button className="icon-button danger" type="button" onClick={() => void handleDelete(account)} disabled={busy}>
                  删除
                </button>
              </div>
            </article>
          );
        })}
      </section>
      <footer className="release-footer">totp-vault v{appVersion} · 数据保存在你的 WebDAV KDBX</footer>
    </div>
  );
}

function TOTPCode({
  binding,
  unixSeconds,
  copied = false,
  onCopy,
}: {
  binding: TOTPBinding;
  unixSeconds: number;
  copied?: boolean;
  onCopy?: () => void;
}) {
  const code = generateTOTP(binding, unixSeconds);
  const remainingSeconds = getRemainingSeconds(binding, unixSeconds);
  return (
    <button
      className={remainingSeconds <= 5 ? 'totp-code expiring' : 'totp-code'}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onCopy?.();
      }}
    >
      <span>{copied ? '已复制' : formatCode(code)}</span>
      <small>{copied ? '验证码' : `剩 ${remainingSeconds}s`}</small>
    </button>
  );
}

function previewTOTP(binding: TOTPBinding, unixSeconds: number) {
  if (!isValidBase32(binding.secretBase32)) {
    return <p className="muted">输入有效 Secret 后显示当前验证码。</p>;
  }
  return <TOTPCode binding={binding} unixSeconds={unixSeconds} />;
}

function bindingToForm(binding: TOTPBinding) {
  return {
    secretBase32: binding.secretBase32,
    algorithm: binding.algorithm,
    digits: binding.digits,
    period: binding.period,
    issuer: binding.issuer ?? '',
  };
}

function formToBinding(form: typeof EMPTY_TOTP_FORM): TOTPBinding {
  return {
    secretBase32: normalizeBase32(form.secretBase32),
    algorithm: form.algorithm,
    digits: form.digits,
    period: form.period,
    issuer: form.issuer.trim() || undefined,
  };
}

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function formatAccountTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getAccountInitial(account: Account): string {
  const source = account.username || formatAccountTitle(account.url);
  return source.slice(0, 1).toUpperCase();
}
