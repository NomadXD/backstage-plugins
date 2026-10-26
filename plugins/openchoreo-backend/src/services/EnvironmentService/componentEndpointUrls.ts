import type { OpenChoreoComponents } from '@openchoreo/openchoreo-client-node';
import type {
  EndpointInfo,
  EndpointURLDetails,
  EndpointURLSecurity,
  Environment,
} from '../../types';

type Endpoint = OpenChoreoComponents['schemas']['Endpoint'];
type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];
type ResolvedEndpointURL =
  OpenChoreoComponents['schemas']['ResolvedEndpointURL'];

/** A component-owned Endpoint together with its bindings. */
export interface ComponentEndpointBindings {
  endpoint: Endpoint;
  bindings: EndpointReleaseBinding[];
}

function toDetails(url: ResolvedEndpointURL): EndpointURLDetails {
  const security: EndpointURLSecurity | undefined = url.security
    ? {
        scheme: url.security.scheme,
        ...(url.security.apiKey && {
          apiKey: {
            in: url.security.apiKey.in,
            name: url.security.apiKey.name,
          },
        }),
      }
    : undefined;
  return {
    scheme: url.scheme ?? '',
    host: url.host,
    port: url.port ?? 0,
    ...(url.path && { path: url.path }),
    ...(security && { security }),
  };
}

/** Keys a single URL the way ReleaseBinding URL maps are keyed: by scheme. */
function byScheme(url: ResolvedEndpointURL | undefined) {
  if (!url) return undefined;
  const details = toDetails(url);
  return { [details.scheme || 'url']: details };
}

/** The workload endpoints of its component an Endpoint routes to. */
function workloadEndpointsOf(endpoint: Endpoint): string[] {
  const names = (endpoint.spec?.backendRefs ?? [])
    .map(ref => ref.component?.endpoint)
    .filter((name): name is string => !!name);
  return [...new Set(names)];
}

/**
 * Overlays the URLs of a component's own Endpoints onto the per-environment
 * endpoint list the deploy page shows.
 *
 * The list starts from the component's ReleaseBinding status, which is all a
 * component of an older ComponentType has. For each workload endpoint that an
 * Endpoint deployed in that environment exposes, the external, internal and
 * namespace URLs come from that Endpoint's binding status.urls instead, along
 * with the security enforced there, and its project URL replaces the service
 * URL when the type declares one. An Endpoint not deployed in an environment
 * leaves that environment's ReleaseBinding entry as it is.
 *
 * Returns new environment objects; the input is not modified.
 */
export function applyComponentEndpointUrls(
  environments: Environment[],
  componentEndpoints: ComponentEndpointBindings[],
): Environment[] {
  if (componentEndpoints.length === 0) {
    return environments;
  }

  return environments.map(env => {
    const envName = (env.resourceName ?? env.name).toLowerCase();
    const entries = new Map<string, EndpointInfo>(
      env.endpoints.map(ep => [ep.name, { ...ep }]),
    );
    let changed = false;

    for (const { endpoint, bindings } of componentEndpoints) {
      const binding = bindings.find(
        b => b.spec?.environment?.toLowerCase() === envName,
      );
      const urls = binding?.status?.urls;
      if (!urls) continue;

      for (const workloadEndpoint of workloadEndpointsOf(endpoint)) {
        const entry: EndpointInfo = entries.get(workloadEndpoint) ?? {
          name: workloadEndpoint,
        };
        delete entry.externalURLs;
        delete entry.internalURLs;
        delete entry.namespaceURLs;

        const external = byScheme(urls.external);
        const internal = byScheme(urls.internal);
        const namespace = byScheme(urls.namespace);
        if (external) entry.externalURLs = external;
        if (internal) entry.internalURLs = internal;
        if (namespace) entry.namespaceURLs = namespace;
        if (urls.project) entry.projectURL = toDetails(urls.project);
        entry.endpointName = endpoint.metadata.name;

        entries.set(workloadEndpoint, entry);
        changed = true;
      }
    }

    return changed ? { ...env, endpoints: [...entries.values()] } : env;
  });
}
