// Kicko's own legal details, from the environment (shown on legal pages and invoices).

export function company() {
  return {
    legalName: process.env.KICKO_LEGAL_NAME || 'Kicko',
    address: process.env.KICKO_ADDRESS || '',
    supportEmail: process.env.KICKO_SUPPORT_EMAIL || 'support@kicko.in',
    privacyEmail: process.env.KICKO_PRIVACY_EMAIL || 'privacy@kicko.in',
    grievanceOfficer: process.env.KICKO_GRIEVANCE_OFFICER || 'Grievance Officer',
    city: process.env.KICKO_JURISDICTION_CITY || 'Chennai',
  };
}

export const LEGAL_UPDATED = '22 October 2026';
