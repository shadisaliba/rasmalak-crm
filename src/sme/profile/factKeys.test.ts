import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACT_KEYS, isValidFactValue } from './factKeys';
import { CURRENCY_TABLE } from '@/sme/money/currencies';

const migrations = join(process.cwd(), 'supabase', 'migrations');
const profileSql = readFileSync(join(migrations, readdirSync(migrations).find(f => f.endsWith('_sme_profile.sql'))!), 'utf8');

describe('profile facts', () => {
  it('match the fact keys the database accepts', () => {
    const sqlKeys = profileSql.match(/create or replace function sme_fact_keys\(\)[\s\S]*?array\[([\s\S]*?)\]/)![1]
      .match(/'([a-z_.]+)'/g)!.map(k => k.slice(1, -1));
    expect(sqlKeys).toEqual(FACT_KEYS);
  });

  it('validate values by type', () => {
    expect(isValidFactValue('employees.count', 3)).toBe(true);
    expect(isValidFactValue('employees.count', -1)).toBe(false);
    expect(isValidFactValue('employees.count', 1.5)).toBe(false);
    expect(isValidFactValue('jofotara.status', 'registered_unsure')).toBe(true);
    expect(isValidFactValue('jofotara.status', 'compliant')).toBe(false);
    expect(isValidFactValue('ssc.registered', 'yes')).toBe(false);
  });
});

describe('sme_currencies seed', () => {
  it('matches the money table exactly', () => {
    const block = profileSql.split('insert into sme_currencies')[1].split(';')[0];
    const rows = [...block.matchAll(/\('([A-Z]{3})', (\d), '([^']+)', '([^']+)'\)/g)]
      .map(([, code, minor, nameEn, nameAr]) => ({ code, minor: Number(minor), nameEn, nameAr }));
    expect(rows).toEqual(Object.entries(CURRENCY_TABLE).map(([code, c]) => ({ code, minor: c.minorUnits, nameEn: c.nameEn, nameAr: c.nameAr })));
  });
});
