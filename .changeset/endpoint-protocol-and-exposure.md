---
'@openchoreo/backstage-plugin-scaffolder-backend-module': minor
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-react': minor
'@openchoreo/openchoreo-client-node': minor
---

Follow the OpenChoreo move of exposure intent from workload endpoints to
Endpoints.

The endpoint editor's Type field is now Protocol and writes the workload
endpoint's `protocol` (with the deprecated `type` kept equal). Each endpoint
row offers one "Exposed via" choice of the EndpointTypes its ComponentType
allows for the protocol, starting on the default (or first) one, in both the
creation form and the component's configure page. The row's visibilities
beyond project are saved on the component's Endpoint and dropped from the
workload. Where no type is allowed for the protocol they stay on the workload
in the deprecated field, which the row notes. An existing component's endpoint
without an Endpoint shows the field empty; choosing a type migrates it in one
save, and nothing migrates otherwise. Once a row's Endpoint exists its type is
fixed, as on the Endpoint itself; clearing the row's visibility beyond project
deletes it.

`allowedEndpoints` entries are matched on protocol only, following the API.
The vendored OpenAPI spec and generated types are synced.
