---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-react': minor
---

Add an Endpoints tab to OpenChoreo components. It lists the Endpoints that
route traffic to the component and, for each one:

- its type and visibility;
- the component's workload endpoints it routes to, with their share of traffic;
- its status in each environment, with a tooltip saying whether this
  component's backend resolved there.

A Create Endpoint button opens the Endpoint templates for the component's
project.

`useCreateEndpointPath` takes an optional project name for use outside a
project page.
