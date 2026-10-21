import { ImageResponse } from 'next/og';

// Share preview for links to the website (WhatsApp, LinkedIn, X).
export const alt = 'Kicko: the CRM for visa and immigration consultancies';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#F4F3EE', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 19, background: '#121417', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#C8FF3D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4v16M5 12l9-8M9 9l9 11" /></svg>
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, color: '#121417' }}>Kicko</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3, color: '#121417' }}>Every enquiry, case and deadline.</div>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3, color: '#8A9098' }}>One calm console.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 28, color: '#3A3F46' }}>
          <div style={{ background: '#C8FF3D', borderRadius: 999, padding: '8px 20px', fontWeight: 700, color: '#121417' }}>CRM for visa & immigration consultancies</div>
          <div>14-day free trial</div>
        </div>
      </div>
    ),
    size,
  );
}
