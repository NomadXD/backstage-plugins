---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-backend': minor
---

Manage an Endpoint's backends from the Set up card on its Deploy tab.

The Set up pane lists the backends and can add one, routing part of the
Endpoint's traffic to another workload endpoint of its project with a relative
weight, reweight one, or remove one; the last backend cannot be removed, and an
Endpoint takes at most 16. For an Endpoint managed by a component, adding a
backend first asks to move the Endpoint to the project: saving drops the
`openchoreo.dev/source-component` and `source-endpoint` labels, so the Endpoint
controller re-parents it to the Project, the catalog lists it in the project's
contents, and the component's configure page and deploys no longer manage it.
Each change cuts a new release, which the same pane deploys. The Overview's
Routing card stays read-only.

The Endpoint URLs dialog gains a Manage Endpoint button that opens the
Endpoint's catalog page. On the Endpoint's Deploy tab, the environment pane
lists the URLs the Endpoint is invoked at there, per visibility and with the
security a caller must present, and environment tiles are tall enough that
Promote no longer sits on the tile's border.
