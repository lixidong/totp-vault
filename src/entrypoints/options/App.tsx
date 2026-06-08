import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Account, AppSettings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/types';
import { AppError } from '@/shared/errors';
import { WEBDAV_DEFAULT_REMOTE_PATH } from '@/shared/constants';
import { sendMessage } from '@/libs/messaging/send';
import type { ImportMode } from '@/libs/messaging/protocol';
import { buildExport, parseImportAccounts, type ExportFormat } from '@/libs/import-export/jsonFormats';

const EMPTY_FORM = {
  url: '',
  username: '',
  appPassword: '',
  masterPassword: '',
  remotePath: WEBDAV_DEFAULT_REMOTE_PATH,
};

export function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [configured, setConfigured] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importAccounts, setImportAccounts] = useState<Account[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('totp-vault');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const appVersion = chrome.runtime.getManifest().version;

  useEffect(() => {
    sendMessage({ type: 'getWebDAVConfig' })
      .then((data) => {
        setConfigured(data.configured);
        setLastSyncAt(data.syncMeta?.lastSyncAt ?? null);
        if (data.config) {
          setForm({ ...data.config, appPassword: '', masterPassword: '' });
        }
      })
      .catch(showError);

    sendMessage({ type: 'getSettings' })
      .then(setSettings)
      .catch(showError);
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await sendMessage({
        type: 'setWebDAVConfig',
        masterPassword: form.masterPassword,
        config: {
          url: form.url.trim(),
          username: form.username.trim(),
          appPassword: form.appPassword,
          remotePath: form.remotePath.trim() || WEBDAV_DEFAULT_REMOTE_PATH,
        },
      });
      setConfigured(true);
      setMessage('WebDAV 配置已保存。');
      setForm((current) => ({ ...current, appPassword: '', masterPassword: '' }));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    const ok = confirm('确认重置 WebDAV 配置？本地已解锁数据不会被清空。');
    if (!ok) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await sendMessage({ type: 'resetWebDAVConfig' });
      setConfigured(false);
      setLastSyncAt(null);
      setForm(EMPTY_FORM);
      setMessage('WebDAV 配置已重置。');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const nextSettings = {
        autoLockMinutes: Math.max(0, Math.floor(settings.autoLockMinutes)),
        masterPasswordHint: settings.masterPasswordHint.trim(),
      };
      await sendMessage({ type: 'setSettings', settings: nextSettings });
      setSettings((current) => ({ ...current, ...nextSettings }));
      setMessage('安全设置已保存。');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await sendMessage({ type: 'exportAccounts' });
      const exported = buildExport(data.accounts, exportFormat, data.exportedAt);
      const blob = new Blob([JSON.stringify(exported.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exported.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(`已导出 ${data.accounts.length} 个账号。`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setMessage('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const accounts = parseImportAccounts(parsed);
      setImportAccounts(accounts);
      setImportFileName(file.name);
      setMessage(`已读取 ${accounts.length} 个账号，选择导入方式后点击导入。`);
    } catch (e) {
      setImportAccounts([]);
      setImportFileName('');
      showError(e);
    } finally {
      event.target.value = '';
    }
  }

  async function handleImport() {
    if (importAccounts.length === 0) return;
    if (importMode === 'replace') {
      const ok = confirm('确认用导入文件替换当前所有账号？此操作会上传新的 KDBX。');
      if (!ok) return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await sendMessage({
        type: 'importAccounts',
        accounts: importAccounts,
        mode: importMode,
      });
      setImportAccounts([]);
      setImportFileName('');
      setMessage(`已导入 ${result.imported} 个账号，当前共有 ${result.total} 个账号。`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  function showError(errorValue: unknown) {
    if (errorValue instanceof AppError || errorValue instanceof Error) {
      setError(errorValue.message);
    } else {
      setError('操作失败');
    }
  }

  return (
    <div className="app">
      <header className="page-header">
        <div>
          <h1>totp-vault 设置</h1>
          <p className="muted">配置用于同步 KDBX 的 WebDAV 服务。</p>
        </div>
        <span className={configured ? 'badge success' : 'badge'}>
          {configured ? '已配置' : '未配置'}
        </span>
      </header>

      <main className="stack">
        <section className="panel">
          <form className="stack" onSubmit={handleSave}>
            <h2>WebDAV 同步</h2>
            <label>
              服务 URL
              <input
                type="url"
                value={form.url}
                placeholder="https://dav.example.com/"
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                required
              />
            </label>

            <label>
              用户名
              <input
                value={form.username}
                placeholder="alice@example.com"
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                required
              />
            </label>

            <label>
              WebDAV 应用密码
              <input
                type="password"
                value={form.appPassword}
                placeholder="云盘应用专用密码"
                onChange={(event) => setForm({ ...form, appPassword: event.target.value })}
                required
              />
            </label>

            <label>
              主密码
              <input
                type="password"
                value={form.masterPassword}
                placeholder="用于加密保存 WebDAV 凭据，并用于解锁 KDBX"
                onChange={(event) => setForm({ ...form, masterPassword: event.target.value })}
                required
              />
            </label>

            <label>
              KDBX 远程路径
              <input
                value={form.remotePath}
                onChange={(event) => setForm({ ...form, remotePath: event.target.value })}
                required
              />
            </label>

            {lastSyncAt ? <p className="muted">上次同步：{lastSyncAt}</p> : null}

            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? '保存中...' : '保存配置'}
              </button>
              <button type="button" onClick={handleReset} disabled={busy || !configured}>
                重置配置
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <form className="stack" onSubmit={handleSaveSettings}>
            <h2>安全设置</h2>
            <label>
              自动锁定时间（分钟）
              <input
                type="number"
                min={0}
                value={settings.autoLockMinutes}
                onChange={(event) => setSettings({ ...settings, autoLockMinutes: Number(event.target.value) })}
                required
              />
            </label>
            <p className="muted">设为 0 表示不自动锁定；修改后会立即影响当前已解锁的密码库。</p>
            <label>
              主密码提示
              <input
                value={settings.masterPasswordHint}
                maxLength={120}
                placeholder="例如：某本书第 3 页的提示词"
                onChange={(event) => setSettings({ ...settings, masterPasswordHint: event.target.value })}
              />
            </label>
            <p className="muted">提示会明文保存在本机，请不要写入主密码本身或可直接还原密码的内容。</p>
            <div className="actions">
              <button type="submit" disabled={busy}>保存安全设置</button>
            </div>
          </form>
        </section>

        <section className="panel stack">
          <div>
            <h2>发布信息</h2>
            <p className="muted">当前版本：{appVersion}</p>
          </div>
          <ul className="release-list">
            <li>扩展权限用于本地存储、当前页面填充、内容脚本注入和自动锁定计时。</li>
            <li>密码库只在解锁后保留在后台内存中；自动锁定会清空内存中的 KDBX。</li>
            <li>正式发布前建议先导出一份 totp-vault JSON 备份。</li>
          </ul>
        </section>

        <section className="panel stack">
          <div>
            <h2>数据备份</h2>
            <p className="muted">导入支持 totp-vault、Bitwarden、1Password 常见 JSON；导入和导出需要先解锁密码库。</p>
          </div>

          <label>
            导出格式
            <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
              <option value="totp-vault">totp-vault JSON</option>
              <option value="bitwarden">Bitwarden JSON</option>
              <option value="1password">1Password JSON</option>
            </select>
          </label>

          <div className="actions">
            <button type="button" onClick={() => void handleExport()} disabled={busy}>
              导出 JSON
            </button>
            <label className="file-button">
              选择 JSON
              <input type="file" accept="application/json,.json" onChange={(event) => void handleImportFile(event)} />
            </label>
          </div>

          {importFileName ? (
            <div className="import-box stack">
              <p>已选择：{importFileName}</p>
              <p className="muted">包含 {importAccounts.length} 个账号。</p>
              <label>
                导入方式
                <select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}>
                  <option value="merge">合并：按网址和用户名去重</option>
                  <option value="replace">替换：清空当前账号后导入</option>
                </select>
              </label>
              <div className="actions">
                <button type="button" onClick={() => void handleImport()} disabled={busy || importAccounts.length === 0}>
                  导入
                </button>
                <button type="button" onClick={() => {
                  setImportAccounts([]);
                  setImportFileName('');
                }} disabled={busy}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
    </div>
  );
}

