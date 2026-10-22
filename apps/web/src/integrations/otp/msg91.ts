import 'server-only';
import { ProviderError } from '../core/types';
import type { OtpAdapter } from './port';

// MSG91 SendOTP (India). The DLT-approved template must contain the ##OTP## variable;
// we pass our own code so verification stays in Kicko.
export function msg91(authKey: string, templateId: string): OtpAdapter {
  return {
    id: 'msg91',
    sandbox: false,
    async send(phone, code) {
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.searchParams.set('template_id', templateId);
      url.searchParams.set('mobile', phone.replace(/^\+/, ''));
      url.searchParams.set('otp', code);
      url.searchParams.set('otp_expiry', '10');
      const res = await fetch(url, { method: 'POST', headers: { authkey: authKey, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000) });
      const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
      if (!res.ok || body.type === 'error') throw new ProviderError(body.message ?? `MSG91 error ${res.status}`, 'msg91');
    },
  };
}
