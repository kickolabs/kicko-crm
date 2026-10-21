import Link from 'next/link';
import { company, LEGAL_UPDATED } from '@/lib/company';

export const metadata = { title: 'Data Processing Agreement · Kicko' };

// Providers that may process agencies' data on Kicko's behalf. Keep in sync with
// what's actually deployed; give customers 30 days' notice before adding one.
const SUBPROCESSORS: [name: string, purpose: string, where: string][] = [
  ['Vercel Inc.', 'Application hosting', 'India (Mumbai) and global edge network'],
  ['Neon Inc.', 'Database', 'India (Mumbai)'],
  ['Cloudflare, Inc. (R2)', 'Document and file storage', 'Cloudflare network'],
  ['Resend, Inc.', 'Email delivery (invites, portal sign-in links, notices)', 'United States'],
  ['Anthropic PBC', 'AI features: call notes, WhatsApp assistant, document checks', 'United States'],
  ['Deepgram, Inc.', 'Call recording transcription (when calling is used)', 'United States'],
  ['Bolna / Retell AI', 'AI voice agent calls (only if the agency enables it)', 'India / United States'],
  ['Razorpay Software Pvt. Ltd.', 'Payment of Kicko subscriptions', 'India'],
];

export default function Dpa() {
  const c = company();
  return (
    <>
      <h1>Data Processing Agreement</h1>
      <p className="text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <p>
        This agreement forms part of the <Link href="/terms">Terms of Service</Link> between {c.legalName} (“Kicko”, the Data Processor) and the agency
        using Kicko (the “Customer”, the Data Fiduciary). It applies to personal data of the Customer’s leads, clients and their family members that Kicko
        processes to provide the service (“Client Data”).
      </p>

      <h2>1. Roles and instructions</h2>
      <p>
        The Customer decides why and how Client Data is processed; Kicko processes it only on the Customer’s documented instructions, which are these terms
        and the Customer’s use and configuration of the service. Kicko will tell the Customer if it believes an instruction breaks the law.
      </p>

      <h2>2. What is processed</h2>
      <ul>
        <li>Identity and contact details; passport, nationality and date of birth; education, English test and work history; family members.</li>
        <li>Visa case details, documents uploaded by the agency or the client, form answers and eligibility results.</li>
        <li>Invoices and payments; messages (WhatsApp, email, portal) and call records, recordings and transcripts.</li>
      </ul>
      <p>Processing lasts for the term of the Customer’s subscription plus the deletion period in section 8.</p>

      <h2>3. Confidentiality and staff</h2>
      <p>
        Kicko staff can access Client Data only when needed to operate or support the service, are bound by confidentiality, and their access is limited and
        logged. Changes Kicko support makes to a workspace appear in its audit log.
      </p>

      <h2>4. Security</h2>
      <p>Kicko maintains the technical and organisational measures described on our <Link href="/security">security page</Link>, and improves them over time without reducing protection.</p>

      <h2>5. Subprocessors</h2>
      <p>
        The Customer authorises Kicko to use the providers below. Kicko holds each to data protection obligations at least as protective as this agreement and
        remains responsible for them. We will give at least 30 days’ notice before adding or replacing one; the Customer may object on reasonable grounds and,
        if we can’t address the objection, cancel and receive a refund of unused prepaid fees.
      </p>
      <table>
        <thead><tr><th>Provider</th><th>Purpose</th><th>Location</th></tr></thead>
        <tbody>
          {SUBPROCESSORS.map(([n, p, w]) => <tr key={n}><td>{n}</td><td>{p}</td><td>{w}</td></tr>)}
        </tbody>
      </table>
      <p>
        Services the Customer connects with its own accounts (for example WhatsApp Business, Exotel or Twilio, Razorpay or Stripe for client payments) are the
        Customer’s own providers, not Kicko’s subprocessors. AI providers receive only the data needed for features the Customer turns on, under business terms
        that don’t allow them to train their models on it.
      </p>

      <h2>6. Helping with data principals’ requests</h2>
      <p>
        The service lets the Customer view, correct, export and delete Client Data. Where those tools aren’t enough, Kicko will help the Customer respond to
        requests from individuals exercising their rights. If an individual contacts Kicko directly, we will pass the request to the Customer.
      </p>

      <h2>7. Personal data breaches</h2>
      <p>
        Kicko will notify the Customer without undue delay, and within 72 hours, after becoming aware of a breach affecting Client Data, with what is known
        about its nature, likely impact and the measures taken, and will update the Customer as more is learned. Kicko will help the Customer meet its own
        duties to inform the Data Protection Board of India and affected individuals.
      </p>

      <h2>8. Return and deletion</h2>
      <p>
        The Customer can export all Client Data at any time. After the subscription ends, Kicko keeps the data for 90 days so the Customer can renew or export,
        then deletes it from live systems; copies in backups are deleted as those backups expire. Kicko may keep data longer only where the law requires.
      </p>

      <h2>9. Information and audits</h2>
      <p>
        On reasonable request, Kicko will provide information needed to show compliance with this agreement, such as a summary of security measures and answers
        to security questionnaires, no more than once a year unless required by a regulator or after a breach.
      </p>

      <h2>10. Location of processing</h2>
      <p>
        Client Data is hosted in India (Mumbai) regions where our providers offer them. Where a subprocessor processes data outside India, Kicko ensures this is
        permitted by law and covered by appropriate contractual safeguards.
      </p>

      <h2>11. Contact</h2>
      <p>Data protection questions: <a href={`mailto:${c.privacyEmail}`}>{c.privacyEmail}</a>.</p>
    </>
  );
}
