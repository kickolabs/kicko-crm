// One-time codes to a mobile number (sign-up verification). Platform-owned: Kicko's
// own SMS account, not an agency's. Kicko generates and checks the code; the
// provider only delivers it.

export interface OtpAdapter {
  id: string;
  /** No real delivery: the code is shown on screen instead (development and tests). */
  sandbox: boolean;
  send(phone: string /* E.164 */, code: string): Promise<void>;
}
