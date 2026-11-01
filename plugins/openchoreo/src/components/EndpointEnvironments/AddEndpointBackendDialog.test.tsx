import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import type { Entity } from '@backstage/catalog-model';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { AddEndpointBackendDialog } from './AddEndpointBackendDialog';

jest.mock(
  '../../scaffolder/EndpointBackendsField/useProjectWorkloadEndpoints',
  () => ({
    useProjectWorkloadEndpoints: (namespace?: string) => ({
      loading: false,
      // Project-only workload endpoints are offered too: the Endpoint
      // carries the visibility.
      options: namespace
        ? [
            { component: 'orders', endpoint: 'api', visibility: [] },
            {
              component: 'orders',
              releaseLine: 'next',
              endpoint: 'api',
              visibility: [],
            },
            { component: 'payments', endpoint: 'http', visibility: [] },
          ]
        : [],
    }),
  }),
);

const entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Endpoint',
  metadata: {
    name: 'orders-api',
    namespace: 'acme',
    annotations: { 'openchoreo.io/project': 'store' },
  },
  spec: {},
} as Entity;

function renderDialog(
  props: Partial<Parameters<typeof AddEndpointBackendDialog>[0]> = {},
) {
  const client = { addEndpointBackend: jest.fn().mockResolvedValue({}) };
  const handlers = { onClose: jest.fn(), onAdded: jest.fn() };
  render(
    <TestApiProvider apis={[[openChoreoClientApiRef, client as any]]}>
      <AddEndpointBackendDialog
        open
        entity={entity}
        backends={[{ name: 'orders', component: 'orders', endpoint: 'api' }]}
        {...handlers}
        {...props}
      />
    </TestApiProvider>,
  );
  return { client, ...handlers };
}

describe('AddEndpointBackendDialog', () => {
  it('asks to move a component-managed Endpoint to its project first', () => {
    const { onClose } = renderDialog({ managedByComponent: 'orders' });

    expect(
      screen.getByText('Move Endpoint to the project?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/is managed by component orders/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a backend from the project after confirming the move', async () => {
    const { client, onAdded } = renderDialog({ managedByComponent: 'orders' });

    fireEvent.click(screen.getByRole('button', { name: 'Move to project' }));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: /Workload endpoint/ }),
    );
    const options = await screen.findAllByRole('option');
    // The backend the Endpoint already routes to is not offered again, but
    // the same workload endpoint on a release line is.
    expect(options.map(o => o.textContent)).toEqual([
      'orders @ next / api',
      'payments / http',
    ]);
    fireEvent.click(options[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Add backend' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(client.addEndpointBackend).toHaveBeenCalledWith(entity, {
      component: 'payments',
      workloadEndpoint: 'http',
      weight: 1,
    });
  });

  it("adds a component's release line as a backend, for a canary", async () => {
    const { client, onAdded } = renderDialog();

    fireEvent.mouseDown(
      screen.getByRole('button', { name: /Workload endpoint/ }),
    );
    fireEvent.click(
      await screen.findByRole('option', { name: 'orders @ next / api' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add backend' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(client.addEndpointBackend).toHaveBeenCalledWith(entity, {
      component: 'orders',
      workloadEndpoint: 'api',
      releaseLine: 'next',
      weight: 1,
    });
  });

  it('goes straight to the backend form for a project Endpoint', () => {
    renderDialog();
    expect(
      screen.queryByText('Move Endpoint to the project?'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Workload endpoint/ }),
    ).toBeInTheDocument();
  });
});
