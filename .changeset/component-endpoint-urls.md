---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-catalog-backend-module': minor
'@openchoreo/openchoreo-client-node': minor
---

Show a component's Endpoints where the component is deployed, not as separate
project contents.

The deploy page's environment panel and its View All dialog now take a
workload endpoint's URLs from the component's own Endpoint when one is deployed
in that environment: the external, internal and namespace URLs from the
EndpointReleaseBinding's `status.urls`, each with the security enforced there
(for example "API key (header api-key)"), and its project URL when the
EndpointType declares one. Every other workload endpoint, and every component
of a ComponentType without `allowedEndpoints`, keeps the URLs from the
ReleaseBinding status as before; if the Endpoints cannot be read, the panel
falls back to those too.

Project contents no longer list Endpoints managed by a component — created for
one of its workload endpoints and routing only to it. Catalog Endpoint entities
carry an `openchoreo.io/endpoint-scope` label (`component` or `project`) and,
for component-managed ones, `spec.managedByComponent`. An Endpoint edited to
route to another component is listed in the project again.

`endpointManagingComponent` in `@openchoreo/backstage-plugin-common` holds the
ownership rule shared by the catalog, the deploy page and the component's
deploy and promote actions. The OpenChoreo API spec is synced for
`allowedEndpoints` (renamed from `allowedEndpointTypes`), `EndpointType.spec.urls`
and `EndpointReleaseBinding.status.urls`.
