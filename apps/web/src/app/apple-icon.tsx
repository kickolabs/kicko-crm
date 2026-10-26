import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121417' }}>
        <div style={{ fontSize: 120, fontWeight: 800, color: '#C8FF3D', lineHeight: 1, marginTop: -6 }}>K</div>
      </div>
    ),
    size,
  );
}
