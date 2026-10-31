import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { GroqService, titleCase } from './groq.service';

const make = (key: string) =>
  new GroqService({ get: () => key } as unknown as ConfigService<Env, true>);

const groqReply = (content: string) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  } as Response);

describe('GroqService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('titleCase tidies spacing and case', () => {
    expect(titleCase('  exel   FORMULAS ')).toBe('Exel Formulas');
  });

  it('without an API key it never calls the network and title-cases the input', async () => {
    const spy = jest.fn();
    global.fetch = spy;
    await expect(make('').normalizeSkill('web   design')).resolves.toEqual({
      name: 'Web Design',
      category: 'Other',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('uses the model answer when it is valid', async () => {
    global.fetch = () =>
      groqReply('{"name":"Microsoft Excel","category":"Data"}');
    await expect(make('k').normalizeSkill('exel')).resolves.toEqual({
      name: 'Microsoft Excel',
      category: 'Data',
    });
  });

  it('maps an unknown category to Other', async () => {
    global.fetch = () =>
      groqReply('{"name":"Origami","category":"Papercraft"}');
    expect((await make('k').normalizeSkill('origami')).category).toBe('Other');
  });

  it.each([
    ['not json', 'garbage'],
    ['missing fields', '{"foo":1}'],
    [
      'name too long',
      JSON.stringify({ name: 'x'.repeat(200), category: 'Data' }),
    ],
  ])('falls back on a bad model answer (%s)', async (_label, content) => {
    global.fetch = () => groqReply(content);
    await expect(make('k').normalizeSkill('rock climbing')).resolves.toEqual({
      name: 'Rock Climbing',
      category: 'Other',
    });
  });

  it('falls back when the network fails or Groq errors', async () => {
    global.fetch = () => Promise.reject(new Error('offline'));
    expect((await make('k').normalizeSkill('yoga')).name).toBe('Yoga');
    global.fetch = () =>
      Promise.resolve({ ok: false, status: 429 } as Response);
    expect((await make('k').normalizeSkill('yoga')).name).toBe('Yoga');
  });
});
