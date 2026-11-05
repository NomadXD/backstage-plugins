import { Box, Button, Typography } from '@material-ui/core';
import type { EndpointEnvironment as MentorEnvironment } from '../../../api/OpenChoreoClientApi';
import { useResourceEnvironmentDetailPanelStyles } from '../../ResourceEnvironments/styles';
import { envResourceName } from '../endpointEnvironmentUtils';
import { inRollout, requestedPercent, servedSplit } from './endpointRolloutUi';
import { backendLabel, describeReach } from './endpointUi';
import { useProgressiveDelivery } from './ProgressiveDeliveryContext';
import { stageName } from './rolloutCopy';
import { TrafficSplitBar } from './TrafficSplitBar';

/**
 * The environment's traffic on the detail panel, with Configure to run the
 * rollout here. A canary or a split shows its weights; blue/green and A/B
 * show who the new version serves, and a mirror how much it copies.
 */
export const TrafficBlock = ({ env }: { env: MentorEnvironment }) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const pd = useProgressiveDelivery();
  if (!pd) return null;
  const pdEnv = pd.environments.find(e => e.name === envResourceName(env));
  if (!pdEnv?.bindingName) return null;
  const { endpoint } = pd;
  const rollout = endpoint.rollout;
  if (!rollout && pdEnv.overrides.length === 0) return null;
  const split = servedSplit(pdEnv, endpoint);
  const here = rollout && inRollout(pdEnv, rollout);
  const candidate = rollout
    ? endpoint.backends.find(
        b => (b.name ?? b.componentName) === rollout.candidate,
      )
    : undefined;
  const name = candidate ? backendLabel(candidate, endpoint.backends) : '';
  const percent = pdEnv.rollout?.percent ?? 0;
  const reach = candidate?.match ? describeReach(candidate) : '';

  let summary = null;
  if (rollout && !here) {
    summary = (
      <Typography variant="body2" color="textSecondary">
        The new version is not here yet.
      </Typography>
    );
  } else if (rollout?.strategy === 'mirror') {
    summary = (
      <Row
        label="Copying"
        value={percent > 0 ? `${percent}% to ${name}` : 'Off'}
      />
    );
  } else if (rollout?.strategy === 'blueGreen') {
    summary = (
      <>
        <Row label="Serving everyone" value={stageName(rollout, percent)} />
        {reach && <Row label="Preview" value={reach} />}
      </>
    );
  } else if (rollout?.strategy === 'abTest') {
    summary = (
      <>
        <Row label="New version for" value={stageName(rollout, percent)} />
        {reach && percent < 100 && <Row label="Test group" value={reach} />}
      </>
    );
  } else if (split.length > 0) {
    const requested = rollout ? requestedPercent(pdEnv, rollout) : undefined;
    summary = (
      <>
        <TrafficSplitBar backends={split} showLegend height={12} />
        {requested !== undefined && requested !== percent && (
          <Typography variant="caption" color="textSecondary">
            Set {requested}% · Actual {percent}%, applying
          </Typography>
        )}
      </>
    );
  }

  return (
    <Box className={classes.section}>
      <Box className={classes.sectionTitleRow}>
        <Typography className={classes.sectionHeading}>Traffic</Typography>
        {rollout && (
          <Button
            size="small"
            color="primary"
            onClick={() => pd.onOpenRolloutDialog(pdEnv.name)}
          >
            Configure
          </Button>
        )}
      </Box>
      {summary}
    </Box>
  );
};

function Row({ label, value }: { label: string; value: string }) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  return (
    <Box className={classes.releaseNameRow}>
      <Typography variant="caption" className={classes.releaseNameLabel}>
        {label}
      </Typography>
      <Typography variant="caption" className={classes.releaseName}>
        {value}
      </Typography>
    </Box>
  );
}
