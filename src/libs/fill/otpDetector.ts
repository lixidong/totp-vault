import { setNativeInputValue } from './nativeInputValueSetter';

const OTP_RE = /otp|totp|2fa|mfa|code|token|验证码|动态码|安全码/i;

type OTPInput = {
  kind: 'single';
  input: HTMLInputElement;
} | {
  kind: 'split';
  inputs: HTMLInputElement[];
};

export function detectOTPInput(root: ParentNode = document): OTPInput | null {
  const inputs = visibleTextInputs(root);
  const single = inputs.find(isOTPLike);
  if (single) return { kind: 'single', input: single };

  const split = inputs.filter((input) => input.maxLength === 1 || input.size === 1);
  if (split.length >= 6) return { kind: 'split', inputs: split.slice(0, 6) };
  return null;
}

export function fillOTP(target: OTPInput, code: string): void {
  if (target.kind === 'single') {
    setNativeInputValue(target.input, code);
    return;
  }
  for (const [index, input] of target.inputs.entries()) {
    setNativeInputValue(input, code[index] ?? '');
  }
}

function isOTPLike(input: HTMLInputElement): boolean {
  const autocomplete = input.autocomplete.toLowerCase();
  if (autocomplete === 'one-time-code') return true;
  if (input.inputMode === 'numeric' && input.maxLength >= 6 && input.maxLength <= 8) return true;
  return OTP_RE.test(`${input.name} ${input.id} ${input.placeholder} ${input.ariaLabel ?? ''}`);
}

function visibleTextInputs(root: ParentNode): HTMLInputElement[] {
  return Array.from(root.querySelectorAll('input')).filter((input) => {
    if (input.disabled || input.readOnly || input.type === 'hidden') return false;
    if (!['', 'text', 'tel', 'number', 'search', 'password'].includes(input.type)) return false;
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}
