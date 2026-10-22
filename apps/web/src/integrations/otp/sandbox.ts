import type { OtpAdapter } from './port';

// Nothing is sent. The verify screen shows the code, so sign-up works without an SMS account.
export const sandboxOtp: OtpAdapter = {
  id: 'otp-sandbox',
  sandbox: true,
  async send() {},
};
