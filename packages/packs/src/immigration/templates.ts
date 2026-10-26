import type { DocumentTemplateSeed } from '../types';

// Starter documents for immigration consultancies. Plain starting points, not legal
// documents: every agency should have its own lawyer review its copies before use.

export const DOCUMENT_TEMPLATES: DocumentTemplateSeed[] = [
  {
    key: 'retainer_agreement',
    name: 'Retainer agreement',
    kind: 'agreement',
    signature: true,
    body: `# Retainer agreement

This agreement is between **{{agency.name}}** ({{agency.address}}), "the consultant", and **{{client.fullName}}**, "the client", dated {{today}}.

## Services
The consultant will advise the client on, and prepare, the application for **{{case.workflow}}** to {{case.country}} (file {{case.ref}}). This covers assessing eligibility, preparing the document checklist, reviewing documents, completing the application forms and submitting the application through the official channel.

## What the consultant cannot promise
Visa decisions are made only by the government of {{case.country}}. The consultant cannot guarantee an outcome or a processing time. Government fees, medical, police clearance, test and translation costs are paid by the client and are not part of the service fee unless listed below.

## Fees
- Service fee: {{fees.total}} ({{fees.package}})
- Payment schedule: as set out in the invoice issued with this agreement.
- Refunds: as set out in the consultant's refund policy, a copy of which the client has received.

## The client agrees to
- Give true, complete information and genuine documents, and tell the consultant about any change.
- Respond to requests within the agreed time, so deadlines are not missed.
- Not submit another application for the same visa through anyone else while this agreement is in force.

## Privacy
The client's information is used only to deliver these services and is shared only with the authorities, institutions, employers and service providers needed for the application.

---
[signature]`,
  },
  {
    key: 'document_request',
    name: 'Document request letter',
    kind: 'letter',
    signature: false,
    body: `# Documents we still need

Dear {{client.firstName}},

To keep your {{case.workflow}} application ({{case.ref}}) on track, please send us the following:

{{documents.missing}}

You can upload them in your client portal. If anything is unclear, reply to this message or call {{case.owner}}.

Regards,
{{case.owner}}
{{agency.name}}`,
  },
  {
    key: 'fee_schedule',
    name: 'Fee schedule',
    kind: 'letter',
    signature: true,
    body: `# Fee schedule

Client: **{{client.fullName}}**   File: {{case.ref}}   Date: {{today}}

Service: {{case.workflow}} ({{fees.package}})

Total service fee: **{{fees.total}}**

Government fees, biometrics, medical examinations, police clearance certificates, language tests and courier charges are paid separately at the rates published by the authority or provider at the time of payment.

---
[signature]`,
  },
  {
    key: 'consent_to_share',
    name: 'Consent to share information',
    kind: 'agreement',
    signature: true,
    body: `# Consent to share information

I, **{{client.fullName}}** (passport {{client.passportNumber}}), allow **{{agency.name}}** to share my personal information and documents with the government authorities, embassies, visa application centres, education institutions and prospective employers involved in my {{case.workflow}} application, only for the purpose of that application.

I can withdraw this consent in writing at any time. Withdrawing it may stop the application from going ahead.

---
[signature]`,
  },
];
