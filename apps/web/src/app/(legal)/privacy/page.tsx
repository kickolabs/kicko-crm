import Link from 'next/link';
import { company, LEGAL_UPDATED } from '@/lib/company';

export const metadata = { title: 'Privacy Policy · Kicko' };

export default function Privacy() {
  const c = company();
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <p>
        This policy explains how {c.legalName} (“Kicko”) handles personal data. It covers two different situations, and it matters which one applies to you:
      </p>
      <ul>
        <li>
          <strong>Agency staff using Kicko</strong> (owners, counsellors and other team members): Kicko decides how this account data is used and is
          responsible for it (a “Data Fiduciary” under India’s Digital Personal Data Protection Act, 2023). This policy covers that data.
        </li>
        <li>
          <strong>Clients and leads of an agency</strong> (students, applicants, their families): the agency decides how your data is used. Kicko
          processes it on the agency’s behalf under our <Link href="/dpa">Data Processing Agreement</Link>. Please contact the agency for questions or
          requests about your data; we help them respond.
        </li>
      </ul>

      <h2>What we collect about agency staff</h2>
      <ul>
        <li>Account details: name, work email, phone (optional), role, password (stored only as a secure hash) and two-step sign-in settings.</li>
        <li>Billing details for the agency: legal name, address, GSTIN, and payment records from our payment provider (we never see full card numbers).</li>
        <li>Security and usage records: sign-ins, IP address, browser and device, and actions recorded in the agency’s audit log.</li>
        <li>Messages you send to our support.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide the service, keep accounts secure and prevent misuse.</li>
        <li>To bill for subscriptions and meet tax and accounting obligations.</li>
        <li>To send service messages (security alerts, billing, important changes). We don’t send marketing without consent, and you can opt out any time.</li>
        <li>To improve Kicko using aggregated usage information.</li>
      </ul>
      <p>We do not sell personal data, and we don’t use agencies’ client data to train AI models.</p>

      <h2>Cookies</h2>
      <p>We use only the cookies needed to sign you in and keep your session secure. There are no advertising or cross-site tracking cookies.</p>

      <h2>Who we share it with</h2>
      <p>
        Service providers that host and run Kicko for us (listed in the <Link href="/dpa">Data Processing Agreement</Link>), under contracts that limit their
        use of the data; professional advisers; and authorities where the law requires it. If Kicko is sold or merged, data would transfer under the same protections.
      </p>

      <h2>Where it is stored</h2>
      <p>
        We host in India (Mumbai) regions where our providers offer them. Some providers, such as AI and email services, may process data in other countries;
        we use them only under contracts with appropriate safeguards and as the law allows.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account data is kept while the account is active and for up to 90 days after an agency’s workspace is closed, then deleted or anonymised. Billing records
        are kept as long as tax law requires. Backups expire on a rolling basis.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to access, correct, update or erase your personal data, withdraw consent where we rely on it, and nominate someone to exercise your rights
        if you are unable to. Many details can be changed directly in My account. To make a request or a complaint, write to our Grievance Officer below.
        You may also approach the Data Protection Board of India.
      </p>

      <h2>Security</h2>
      <p>See <Link href="/security">how we protect data</Link>. If a breach affects your personal data, we will inform you and the authorities as the law requires.</p>

      <h2>Children</h2>
      <p>Kicko accounts are for agency staff aged 18 or over. Agencies are responsible for parental consent where their clients are children.</p>

      <h2>Grievance Officer and contact</h2>
      <p>
        {c.grievanceOfficer}, {c.legalName}{c.address ? `, ${c.address}` : ''}. Email <a href={`mailto:${c.privacyEmail}`}>{c.privacyEmail}</a>.
        We acknowledge requests promptly and respond as soon as possible.
      </p>
      <p>We’ll post changes to this policy here and tell account owners about significant ones.</p>
    </>
  );
}
