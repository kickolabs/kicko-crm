import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/** The app icon: the Kicko mark, lime on ink. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121417', borderRadius: 112 }}>
        <div style={{ fontSize: 330, fontWeight: 800, color: '#C8FF3D', lineHeight: 1, marginTop: -20 }}>K</div>
      </div>
    ),
    size,
  );
}
