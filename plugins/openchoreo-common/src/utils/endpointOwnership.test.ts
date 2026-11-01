import {
  endpointManagingComponent,
  endpointManagingReleaseLine,
} from './endpointOwnership';

const SOURCE = 'openchoreo.dev/source-component';
const SOURCE_LINE = 'openchoreo.dev/source-release-line';

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

describe('endpointManagingReleaseLine', () => {
  it("is the main line ('') without a release line label", () => {
    expect(
      endpointManagingReleaseLine({
        labels: { [SOURCE]: 'greeter' },
        backendRefs: [{ component: { name: 'greeter' } }],
      }),
    ).toBe('');
  });

  it('is the labeled release line', () => {
    expect(
      endpointManagingReleaseLine({
        labels: { [SOURCE]: 'greeter', [SOURCE_LINE]: 'next' },
        backendRefs: [{ component: { name: 'greeter', releaseLine: 'next' } }],
      }),
    ).toBe('next');
  });

  it("keeps main's canary across lines with the main line", () => {
    expect(
      endpointManagingReleaseLine({
        labels: { [SOURCE]: 'greeter' },
        backendRefs: [
          { component: { name: 'greeter' } },
          { component: { name: 'greeter', releaseLine: 'next' } },
        ],
      }),
    ).toBe('');
  });

  it('is undefined for an Endpoint no component manages', () => {
    expect(
      endpointManagingReleaseLine({
        labels: { [SOURCE_LINE]: 'next' },
        backendRefs: [{ component: { name: 'greeter', releaseLine: 'next' } }],
      }),
    ).toBeUndefined();
  });
});
