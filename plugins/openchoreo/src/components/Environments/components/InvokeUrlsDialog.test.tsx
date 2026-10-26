import { render, screen } from '@testing-library/react';
import { InvokeUrlsDialog } from './InvokeUrlsDialog';

describe('InvokeUrlsDialog', () => {
  it('shows ReleaseBinding URLs without security, as for older ComponentTypes', () => {
    render(
      <InvokeUrlsDialog
        open
        onClose={() => {}}
        endpoints={[
          {
            name: 'http',
            type: 'HTTP',
            externalURLs: {
              https: {
                scheme: 'https',
                host: 'greeter.example.com',
                port: 443,
              },
            },
            serviceURL: { scheme: 'http', host: 'greeter.svc', port: 8080 },
          },
        ]}
      />,
    );

    expect(
      screen.getByText('https://greeter.example.com:443'),
    ).toBeInTheDocument();
    expect(screen.getByText('http://greeter.svc:8080')).toBeInTheDocument();
    expect(screen.queryByText(/via Endpoint/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/API key|No authentication/),
    ).not.toBeInTheDocument();
  });

  it('shows Endpoint URLs per visibility with their security', () => {
    render(
      <InvokeUrlsDialog
        open
        onClose={() => {}}
        endpoints={[
          {
            name: 'http',
            endpointName: 'greeter-http',
            externalURLs: {
              https: {
                scheme: 'https',
                host: 'api.example.com',
                port: 0,
                path: '/greeter',
                security: {
                  scheme: 'apiKey',
                  apiKey: { in: 'header', name: 'api-key' },
                },
              },
            },
            namespaceURLs: {
              http: {
                scheme: 'http',
                host: 'greeter.ns.local',
                port: 0,
                security: { scheme: 'none' },
              },
            },
            projectURL: {
              scheme: 'http',
              host: 'greeter.project',
              port: 0,
              path: '/v1',
            },
            serviceURL: { scheme: 'http', host: 'greeter.svc', port: 8080 },
          },
        ]}
      />,
    );

    expect(screen.getByText('via Endpoint greeter-http')).toBeInTheDocument();
    expect(
      screen.getByText('https://api.example.com/greeter'),
    ).toBeInTheDocument();
    expect(screen.getByText('API key (header api-key)')).toBeInTheDocument();
    expect(screen.getByText('Namespace')).toBeInTheDocument();
    expect(screen.getByText('No authentication')).toBeInTheDocument();
    expect(screen.getByText('http://greeter.project/v1')).toBeInTheDocument();
    expect(
      screen.queryByText('http://greeter.svc:8080'),
    ).not.toBeInTheDocument();
  });
});
