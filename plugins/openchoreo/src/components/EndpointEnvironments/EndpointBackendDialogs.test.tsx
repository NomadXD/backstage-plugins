import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import type { Entity } from '@backstage/catalog-model';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import {
  EditBackendWeightDialog,
  RemoveBackendDialog,
} from './EndpointBackendDialogs';

const entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Endpoint',
  metadata: { name: 'orders-api', namespace: 'acme' },
  spec: {},
} as Entity;

const backend = {
  name: 'payments-http',
  component: 'payments',
  endpoint: 'http',
  weight: 1,
};

function renderWithClient(ui: JSX.Element, client: Record<string, jest.Mock>) {
  return render(
    <TestApiProvider apis={[[openChoreoClientApiRef, client as any]]}>
      {ui}
    </TestApiProvider>,
  );
}

describe('EditBackendWeightDialog', () => {
  it('saves the new weight', async () => {
    const client = {
      updateEndpointBackendWeight: jest.fn().mockResolvedValue(undefined),
    };
    const onSaved = jest.fn();
    const onClose = jest.fn();
    renderWithClient(
      <EditBackendWeightDialog
        backend={backend}
        entity={entity}
        onClose={onClose}
        onSaved={onSaved}
      />,
      client,
    );

    fireEvent.change(screen.getByLabelText('Weight'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.updateEndpointBackendWeight).toHaveBeenCalledWith(
      entity,
      'payments-http',
      4,
    );
    expect(onSaved).toHaveBeenCalledWith('Weight of payments / http set to 4.');
  });

  it('refuses a weight outside the CRD bounds', () => {
    renderWithClient(
      <EditBackendWeightDialog
        backend={backend}
        entity={entity}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
      { updateEndpointBackendWeight: jest.fn() },
    );

    fireEvent.change(screen.getByLabelText('Weight'), {
      target: { value: '2000000' },
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('RemoveBackendDialog', () => {
  it('removes the backend after confirming', async () => {
    const client = {
      removeEndpointBackend: jest.fn().mockResolvedValue(undefined),
    };
    const onSaved = jest.fn();
    renderWithClient(
      <RemoveBackendDialog
        backend={backend}
        entity={entity}
        onClose={jest.fn()}
        onSaved={onSaved}
      />,
      client,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith('Backend payments / http removed.'),
    );
    expect(client.removeEndpointBackend).toHaveBeenCalledWith(
      entity,
      'payments-http',
    );
  });

  it('keeps the dialog open with the error when removal fails', async () => {
    const onClose = jest.fn();
    renderWithClient(
      <RemoveBackendDialog
        backend={backend}
        entity={entity}
        onClose={onClose}
        onSaved={jest.fn()}
      />,
      {
        removeEndpointBackend: jest
          .fn()
          .mockRejectedValue(new Error('needs at least one backend')),
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(
      await screen.findByText(/needs at least one backend/),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
