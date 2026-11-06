---
'@openchoreo/openchoreo-client-node': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/cell-diagram': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-scaffolder-backend-module': minor
'@openchoreo/backstage-plugin-catalog-backend-module': minor
---

Roll out a new Endpoint backend by canary, blue/green, A/B test or mirror.

On the Endpoint Deploy tab, Add backend picks the new version (a release line
included), the strategy, its steps and how people reach it first, and saves
and deploys a release with the new version at 0%. Each environment's Configure
takes the next planned step, goes back to Current, or sets any share with a
control that fits the strategy, previewed by a routing drawing, and saves it
to the environment's EndpointReleaseBinding `backendOverrides` without a new
release. A change that hasn't applied yet says so, and the requested and
actual shares show while traffic moves. The Set up pane tags the rollout's
backends Current and New; removing one that no environment sends traffic to
finishes the rollout in one release. Deploying or promoting a release resets
overrides that no longer fit it, and asks first when it drops a backend that
still gets traffic.

Create Endpoint offers each workload endpoint of the project once, release
lines included, and with two backends can create the Endpoint mid-rollout.

The BFF adds `GET /endpoint-rollout`, `PUT /update-endpoint-overrides` and
`PUT /endpoint-rollout/{start,stage,settings,convert,finish,deploy}`; the
rollout model lives in `@openchoreo/backstage-plugin-common`, and the rollout
is recorded in the `openchoreo.dev/rollout` annotation in the shape of the
planned `spec.rollout`. The project cell diagram draws Endpoints on its
gateways, labelled with the Endpoint and its rollout role, through a new
optional `label` on gateway metadata in `@openchoreo/cell-diagram`. Syncs the
OpenChoreo API spec for `match` and `mirror` on Endpoint backend refs and
`backendOverrides` on EndpointReleaseBinding.
