/**
 * KDBX Repository - 内存中 KDBX 对象的 CRUD
 * 见 spec/02-kdbx.md §4
 */

import * as kdbxweb from 'kdbxweb';
import type { Account, TOTPBinding } from '@/shared/types';
import { nowISO } from '@/shared/time';
import { applyAccountToEntry, entryToAccount, getDefaultGroup } from './convert';
import { AppError } from '@/shared/errors';

const { KdbxEntry, KdbxGroup } = kdbxweb;

type Entry = InstanceType<typeof KdbxEntry>;
type Group = InstanceType<typeof KdbxGroup>;

export class KdbxRepository {
  constructor(private db: kdbxweb.Kdbx) {}

  /** 列出所有账号(转成 Account 对象) */
  listAccounts(): Account[] {
    return this.collectAllAccounts();
  }

  getAccount(id: string): Account | null {
    return this.collectAllAccounts().find((a) => a.id === id) ?? null;
  }

  /** 按 URL 匹配 */
  matchByUrl(url: string): Account[] {
    return this.listAccounts().filter((a) => {
      if (!a.url) return false;
      return url.includes(a.url) || a.url.includes(url);
    });
  }

  /** 创建账号 */
  createAccount(input: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>): Account {
    const now = nowISO();
    const id = crypto.randomUUID().replace(/-/g, '');
    const account: Account = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const group = getDefaultGroup(this.db);
    const entry = this.db.createEntry(group);
    entry.fields.set('Title', `Account ${id.slice(0, 8)}`);
    applyAccountToEntry(entry, account);
    return account;
  }

  importAccount(input: Account): Account {
    const account: Account = {
      ...input,
      id: input.id || crypto.randomUUID().replace(/-/g, ''),
      createdAt: input.createdAt || nowISO(),
      updatedAt: input.updatedAt || nowISO(),
    };
    const group = getDefaultGroup(this.db);
    const entry = this.db.createEntry(group);
    entry.fields.set('Title', `Account ${account.id.slice(0, 8)}`);
    applyAccountToEntry(entry, account);
    entry.times.creationTime = new Date(account.createdAt);
    entry.times.lastModTime = new Date(account.updatedAt);
    if (account.lastUsedAt) {
      entry.times.lastAccessTime = new Date(account.lastUsedAt);
    }
    return account;
  }

  /** 更新账号 */
  updateAccount(id: string, patch: Partial<Account>): Account {
    const entry = this.findEntryById(id);
    if (!entry) throw new AppError('ACCOUNT_NOT_FOUND', `账号 ${id} 不存在`);

    const current = entryToAccount(entry);
    const updated: Account = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowISO(),
    };
    applyAccountToEntry(entry, updated);
    return updated;
  }

  /** 删除账号 */
  deleteAccount(id: string): void {
    const entry = this.findEntryById(id);
    if (!entry) throw new AppError('ACCOUNT_NOT_FOUND', `账号 ${id} 不存在`);
    // 移出 group 并加入 deleted objects(实现软删除)
    this.db.move(entry, undefined);
  }

  bindTOTP(accountId: string, binding: TOTPBinding): void {
    this.updateAccount(accountId, { totp: binding });
  }

  unbindTOTP(accountId: string): void {
    this.updateAccount(accountId, { totp: undefined });
  }

  ensureTOTPCompatibility(): boolean {
    let changed = false;
    const visit = (group: Group) => {
      for (const entry of group.entries) {
        const account = entryToAccount(entry);
        if (!account.totp) continue;
        applyAccountToEntry(entry, account);
        changed = true;
      }
      for (const child of group.groups) {
        visit(child);
      }
    };
    visit(getDefaultGroup(this.db));
    return changed;
  }

  /** 序列化为字节流(供 webdav 上传) */
  async save(): Promise<Uint8Array> {
    const ab = await this.db.save();
    return new Uint8Array(ab);
  }

  // ---- private ----

  private collectAllAccounts(): Account[] {
    const result: Account[] = [];
    const visit = (group: Group) => {
      for (const entry of group.entries) {
        result.push(entryToAccount(entry));
      }
      for (const child of group.groups) {
        visit(child);
      }
    };
    visit(getDefaultGroup(this.db));
    return result;
  }

  private findEntryById(id: string): Entry | null {
    let found: Entry | null = null;
    const visit = (group: Group) => {
      for (const entry of group.entries) {
        const customId = entry.customData?.get('AccountID')?.value;
        const entryId = customId || entry.uuid.toString().replace(/-/g, '');
        if (entryId === id) {
          found = entry;
          return;
        }
      }
      for (const child of group.groups) {
        visit(child);
        if (found) return;
      }
    };
    visit(getDefaultGroup(this.db));
    return found;
  }
}

// ---- 单例持有 ----

let _repo: KdbxRepository | null = null;

export function setRepository(repo: KdbxRepository): void {
  _repo = repo;
}

export function getRepository(): KdbxRepository {
  if (!_repo) {
    throw new AppError('NOT_UNLOCKED', '数据库未解锁');
  }
  return _repo;
}

export function clearRepository(): void {
  _repo = null;
}

export function hasRepository(): boolean {
  return _repo !== null;
}
