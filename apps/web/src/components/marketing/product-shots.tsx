import { Check, FileWarning, Phone, Sparkles } from 'lucide-react';

// Small, static renderings of real Kicko screens for the website. Built from the
// same tokens as the app (no screenshots), so they stay sharp and on-brand.

export function JourneyShot() {
  const stages = ['Enquiry', 'Offer', 'GIC', 'Biometrics', 'Lodged', 'Decision'];
  const at = 3;
  return (
    <div className="rounded-[22px] bg-ink p-5 text-paper shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-paper/60">KCK-CA-1042 · Study permit</span>
        <span className="rounded-full bg-lime px-2 py-0.5 font-bold text-ink">On track</span>
      </div>
      <div className="mt-3 text-xl font-extrabold tracking-tight">Priya Sharma → Canada</div>
      <div className="text-xs text-paper/60">Sept intake · University of Waterloo</div>
      <ol className="mt-5 grid grid-cols-6" aria-label="Case stages">
        {stages.map((s, i) => (
          <li key={s} className="relative flex flex-col items-center gap-2">
            {/* connectors to the previous and next step, meeting at this node */}
            {i > 0 && <span className={`absolute top-2.5 right-1/2 left-0 h-0.5 ${i <= at ? 'bg-paper' : 'bg-paper/15'}`} />}
            {i < stages.length - 1 && <span className={`absolute top-2.5 right-0 left-1/2 h-0.5 ${i < at ? 'bg-paper' : 'bg-paper/15'}`} />}
            <span className={`relative grid size-5 place-items-center rounded-full ${i < at ? 'bg-paper text-ink' : i === at ? 'bg-lime text-ink ring-4 ring-lime/25' : 'bg-[#2b2f35]'}`}>
              {i < at && <Check size={11} strokeWidth={3} />}
            </span>
            <span className={`text-[10px] whitespace-nowrap ${i === at ? 'font-bold text-lime' : 'text-paper/50'}`}>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 grid grid-cols-3 gap-2 text-xs">
        {[['Documents', '11 / 12'], ['Paid', '₹48,000'], ['Biometrics', 'Thu 10:30']].map(([k, v]) => (
          <div key={k} className="rounded-[12px] bg-paper/8 px-3 py-2">
            <div className="text-paper/50">{k}</div>
            <div className="font-bold">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatShot() {
  return (
    <div className="card flex flex-col gap-2.5 p-4 text-[13px]">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        <span className="rounded bg-ok-bg px-1.5 py-0.5 text-[10px] font-bold text-ok">WA</span> Arjun Mehta · new lead
      </div>
      <p className="max-w-[85%] self-start rounded-[16px] rounded-bl-[6px] bg-paper-2 px-3.5 py-2">Hi, what IELTS score do I need for Australia PR?</p>
      <div className="flex max-w-[88%] flex-col items-end gap-1 self-end">
        <span className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-muted uppercase"><Sparkles size={11} /> AI reply</span>
        <p className="rounded-[16px] rounded-br-[6px] bg-[#1f3b2d] px-3.5 py-2 text-paper">
          For skilled visas most applicants need IELTS 7 in each band for full points. Want me to book a free eligibility call? Tomorrow 11:00 or 4:30 is open.
        </p>
      </div>
      <p className="max-w-[60%] self-start rounded-[16px] rounded-bl-[6px] bg-paper-2 px-3.5 py-2">4:30 works 👍</p>
      <div className="flex items-center gap-1.5 rounded-[10px] bg-lime-soft px-3 py-2 text-xs font-semibold text-olive">
        <Check size={13} /> Consultation booked with Divya · Thu 16:30
      </div>
    </div>
  );
}

export function CallShot() {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-3 rounded-full bg-ink py-2 pr-4 pl-2 text-paper shadow-[var(--shadow-pop)]">
      <span className="grid size-9 place-items-center rounded-full bg-lime text-ink"><Phone size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold">Ravi Kumar · 04:12</div>
        <div className="truncate text-[11px] text-paper/60">“…my wife will come as a dependant…”</div>
      </div>
      <span className="wave flex items-center gap-[3px]" aria-hidden="true"><span /><span /><span /><span /><span /></span>
    </div>
  );
}

export function DocCheckShot() {
  return (
    <div className="card flex flex-col gap-3 p-4 text-[13px]">
      <div className="flex items-center justify-between">
        <span className="font-bold">Passport · Ravi Kumar</span>
        <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-bold text-warn-ink">Needs a look</span>
      </div>
      <ul className="flex flex-col gap-1.5 text-xs">
        <li className="flex items-center gap-2"><Check size={13} className="text-ok" /> Name matches profile</li>
        <li className="flex items-center gap-2"><Check size={13} className="text-ok" /> Readable, all pages present</li>
        <li className="flex items-center gap-2 font-semibold text-warn-ink"><FileWarning size={13} /> Expires 14 Feb 2027, within 6 months of travel</li>
      </ul>
    </div>
  );
}

export function InvoiceShot() {
  return (
    <div className="card flex flex-col gap-2 p-4 text-[13px]">
      <div className="flex items-center justify-between"><span className="font-bold">INV-2026-0183</span><span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-bold text-ok">Paid by UPI</span></div>
      <div className="flex justify-between text-xs text-muted"><span>Canada study package</span><span>₹40,678</span></div>
      <div className="flex justify-between text-xs text-muted"><span>CGST 9% + SGST 9%</span><span>₹7,322</span></div>
      <div className="flex justify-between border-t border-line pt-2 font-bold"><span>Total</span><span>₹48,000</span></div>
    </div>
  );
}
