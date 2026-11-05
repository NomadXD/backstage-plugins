import { Box, Button, Chip, Tooltip, Typography } from '@material-ui/core';
import { formatRelativeTime } from '@openchoreo/backstage-plugin-react';
import { useResourceEnvironmentDetailPanelStyles } from '../../ResourceEnvironments/styles';
import { useEndpointEnvironmentsContext } from './ProgressiveDeliveryContext';
import {
  audienceText,
  inRollout,
  untouchedSummary,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { describeReach } from './endpointUi';
import { stageLabel } from './rolloutCopy';

interface EndpointRolloutPaneProps {
  /** Opens the rollout's settings; absent once it is deployed. */
  onEdit?: () => void;
}

/**
 * The rollout card under the backends while a rollout runs: a read-only
 * summary of how the new version is reached and where each environment
 * stands. Each environment's Configure moves its traffic; the backends above
 * are tagged Current and New, and removing one of them finishes the rollout.
 */
export const EndpointRolloutPane = ({ onEdit }: EndpointRolloutPaneProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const {
    endpoint,
    environments,
    onConvert,
    changeBlocked = '',
  } = useEndpointEnvironmentsContext();
  const rollout = endpoint.rollout;
  if (!rollout) return null;

  const participants = environments.filter(e => e.bindingName);
  const candidate = endpoint.backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  const candidateReach = candidate ? describeReach(candidate) : '';
  const mirror = rollout.strategy === 'mirror';
  return (
    <Box
      border={1}
      borderColor="divider"
      borderRadius={4}
      p={1.5}
      mt={2}
      display="flex"
      flexDirection="column"
      gridGap={16}
    >
      <Box display="flex" alignItems="center" flexWrap="wrap" gridGap={8}>
        <Chip
          size="small"
          color="primary"
          label={STRATEGY_COPY[rollout.strategy].name}
        />
        {endpoint.rolloutSource === 'detected' && (
          <Chip size="small" variant="outlined" label="detected" />
        )}
        {rollout.startedAt && (
          <Typography variant="caption" color="textSecondary">
            started {formatRelativeTime(rollout.startedAt)}
            {rollout.startedBy ? ` by ${rollout.startedBy}` : ''}
          </Typography>
        )}
      </Box>
      <Box>
        {candidateReach && <Row label="Reached by" value={candidateReach} />}
        {rollout.strategy === 'abTest' && (
          <Row label="Who" value={audienceText(rollout.preview)} />
        )}
        {untouchedSummary(rollout) && (
          <Row label="Unchanged" value={untouchedSummary(rollout)} />
        )}
        {(rollout.strategy === 'canary' || mirror) && (
          <Row
            label={mirror ? 'Copy shares' : 'Steps'}
            value={rollout.steps.map(s => `${s}%`).join(' → ')}
          />
        )}
      </Box>
      <Box display="flex" flexDirection="column" gridGap={6}>
        <Typography className={classes.sectionHeading}>Progress</Typography>
        {participants.length === 0 && (
          <Typography variant="body2" color="textSecondary">
            Not deployed yet.
          </Typography>
        )}
        {participants.map(e => (
          <Box
            key={e.name}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            gridGap={8}
          >
            <Typography variant="body2">{e.displayName}</Typography>
            <Chip
              size="small"
              color={inRollout(e, rollout) ? 'primary' : 'default'}
              variant="outlined"
              label={stageLabel(e, rollout)}
            />
          </Box>
        ))}
      </Box>
      {(onEdit || (mirror && onConvert)) && (
        <Box display="flex" flexWrap="wrap" gridGap={8}>
          {onEdit && (
            <Button
              variant="outlined"
              color="primary"
              size="small"
              onClick={onEdit}
            >
              Edit
            </Button>
          )}
          {mirror && onConvert && (
            <Tooltip
              title={changeBlocked}
              disableHoverListener={!changeBlocked}
            >
              <span>
                <Button
                  variant="outlined"
                  color="primary"
                  size="small"
                  disabled={Boolean(changeBlocked)}
                  onClick={onConvert}
                >
                  Convert to canary
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      )}
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
