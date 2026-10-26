import { endpointManagingComponent } from './endpointOwnership';

const SOURCE = 'openchoreo.dev/source-component';

describe('endpointManagingComponent', () => {
  it('returns the source component when every backend routes to it', () => {
    expect(
      endpointManagingComponent({
        labels: { [SOURCE]: 'greeter' },
        backendRefs: [{ kind: 'Component', component: { name: 'greeter' } }],
      }),
    ).toBe('greeter');
  });

  it('treats a missing backend kind as Component', () => {
    expect(
      endpointManagingComponent({
        labels: { [SOURCE]: 'greeter' },
        backendRefs: [{ component: { name: 'greeter' } }],
      }),
    ).toBe('greeter');
  });

  it('is project-scoped without the source-component label', () => {
    expect(
      endpointManagingComponent({
        backendRefs: [{ kind: 'Component', component: { name: 'greeter' } }],
      }),
    ).toBeUndefined();
  });

  it('is project-scoped once it routes to another component', () => {
    expect(
      endpointManagingComponent({
        labels: { [SOURCE]: 'greeter' },
        backendRefs: [
          { kind: 'Component', component: { name: 'greeter' } },
          { kind: 'Component', component: { name: 'greeter-v2' } },
        ],
      }),
    ).toBeUndefined();
  });

  it('is project-scoped with no backends', () => {
    expect(
      endpointManagingComponent({ labels: { [SOURCE]: 'greeter' } }),
    ).toBeUndefined();
  });
});
