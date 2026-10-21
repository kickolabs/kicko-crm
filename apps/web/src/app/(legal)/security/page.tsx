import Link from 'next/link';
import { company, LEGAL_UPDATED } from '@/lib/company';

export const metadata = { title: 'Security · Kicko' };

const SECTIONS: [title: string, points: string[]][] = [
  ['Every agency sealed off', [
    'Each agency’s records are separated inside the database itself (row-level security), not just by the app. A query for one agency cannot return another’s rows, and this is tested automatically on every change.',
    'Kicko’s own admin tools can read across agencies only in read-only mode, only after an admin check with two-step sign-in, and every change they make is logged.',
  ]],
  ['Sign-in', [
    'Two-step sign-in with an authenticator app, with backup codes. Agency owners can require it for their whole team.',
    'Passwords are stored only as secure hashes. Repeated sign-in attempts are rate-limited, and repeated wrong two-step codes lock sign-in for a while.',
    'People can see where they are signed in and sign out other devices; changing a password signs out everywhere else.',
  ]],
  ['Encryption', [
    'All traffic uses HTTPS (TLS). Data is encrypted at rest by our database and storage providers.',
    'Keys for agencies’ integrations (WhatsApp, telephony, payment gateways) and two-step sign-in secrets are additionally encrypted field by field.',
    'Documents are never public: each view or download uses a short-lived signed link, and every opening is recorded.',
  ]],
  ['Audit log', [
    'Owners and admins see sign-ins and failed sign-ins, team and role changes, settings and integration changes, imports, exports, and who opened which client document.',
    'Audit entries can’t be edited or deleted, by agency staff or by the application.',
  ]],
  ['Backups and your data', [
    'Point-in-time database recovery plus nightly backups kept in a separate location; document storage is versioned. Restores follow a written procedure.',
    'Owners can export everything their agency has, at any time, including after a subscription lapses.',
  ]],
  ['AI', [
    'AI features run only when the agency turns them on and receive only what they need. We use providers’ business terms that don’t allow training on customer data, and opt out of model-improvement programmes where a provider offers one.',
    'AI output is marked as such and is a draft for staff to check, never a final decision.',
  ]],
  ['People and process', [
    'Access to production systems is limited to the people who need it, with two-step sign-in.',
  ]],
];

export default function Security() {
  const c = company();
  return (
    <>
      <h1>Security</h1>
      <p className="text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <p>Agencies trust Kicko with passports, finances and family details. This is how we protect them.</p>
      {SECTIONS.map(([t, points]) => (
        <section key={t}>
          <h2>{t}</h2>
          <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      ))}
      <h2>Reporting a vulnerability</h2>
      <p>
        Found a security problem? Email <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a> with details. Please don’t access other agencies’ data or disrupt
        the service while testing. We’ll respond quickly and keep you updated. See also our <Link href="/privacy">Privacy Policy</Link> and <Link href="/dpa">DPA</Link>.
      </p>
    </>
  );
}
