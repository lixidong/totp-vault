import type { Account } from '@/shared/types';
import type { LoginForm } from './detector';
import { setNativeInputValue } from './nativeInputValueSetter';

export function silentFill(loginForm: LoginForm, account: Account): void {
  if (loginForm.username) {
    setNativeInputValue(loginForm.username, account.username);
  }
  setNativeInputValue(loginForm.password, account.password);
}
