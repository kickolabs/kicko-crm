// Questions government forms ask that the client profile doesn't cover.
// Answers are stored per client under these keys and shared by every form, so
// "city of birth" is asked once and fills IRCC, ImmiAccount and DS-160 alike.

export type QuestionType = 'text' | 'date' | 'textarea' | 'yesno';
export type Question = { label: string; type: QuestionType; hint?: string; details?: string };

export const QUESTIONS = {
  'birth.city': { label: 'City or town of birth', type: 'text' },
  'birth.country': { label: 'Country of birth', type: 'text' },
  other_names: { label: 'Other names you have used (maiden name, aliases), or "None"', type: 'text' },
  native_language: { label: 'Native language (mother tongue)', type: 'text' },
  national_id: { label: 'National identity number (e.g. Aadhaar), or "Does not apply"', type: 'text' },
  'passport.issue_date': { label: 'Passport issue date', type: 'date' },
  'passport.place': { label: 'Passport place of issue (city)', type: 'text' },
  'marriage.date': { label: 'Date of marriage (if married)', type: 'date' },
  'address.history': { label: 'Your addresses for the last 10 years (from–to, full address)', type: 'textarea' },
  'travel.history': { label: 'Countries you visited in the last 10 years (country, dates, purpose), or "None"', type: 'textarea' },
  'employment.duties': { label: 'Your main duties in your current or last job', type: 'textarea' },
  funding: { label: 'Who will pay for the trip or studies? (self, parents, sponsor name, loan)', type: 'text' },
  social_media: { label: 'Social media accounts used in the last 5 years (platform: username), or "None"', type: 'textarea' },
  'trip.purpose': { label: 'Purpose of the trip', type: 'text' },
  'trip.arrival': { label: 'Intended date of arrival', type: 'date' },
  'trip.length': { label: 'Intended length of stay', type: 'text', hint: 'e.g. 2 weeks, or the length of the course' },
  'trip.address': { label: 'Address where you will stay', type: 'textarea' },
  'trip.contact': { label: 'Contact person or organisation in the destination country (name, address, phone)', type: 'textarea' },
  'previous_visits': { label: 'Previous visits to this country (dates and length of stay), or "None"', type: 'textarea' },
  'father.name': { label: "Father's full name", type: 'text' },
  'father.dob': { label: "Father's date of birth", type: 'date' },
  'father.birthplace': { label: "Father's place of birth (city, country)", type: 'text' },
  'father.occupation': { label: "Father's occupation", type: 'text' },
  'father.address': { label: "Father's current address (or date of death)", type: 'textarea' },
  'mother.name': { label: "Mother's full name (including maiden name)", type: 'text' },
  'mother.dob': { label: "Mother's date of birth", type: 'date' },
  'mother.birthplace': { label: "Mother's place of birth (city, country)", type: 'text' },
  'mother.occupation': { label: "Mother's occupation", type: 'text' },
  'mother.address': { label: "Mother's current address (or date of death)", type: 'textarea' },
  'spouse.birthplace': { label: "Spouse's place of birth (city, country)", type: 'text' },
  'spouse.occupation': { label: "Spouse's occupation", type: 'text' },
  refused: { label: 'Have you ever been refused a visa or entry to any country, or removed from one?', type: 'yesno', details: 'Which country, when and why' },
  overstay: { label: 'Have you ever overstayed a visa or worked without permission in any country?', type: 'yesno', details: 'Where and when' },
  criminal: { label: 'Have you ever been arrested, charged with or convicted of any offence in any country?', type: 'yesno', details: 'What, where and when' },
  medical: { label: 'In the last two years, have you had tuberculosis or a serious physical or mental health condition?', type: 'yesno', details: 'Condition and treatment' },
  military: { label: 'Have you ever served in the military, police, a militia or a security organisation?', type: 'yesno', details: 'Service, rank and dates' },
} satisfies Record<string, Question>;

export type AnswerKey = keyof typeof QUESTIONS;
export const isAnswerKey = (k: string): k is AnswerKey => k in QUESTIONS;
export const detailsKey = (k: AnswerKey) => `${k}.details`;

export type Answers = Record<string, { v: string; by: 'client' | 'staff'; at: string }>;
