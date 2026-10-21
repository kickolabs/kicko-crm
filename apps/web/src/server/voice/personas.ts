import type { QuestionKey } from './agent';

// Scripted callers for the voice agent sandbox.

export type Persona = {
  id: string;
  label: string;
  /** What they say when the call connects. */
  opener: string;
  answers: Partial<Record<QuestionKey, string>>;
  email?: string;
  books?: 'IN_PERSON' | 'VIDEO' | 'PHONE';
  human?: string;
  notInterested?: boolean;
  noAnswer?: boolean;
};

export const PERSONAS: Persona[] = [
  {
    id: 'student-canada',
    label: 'Keen student: Canada, books a consultation',
    opener: 'Yes, now is fine. I filled your form about studying abroad.',
    answers: {
      destination: 'Canada',
      visa_type: 'Study, a postgraduate diploma',
      intake: 'September 2027',
      education: 'B.Tech in Computer Science, finished in 2024',
      english_test: 'IELTS 7.0 overall',
      budget: 'About 25 lakhs, my father is sponsoring',
      work_experience: 'One year as a software tester',
      best_time: 'Evenings after 6',
    },
    email: 'student.demo@example.com',
    books: 'VIDEO',
  },
  {
    id: 'pr-australia',
    label: 'Skilled worker: Australia PR, wants a human',
    opener: 'Hi, yes. I want to know about Australia PR.',
    answers: {
      destination: 'Australia',
      visa_type: 'Permanent residency, the 189 visa',
      intake: 'As soon as possible',
      education: 'M.Sc in Computer Science, 2018',
      english_test: 'PTE 79 in each section',
      work_experience: 'Six years as a software engineer',
      best_time: 'Weekday mornings',
    },
    human: 'Wants a counsellor to explain points and fees',
  },
  {
    id: 'not-interested',
    label: 'Not interested any more',
    opener: "Sorry, I'm not interested any more. I've already joined another agency.",
    answers: {},
    notInterested: true,
  },
  { id: 'no-answer', label: 'Does not pick up (tests retries)', opener: '', answers: {}, noAnswer: true },
];

export const personaById = (id: string) => PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]!;
