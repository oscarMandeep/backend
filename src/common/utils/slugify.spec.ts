import { slugify } from './slugify';

describe('slugify', () => {
  it.each([
    ['Microsoft Excel', 'microsoft-excel'],
    ['Node.js', 'node-js'],
    ['UI/UX Design', 'ui-ux-design'],
    ['C++', 'cplusplus'],
    ['C#', 'csharp'],
    ['  Spaced   Out  ', 'spaced-out'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
