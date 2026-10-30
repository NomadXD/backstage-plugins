import { fireEvent, render, screen } from '@testing-library/react';
import type { Entity } from '@backstage/catalog-model';
import { EndpointBackendsSection } from './EndpointBackendsSection';

let mockEntity: Entity;
jest.mock('@backstage/plugin-catalog-react', () => ({
  useEntity: () => ({ entity: mockEntity }),
  useAsyncEntity: () => ({ refresh: jest.fn() }),
  EntityRefLink: ({ entityRef }: any) => <span>{entityRef.name}</span>,
}));

jest.mock('./AddEndpointBackendDialog', () => ({
  AddEndpointBackendDialog: ({ open, managedByComponent, onAdded }: any) =>
    open ? (
      <div role="dialog">
        add backend · managed by {managedByComponent ?? '-'}
        <button type="button" onClick={onAdded}>
          confirm add
        </button>
      </div>
    ) : null,
}));

jest.mock('./EndpointBackendDialogs', () => ({
  EditBackendWeightDialog: ({ backend }: any) =>
    backend ? <div role="dialog">edit weight of {backend.name}</div> : null,
  RemoveBackendDialog: ({ backend }: any) =>
    backend ? <div role="dialog">remove {backend.name}</div> : null,
}));

function endpointEntity(spec: Record<string, unknown>): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Endpoint',
    metadata: { name: 'orders-api', namespace: 'acme' },
    spec: {
      backends: [
        { name: 'primary', component: 'orders', endpoint: 'http', weight: 90 },
        {
          name: 'canary',
          component: 'orders-v2',
          endpoint: 'http',
          weight: 10,
        },
      ],
      ...spec,
    },
  } as Entity;
}

describe('EndpointBackendsSection', () => {
  it('opens the add dialog with the managing component', () => {
    mockEntity = endpointEntity({ managedByComponent: 'orders' });
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add backend' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('managed by orders');
  });

  it('looks for the new release once a change is saved', () => {
    mockEntity = endpointEntity({});
    const onChanged = jest.fn();
    render(<EndpointBackendsSection onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add backend' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm add' }));

    expect(onChanged).toHaveBeenCalled();
    expect(
      screen.getByText(/A new release is cut in a few seconds/),
    ).toBeInTheDocument();
  });

  it('opens the weight and remove dialogs for a backend', () => {
    mockEntity = endpointEntity({});
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit weight of canary' }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'edit weight of canary',
    );
  });

  it('keeps the last backend', () => {
    mockEntity = endpointEntity({
      backends: [{ name: 'primary', component: 'orders', endpoint: 'http' }],
    });
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Remove primary' }),
    ).toBeDisabled();
  });

  it('stops adding backends at the CRD maximum', () => {
    mockEntity = endpointEntity({
      backends: Array.from({ length: 16 }, (_, i) => ({
        name: `b${i}`,
        component: `c${i}`,
        endpoint: 'http',
      })),
    });
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Add backend' })).toBeDisabled();
  });
});
