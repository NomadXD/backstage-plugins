import {
  derivePrimaryUrl,
  describeSecurity,
  projectUrlOf,
} from './invokeUrlUtils';

const url = (host: string, extra: Record<string, unknown> = {}) => ({
  scheme: 'https',
  host,
  port: 443,
  ...extra,
});

describe('derivePrimaryUrl', () => {
  it('prefers external, then internal, then namespace, then project', () => {
    expect(
      derivePrimaryUrl([
        { name: 'a', internalURLs: { https: url('internal.example.com') } },
        { name: 'b', externalURLs: { https: url('external.example.com') } },
      ]),
    ).toEqual({ label: 'External', url: 'https://external.example.com:443' });

    expect(
      derivePrimaryUrl([
        {
          name: 'a',
          namespaceURLs: { http: url('ns.local', { scheme: 'http', port: 0 }) },
          serviceURL: url('svc.local', { scheme: 'http', port: 8080 }),
        },
      ]),
    ).toEqual({ label: 'Namespace', url: 'http://ns.local' });
  });

  it("uses an Endpoint's project URL, with its path, before the service URL", () => {
    expect(
      derivePrimaryUrl([
        {
          name: 'a',
          projectURL: url('project.local', { path: '/v1' }),
          serviceURL: url('svc.local', { scheme: 'http', port: 8080 }),
        },
      ]),
    ).toEqual({ label: 'Project', url: 'https://project.local:443/v1' });
  });

  it('falls back to the service URL for ReleaseBinding endpoints', () => {
    expect(
      derivePrimaryUrl([
        {
          name: 'a',
          serviceURL: url('svc.local', {
            scheme: 'http',
            port: 8080,
            path: '/x',
          }),
        },
      ]),
    ).toEqual({ label: 'Project', url: 'http://svc.local:8080' });
  });

  it('returns null without URLs', () => {
    expect(derivePrimaryUrl([{ name: 'a' }])).toBeNull();
  });
});

describe('projectUrlOf', () => {
  it('is null without a project or service URL', () => {
    expect(projectUrlOf({ name: 'a' })).toBeNull();
  });
});

describe('describeSecurity', () => {
  it('describes each scheme', () => {
    expect(
      describeSecurity({
        scheme: 'apiKey',
        apiKey: { in: 'header', name: 'api-key' },
      }),
    ).toBe('API key (header api-key)');
    expect(describeSecurity({ scheme: 'oauth2' })).toBe('OAuth2');
    expect(describeSecurity({ scheme: 'basicAuth' })).toBe('Basic auth');
    expect(describeSecurity({ scheme: 'none' })).toBe('No authentication');
  });

  it('is null when no security is declared', () => {
    expect(describeSecurity(undefined)).toBeNull();
  });
});
