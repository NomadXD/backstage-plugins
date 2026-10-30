import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import AddIcon from '@material-ui/icons/Add';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import EditOutlinedIcon from '@material-ui/icons/EditOutlined';
import { useAsyncEntity, useEntity } from '@backstage/plugin-catalog-react';
import {
  EndpointBackendList,
  type EndpointBackend,
} from '../EndpointOverview/EndpointBackendList';
import { AddEndpointBackendDialog } from './AddEndpointBackendDialog';
import {
  EditBackendWeightDialog,
  RemoveBackendDialog,
} from './EndpointBackendDialogs';

/** The most backends an Endpoint takes, as the Endpoint CRD allows. */
const MAX_BACKENDS = 16;

/**
 * How long after a change to look for the release it cuts: the controller
 * cuts it within seconds, and the catalog entity follows by event.
 */
const RELEASE_RECHECK_MS = [3000, 8000];

/**
 * The Endpoint's backends on the Set up pane, where they are changed: added
 * (moving a component-managed Endpoint to its project), reweighted and
 * removed. Each change cuts a new release, which the pane then offers to
 * deploy; `onChanged` is called to look for it.
 */
export const EndpointBackendsSection = ({
  onChanged,
}: {
  onChanged: () => void;
}) => {
  const { entity } = useEntity();
  const { refresh } = useAsyncEntity();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EndpointBackend | null>(null);
  const [removing, setRemoving] = useState<EndpointBackend | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const spec = (entity.spec ?? {}) as {
    backends?: EndpointBackend[];
    managedByComponent?: string;
  };
  const backends = spec.backends ?? [];
  const namespace = entity.metadata.namespace ?? 'default';

  const handleSaved = (message: string) => {
    setSaved(
      `${message} A new release is cut in a few seconds; deploy it below.`,
    );
    onChanged();
    timers.current.forEach(clearTimeout);
    timers.current = RELEASE_RECHECK_MS.map(ms =>
      setTimeout(() => {
        refresh?.();
        onChanged();
      }, ms),
    );
  };

  return (
    <Box>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={1}
      >
        <Typography variant="subtitle2">
          Backends ({backends.length})
        </Typography>
        <Tooltip
          title={
            backends.length >= MAX_BACKENDS
              ? `An Endpoint takes at most ${MAX_BACKENDS} backends.`
              : ''
          }
        >
          <span>
            <Button
              size="small"
              color="primary"
              startIcon={<AddIcon />}
              onClick={() => setAddOpen(true)}
              disabled={backends.length >= MAX_BACKENDS}
            >
              Add backend
            </Button>
          </span>
        </Tooltip>
      </Box>

      {saved && (
        <Box mb={1}>
          <Alert severity="success" onClose={() => setSaved(null)}>
            {saved}
          </Alert>
        </Box>
      )}

      {backends.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          No backends configured.
        </Typography>
      ) : (
        <EndpointBackendList
          backends={backends}
          namespace={namespace}
          renderActions={backend => (
            <>
              <Tooltip title={`Weight ${backend.weight ?? 1}. Edit`}>
                <IconButton
                  size="small"
                  aria-label={`Edit weight of ${backend.name}`}
                  onClick={() => setEditing(backend)}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip
                title={
                  backends.length === 1
                    ? 'An Endpoint needs at least one backend.'
                    : 'Remove backend'
                }
              >
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Remove ${backend.name}`}
                    onClick={() => setRemoving(backend)}
                    disabled={backends.length === 1}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
        />
      )}

      <AddEndpointBackendDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() =>
          handleSaved(
            spec.managedByComponent
              ? 'Backend added. The Endpoint belongs to its project now.'
              : 'Backend added.',
          )
        }
        entity={entity}
        backends={backends}
        managedByComponent={spec.managedByComponent}
      />
      <EditBackendWeightDialog
        backend={editing}
        entity={entity}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
      <RemoveBackendDialog
        backend={removing}
        entity={entity}
        onClose={() => setRemoving(null)}
        onSaved={handleSaved}
      />
    </Box>
  );
};
