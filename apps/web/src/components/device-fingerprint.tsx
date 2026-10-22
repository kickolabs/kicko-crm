'use client';

import { useEffect, useState } from 'react';

/**
 * Hidden form field with a hash of stable browser signals, used with the device
 * cookie to keep free trials to one per device. Nothing leaves the browser except
 * the hash; no third-party service.
 */
export function DeviceFingerprint() {
  const [fp, setFp] = useState('');
  useEffect(() => {
    const n = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
    const signals = [
      n.userAgent,
      n.userAgentData?.platform ?? n.platform,
      n.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      n.hardwareConcurrency,
      n.deviceMemory ?? '',
    ].join('|');
    crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(signals))
      .then((b) => setFp([...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')))
      .catch(() => {});
  }, []);
  return <input type="hidden" name="fp" value={fp} />;
}
