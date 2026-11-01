import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Env } from '../config/env.schema';
import { RevalidateService } from './revalidate.service';

const config = {
  get: (k: string) =>
    ({ WEB_URL: 'https://web.test', REVALIDATE_SECRET: 's3cret' })[k],
} as unknown as ConfigService<Env, true>;

describe('RevalidateService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let service: RevalidateService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    service = new RevalidateService(config);
  });
  afterEach(() => {
    service.onModuleDestroy();
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('sends one request with unique, sorted tags and the secret header', async () => {
    service.queue(['user:a', 'skill:x']);
    service.queue(['skill:x', 'sitemap']);
    await service.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://web.test/internal/revalidate');
    expect(init.method).toBe('POST');
    expect(
      (init.headers as Record<string, string>)['x-revalidate-secret'],
    ).toBe('s3cret');
    expect(JSON.parse(init.body as string)).toEqual({
      tags: ['sitemap', 'skill:x', 'user:a'],
    });
  });

  it('does nothing when nothing is queued, and does not resend sent tags', async () => {
    await service.flush();
    service.queue(['user:a']);
    await service.flush();
    await service.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst on its own timer into one request', async () => {
    jest.useFakeTimers();
    try {
      service.queue(['user:a']);
      service.queue(['user:b']);
      service.queue(['user:c']);
      expect(fetchMock).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1100);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(
          (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
        ),
      ).toEqual({
        tags: ['user:a', 'user:b', 'user:c'],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('never throws: network errors and bad responses are only logged', async () => {
    fetchMock.mockRejectedValueOnce(new Error('web is asleep'));
    service.queue(['user:a']);
    await expect(service.flush()).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    service.queue(['user:b']);
    await expect(service.flush()).resolves.toBeUndefined();
  });
});
