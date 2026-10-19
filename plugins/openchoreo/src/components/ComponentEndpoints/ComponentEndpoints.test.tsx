import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TestApiProvider } from '@backstage/test-utils';
import { EntityProvider, catalogApiRef } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import {
  ComponentEndpoints,
  describeEnvironment,
  routesToComponent,
} from './ComponentEndpoints';

jest.mock('@backstage/plugin-catalog-react', () => ({
  ...jest.requireActual('@backstage/plugin-catalog-react'),
  EntityRefLink: ({ entityRef }: any) => <span>{entityRef.metadata.name}</span>,
}));

jest.mock('@backstage/core-components', () => ({
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
}));

jest.mock('@openchoreo/backstage-design-system', () => ({
  PageLoader: () => <div data-testid="page-loader" />,
  StatusBadge: ({ status }: any) => <span>{status}</span>,
}));

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  useCreateEndpointPath: () => ({
    path: '/create?view=endpoints',
    loading: false,
  }),
  useEndpointCreatePermission: () => ({
    canCreate: true,
    loading: false,
    createDeniedTooltip: '',
  }),
}));

const COMPONENT: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'orders',
    namespace: 'acme',
    annotations: {
      'openchoreo.io/component': 'orders',
      'openchoreo.io/project': 'store',
      'openchoreo.io/namespace': 'acme',
    },
  },
  spec: { type: 'service' },
};

function endpoint(name: string): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Endpoint',
    metadata: { name, namespace: 'acme' },
    spec: {
      type: 'http-route',
      visibility: ['external'],
      backends: [
        {
          name: 'orders-http',
          component: 'orders',
          endpoint: 'http',
          weight: 90,
        },
        {
          name: 'billing-http',
          component: 'billing',
          endpoint: 'http',
          weight: 10,
        },
      ],
    },
  };
}

function renderTab(catalog: any, client: any) {
  return render(
    <MemoryRouter>
      <TestApiProvider
        apis={[
          [catalogApiRef, catalog],
          [openChoreoClientApiRef, client],
        ]}
      >
        <EntityProvider entity={COMPONENT}>
          <ComponentEndpoints />
        </EntityProvider>
      </TestApiProvider>
    </MemoryRouter>,
  );
}

describe('routesToComponent', () => {
  it('keeps only the backends routing to the component, with their share', () => {
    expect(routesToComponent(endpoint('orders-api'), 'orders')).toEqual([
      expect.objectContaining({
        name: 'orders-http',
        endpoint: 'http',
        share: 90,
      }),
    ]);
  });
});

describe('describeEnvironment', () => {
  it('reports an environment without a binding as not deployed', () => {
    expect(describeEnvironment({ name: 'prod' }, ['orders-http'])).toBe(
      'prod: not deployed',
    );
  });

  it("reports whether this component's backend resolved", () => {
    const env = {
      name: 'dev',
      bindingName: 'b',
      status: 'Ready' as const,
      backends: [{ name: 'orders-http', kind: 'Component', resolved: true }],
    };
    expect(describeEnvironment(env, ['orders-http'])).toBe(
      "dev: Ready, this component's backend resolved",
    );
    expect(
      describeEnvironment(
        {
          ...env,
          backends: [
            {
              name: 'orders-http',
              kind: 'Component',
              resolved: false,
              reason: 'BackendNotDeployed',
            },
          ],
        },
        ['orders-http'],
      ),
    ).toBe('dev: Ready, not resolved (orders-http: BackendNotDeployed)');
  });
});

describe('ComponentEndpoints', () => {
  it('lists the Endpoints routing to the component with their environments', async () => {
    const catalog = {
      getEntities: jest
        .fn()
        .mockResolvedValue({ items: [endpoint('orders-api')] }),
    };
    const client = {
      fetchEndpointEnvironmentInfo: jest
        .fn()
        .mockResolvedValue([
          { name: 'dev', bindingName: 'b', status: 'Ready' },
          { name: 'prod' },
        ]),
    };
    renderTab(catalog, client);

    expect(await screen.findByText('orders-api')).toBeInTheDocument();
    expect(catalog.getEntities).toHaveBeenCalledWith({
      filter: {
        kind: 'Endpoint',
        'relations.routesto': 'component:acme/orders',
      },
    });
    expect(screen.getByText('http · 90%')).toBeInTheDocument();
    expect(await screen.findByText('active')).toBeInTheDocument();
    expect(screen.getByText('not-deployed')).toBeInTheDocument();
  });

  it('shows an empty state when no Endpoint routes to the component', async () => {
    renderTab(
      { getEntities: jest.fn().mockResolvedValue({ items: [] }) },
      { fetchEndpointEnvironmentInfo: jest.fn() },
    );

    expect(
      await screen.findByText('No endpoints route to this component'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create endpoint/i }),
    ).toBeEnabled();
  });

  it("shows one Endpoint's environment error without hiding the row", async () => {
    renderTab(
      {
        getEntities: jest
          .fn()
          .mockResolvedValue({ items: [endpoint('orders-api')] }),
      },
      {
        fetchEndpointEnvironmentInfo: jest
          .fn()
          .mockRejectedValue(new Error('boom')),
      },
    );

    expect(await screen.findByText('orders-api')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});
