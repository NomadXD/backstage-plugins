---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-backend': minor
---

Add a backend to an Endpoint from its Routing card.

The new Add backend button routes part of an Endpoint's traffic to another
workload endpoint of its project, with a relative weight. For an Endpoint
managed by a component it first asks to move the Endpoint to the project:
saving drops the `openchoreo.dev/source-component` and `source-endpoint`
labels, so the Endpoint controller re-parents it to the Project, the catalog
lists it in the project's contents, and the component's configure page and
deploys no longer manage it. The Endpoint URLs dialog gains a Manage Endpoint
button that opens the Endpoint's catalog page.

On the Endpoint's Deploy tab, the environment pane lists the URLs the Endpoint
is invoked at there, per visibility and with the security a caller must
present, and environment tiles are tall enough that Promote no longer sits on
the tile's border.
