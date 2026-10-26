---
'@openchoreo/backstage-plugin-scaffolder-backend-module': patch
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-react': minor
---

Manage a component's Endpoints from its release page.

The "Create release" / "Configure component" page now shows, inside each
workload endpoint's row, the Endpoints the component manages for it: type,
visibility, Ready state and parameters. Each can be edited (visibility and
parameters) or deleted, and an Endpoint can be added for internal or external
visibility still served by the ComponentType's own routes. Changes are staged
with the workload and saved after it; a renamed workload endpoint keeps its
Endpoints, and one that is removed or loses its internal and external
visibility has its Endpoints deleted on save.

The backend adds `/component-endpoints` (GET, POST, PUT, DELETE), which only
touches Endpoints the component manages. Endpoint naming and labeling
(`toDnsLabel`, `componentEndpointName`, `buildComponentEndpoint`) move to
`@openchoreo/backstage-plugin-common` so the scaffolder and the backend agree;
names shortened past 63 characters now use an FNV-1a hash suffix.
`EndpointList`'s `renderDetails` receives the row's saved name as a third
argument.
