---
'@openchoreo/backstage-plugin-scaffolder-backend-module': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin': minor
'@openchoreo/openchoreo-client-node': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-catalog-backend-module': minor
'@openchoreo/backstage-plugin-react': minor
---

Create Endpoints with a component and move them with it between environments.

Creating a component still means declaring port, protocol and visibility on
its workload endpoints. When the ComponentType declares
`allowedEndpoints`, `openchoreo:component:create` now also creates one
Endpoint per workload endpoint from the default entry matching its protocol
and visibility, labeled `openchoreo.dev/source-component` and
`openchoreo.dev/source-endpoint` and carrying the component's `autoDeploy`.
The Endpoint controller turns that label into an owner reference on the
component, so deleting the component deletes its Endpoints; an Endpoint later
edited to route to another component moves to the project. ComponentTypes
without `allowedEndpoints` behave as before.

When the ComponentType declares `allowedEndpoints`, each endpoint row in
the component creation form also shows how it is exposed: per internal or
external visibility, the endpoint type in use (a dropdown only when more than
one type is allowed for the endpoint's protocol, including "No Endpoint" to
keep the ComponentType's routes), followed by the parameters of each type in
use. It sits under the summary of a saved endpoint and under the schema
content field while editing, following the protocol and visibility as they
are edited. `EndpointList` and `EndpointEditor` gain an optional slot for this
(`renderDetails` / `details`). Renaming a saved endpoint in the creation form
now replaces it instead of leaving a copy under the old name. Generated component
templates carry `allowedEndpoints` in the WorkloadDetailsField options,
and the resolution logic is shared from `@openchoreo/backstage-plugin-common`
(`planEndpointExposures`) so the form and the action agree.

Deploying or promoting a component now does the same for the Endpoints it
owns: a promotion pins each one to the release it runs in the source
environment, a direct deploy to its latest release. Removing the component
from an environment removes them there first. Endpoint failures are logged and
never fail the component action. `updateReleaseBinding` on the client takes an
optional `sourceEnvironment` for this, which the overrides page passes when
promoting.

Syncs the OpenChoreo API spec for `allowedEndpoints` on (Cluster)ComponentType
and `autoDeploy` on Endpoint.
