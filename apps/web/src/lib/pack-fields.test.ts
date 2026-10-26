import { immigrationPack } from '@kicko/packs/immigration';
import { describe, expect, it } from 'vitest';
import { carryOver, cleanPackValues, displayPackValue, PackFieldError, packRaw } from './pack-fields';

const leadFields = immigrationPack.fields.filter((f) => f.entity === 'leads');
const clientFields = immigrationPack.fields.filter((f) => f.entity === 'clients');
const allowed = { occupation: new Set(['truck_driver', 'registered_nurse']), country: new Set(['DE', 'AE', 'CA']) };

describe('pack field engine', () => {
  it('reads form values, keeping repeated keys as lists', () => {
    const fd = new FormData();
    fd.append('pf_occupation', 'truck_driver');
    fd.append('pf_alsoInterested', 'DE');
    fd.append('pf_alsoInterested', 'AE');
    fd.append('pf_alsoInterested__add', '');
    fd.append('firstName', 'Ravi');
    expect(packRaw(fd)).toEqual({ occupation: 'truck_driver', alsoInterested: ['DE', 'AE'] });
    expect(packRaw(new FormData())).toBeUndefined();
  });

  it('validates lookups against the library, so crafted values are refused', () => {
    expect(cleanPackValues(leadFields, { occupation: 'truck_driver', alsoInterested: ['DE', 'AE'], experienceYears: '6' }, allowed)).toEqual({
      occupation: 'truck_driver', alsoInterested: ['DE', 'AE'], experienceYears: 6,
    });
    expect(() => cleanPackValues(leadFields, { occupation: 'astronaut' }, allowed)).toThrow(PackFieldError);
    expect(() => cleanPackValues(leadFields, { alsoInterested: ['DE', 'XX'] }, allowed)).toThrow('pick from the list');
    expect(() => cleanPackValues(leadFields, { qualification: 'Wizard' }, allowed)).toThrow('pick one of the options');
    expect(() => cleanPackValues(leadFields, { experienceYears: 'lots' }, allowed)).toThrow('enter a number');
  });

  it('only changes fields that were sent, and clears empty ones', () => {
    const prev = { occupation: 'truck_driver', experienceYears: 4 };
    expect(cleanPackValues(leadFields, { experienceYears: '' }, allowed, prev)).toEqual({ occupation: 'truck_driver' });
  });

  it('cleans repeater rows (licences) and checks their columns', () => {
    const rows = JSON.stringify([{ kind: 'Driving licence', category: 'HMV', number: 'TN01 2020', country: 'India', expires: '2030-01-31' }, { kind: '', category: '' }]);
    expect(cleanPackValues(clientFields, { licences: rows }, allowed).licences).toEqual([{ kind: 'Driving licence', category: 'HMV', number: 'TN01 2020', country: 'India', expires: '2030-01-31' }]);
    expect(() => cleanPackValues(clientFields, { licences: JSON.stringify([{ kind: 'Spaceship' }]) }, allowed)).toThrow('pick one of the options');
    expect(() => cleanPackValues(clientFields, { licences: 'not json' }, allowed)).toThrow('could not read');
  });

  it('carries lead answers to the client on conversion', () => {
    const values = { occupation: 'truck_driver', experienceYears: 6, service: 'Job placement + visa', alsoInterested: ['DE'] };
    expect(carryOver(leadFields, clientFields, values)).toEqual(values);
  });

  it('shows values with library names', () => {
    const occ = clientFields.find((f) => f.key === 'occupation')!;
    const lic = clientFields.find((f) => f.key === 'licences')!;
    expect(displayPackValue(occ, 'truck_driver', () => 'Heavy truck driver')).toBe('Heavy truck driver');
    expect(displayPackValue(lic, [{ kind: 'Driving licence', category: 'HMV' }], (_, k) => k)).toBe('Driving licence · HMV');
    expect(displayPackValue(occ, null, (_, k) => k)).toBe('—');
  });
});
