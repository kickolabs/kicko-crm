import { ENGLISH_TESTS } from '@/lib/constants';

export const TEST_COLUMNS = [
  { key: 'test', label: 'Test', options: ENGLISH_TESTS, width: '120px' },
  { key: 'overall', label: 'Overall', width: '80px' },
  { key: 'l', label: 'L', width: '60px' },
  { key: 'r', label: 'R', width: '60px' },
  { key: 'w', label: 'W', width: '60px' },
  { key: 's', label: 'S', width: '60px' },
  { key: 'date', label: 'Test date', type: 'date', width: '150px' },
];

export const EDU_COLUMNS = [
  { key: 'level', label: 'Level', options: ['10th', '12th', 'Diploma', "Bachelor's", "Master's", 'PhD'] as const, width: '130px' },
  { key: 'institution', label: 'Institution' },
  { key: 'field', label: 'Field' },
  { key: 'year', label: 'Year', width: '80px' },
  { key: 'score', label: 'Score / CGPA', width: '110px' },
];

export const WORK_COLUMNS = [
  { key: 'employer', label: 'Employer' },
  { key: 'title', label: 'Job title' },
  { key: 'from', label: 'From', type: 'month', width: '140px' },
  { key: 'to', label: 'To', type: 'month', width: '140px' },
  { key: 'code', label: 'ANZSCO / NOC', width: '120px' },
];
