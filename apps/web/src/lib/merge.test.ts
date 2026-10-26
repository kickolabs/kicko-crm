import { describe, expect, it } from 'vitest';
import { blocksOf, fieldsOf, renderTemplate, runsOf } from './merge';

const template = `# Retainer agreement

This agreement is between **{{agency.name}}** and {{client.fullName}}
for {{case.workflow}} ({{case.ref}}).

## Fees
- Total: {{fees.total}}
- Documents still needed: {{documents.missing}}

---
[signature]`;

describe('document templates', () => {
  it('lists the fields a template uses', () => {
    expect(fieldsOf(template)).toEqual(['agency.name', 'client.fullName', 'case.workflow', 'case.ref', 'fees.total', 'documents.missing']);
  });

  it('fills fields and reports the ones with no value', () => {
    const r = renderTemplate(template, {
      agency: { name: 'Horizon Overseas' },
      client: { fullName: 'Priya Raman' },
      case: { workflow: 'Canada · Study Permit', ref: 'KCK-CA-1001' },
      documents: { missing: ['Passport', 'GIC certificate'] },
    });
    expect(r.text).toContain('between **Horizon Overseas** and Priya Raman');
    expect(r.text).toContain('Documents still needed: Passport, GIC certificate');
    expect(r.text).toContain('Total: ________');
    expect(r.missing).toEqual(['fees.total']);
  });

  it('splits rendered text into blocks and bold runs', () => {
    const blocks = blocksOf(renderTemplate(template, {}).text);
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'p', 'h2', 'li', 'li', 'hr', 'sign']);
    expect(blocks[1]!.text).toMatch(/^This agreement is between/);
    expect(runsOf('a **b** c')).toEqual([{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }]);
  });
});
