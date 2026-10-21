import Link from 'next/link';
import { company, LEGAL_UPDATED } from '@/lib/company';

export const metadata = { title: 'Terms of Service · Kicko' };

export default function Terms() {
  const c = company();
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <p>
        These terms are an agreement between {c.legalName} (“Kicko”, “we”) and the agency that creates a Kicko workspace (“you”, the “Customer”).
        By creating a workspace or using Kicko you accept them on behalf of your agency, and confirm you are authorised to do so.
      </p>

      <h2>1. The service</h2>
      <p>
        Kicko is software for visa and immigration consultancies: leads, clients, cases, documents, billing, messaging, calling and related AI tools.
        Kicko is a software provider, not an immigration adviser, lawyer or agent. You are solely responsible for the advice you give, the applications
        you prepare and your compliance with the rules of any regulator or government you work with. We do not guarantee any visa or application outcome.
      </p>
      <p>
        AI features (call notes, the WhatsApp assistant, the voice agent, eligibility explanations and document checks) assist your team. Their output
        can be wrong or incomplete; review it before relying on it or sending it to a client.
      </p>

      <h2>2. Accounts and security</h2>
      <ul>
        <li>Keep passwords confidential. We recommend two-step sign-in for everyone, and you can require it for your team.</li>
        <li>You are responsible for what people you invite do in your workspace, and for removing access when someone leaves.</li>
        <li>Tell us promptly at <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a> if you suspect unauthorised access.</li>
      </ul>

      <h2>3. Your data</h2>
      <p>
        You own the data you and your clients put into Kicko (“Customer Data”). You give us permission to host, process and transmit it only to provide,
        secure and support the service for you. Our <Link href="/dpa">Data Processing Agreement</Link> forms part of these terms and governs how we
        process personal data on your behalf.
      </p>
      <p>
        You are responsible for having a lawful basis to collect and use your clients’ personal data, including giving notices and obtaining consent
        where required (for example under India’s Digital Personal Data Protection Act, 2023), WhatsApp opt-in, and telling callers when calls are recorded.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You must not use Kicko to:</p>
      <ul>
        <li>send spam or messages that break WhatsApp, telecom or email rules, including messaging people who opted out;</li>
        <li>store or create forged, fraudulent or misleading documents, or support visa fraud;</li>
        <li>break the law, infringe others’ rights, or upload malware;</li>
        <li>probe, load-test or bypass the security of the service, or access another agency’s data;</li>
        <li>copy, resell or reverse-engineer the service except as the law allows.</li>
      </ul>
      <p>We may suspend access that puts the service, other customers or the public at risk, and will tell you why unless the law prevents it.</p>

      <h2>5. Third-party services</h2>
      <p>
        Integrations you connect (such as WhatsApp Business, telephony or payment gateways) are provided by those companies under their own terms,
        with your own accounts. We are not responsible for their availability, charges or decisions (for example template approvals or account limits).
      </p>

      <h2>6. Plans, trials and payment</h2>
      <ul>
        <li>Plans are priced per user per month, billed in advance monthly or yearly. Indian GST is added where applicable.</li>
        <li>New workspaces get a 14-day free trial with every feature. Choose a plan to continue after it.</li>
        <li>Plans with AI features include a monthly allowance of AI credits that resets each month. Purchased credits don’t expire while your workspace is active.</li>
        <li>If a payment fails, the workspace stays fully usable for 7 days, then becomes read-only (your team can view and export, not edit). After 30 days read-only it is suspended. Paying restores it immediately.</li>
        <li>We may change prices with at least 30 days’ notice; changes apply from your next billing period.</li>
        <li>Fees are non-refundable, except where the law requires otherwise or we end the service without cause, in which case we refund unused prepaid fees.</li>
      </ul>

      <h2>7. Cancellation and your data</h2>
      <p>
        You can cancel at any time; the plan runs to the end of the paid period. Owners and admins can export all data at any time from
        Settings → Security, including while read-only or suspended. Data of a suspended workspace is kept for 90 days and then deleted, along with
        backups as they expire.
      </p>

      <h2>8. Availability and support</h2>
      <p>
        We work to keep Kicko available and secure, and announce planned maintenance in advance where we can. Unless agreed in writing, the service is
        provided without a specific uptime commitment. Support is by email at <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a>.
      </p>

      <h2>9. Confidentiality</h2>
      <p>Each side keeps the other’s non-public information confidential and uses it only for this agreement.</p>

      <h2>10. Disclaimers and liability</h2>
      <p>
        Except as stated in these terms, the service is provided “as is”. To the extent the law allows, neither side is liable for indirect or
        consequential losses (such as lost profits or lost business), and each side’s total liability under these terms is limited to the fees you
        paid Kicko in the 12 months before the claim. These limits don’t apply to your payment obligations, to breaches of confidentiality, or where
        the law does not allow them.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        You will defend and compensate Kicko against claims arising from your Customer Data, your use of the service in breach of these terms, or advice
        or services you provide to your clients.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>We’ll give at least 30 days’ notice of material changes by email or in the app. Continuing to use Kicko after that means you accept them.</p>

      <h2>13. Law and disputes</h2>
      <p>These terms are governed by the laws of India. Courts at {c.city} have exclusive jurisdiction.</p>

      <h2>14. Contact</h2>
      <p>
        {c.legalName}{c.address ? `, ${c.address}` : ''}. Email <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a>.
      </p>
    </>
  );
}
