---
'@openchoreo/backstage-plugin-scaffolder-backend-module': minor
'@openchoreo/backstage-plugin-catalog-backend-module': minor
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-react': minor
---

Define a component's endpoints only on its configure page.

Component creation no longer asks for endpoints: the creation form drops its
Endpoints section, the scaffolder creates the workload without endpoints and
creates no Endpoints, and the legacy `port` parameter no longer adds an `http`
endpoint. Component templates no longer carry `allowedEndpoints`.

The configure page's Endpoints tab has two forms. The Endpoints form, the
default, exposes each workload endpoint with a visibility beyond project
through an Endpoint of a chosen type (the protocol's default preselected),
which carries that visibility; a protocol no allowed type serves stays
project-scoped. It is the default even when the ComponentType allows no
Endpoint types, where every endpoint stays project-scoped and the banner
offers legacy endpoints for components that still use them. The legacy form
keeps visibility on the workload (deprecated) for the component type's own
routes; the page opens in it only when workload endpoints carry that
visibility and the component has no Endpoints, with a banner asking to migrate.
Switching applies on save, migrating visibility onto new Endpoints or back
onto the workload (deleting the component's Endpoints), and the save
confirmation lists it.
