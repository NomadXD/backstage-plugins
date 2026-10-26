import { FC, useCallback, useEffect, useMemo } from 'react';
import { Typography } from '@material-ui/core';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  CHOREO_ANNOTATIONS,
  WorkloadEndpoint,
  endpointTypeKey,
} from '@openchoreo/backstage-plugin-common';
import {
  EndpointList,
  useEndpointEditBuffer,
} from '@openchoreo/backstage-plugin-react';
import { useWorkloadContext } from '../WorkloadContext';
import type { ComponentEndpointsState } from '../hooks/useComponentEndpoints';
import { useEndpointTypeSchemas } from '../../../../scaffolder/WorkloadDetailsField/EndpointExposure';
import {
  ComponentEndpointExposure,
  DetachedComponentEndpoints,
} from './ComponentEndpointExposure';

interface EndpointContentProps {
  endpoints: { [key: string]: WorkloadEndpoint };
  onEndpointReplace: (
    endpointName: string,
    endpoint: WorkloadEndpoint,
    oldNameToRemove?: string,
  ) => void;
  onAddEndpoint: () => string;
  onRemoveEndpoint: (endpointName: string) => void;
  disabled: boolean;
  /**
   * The component's own Endpoints, shown inside each workload endpoint's row
   * when its ComponentType allows Endpoints or it already has some.
   */
  componentEndpoints?: ComponentEndpointsState;
}

export const EndpointContent: FC<EndpointContentProps> = ({
  endpoints,
  onEndpointReplace,
  onAddEndpoint,
  onRemoveEndpoint,
  disabled,
  componentEndpoints,
}) => {
  const { setEditingSection } = useWorkloadContext();
  const { entity } = useEntity();

  // A renamed workload endpoint keeps its Endpoints.
  const renameWorkloadEndpoint = componentEndpoints?.renameWorkloadEndpoint;
  const handleEndpointReplace = useCallback(
    (
      endpointName: string,
      endpoint: WorkloadEndpoint,
      oldNameToRemove?: string,
    ) => {
      if (oldNameToRemove && oldNameToRemove !== endpointName) {
        renameWorkloadEndpoint?.(oldNameToRemove, endpointName);
      }
      onEndpointReplace(endpointName, endpoint, oldNameToRemove);
    },
    [onEndpointReplace, renameWorkloadEndpoint],
  );

  const editBuffer = useEndpointEditBuffer({
    endpoints,
    onEndpointReplace: handleEndpointReplace,
    onRemoveEndpoint,
  });

  // Report editing state to context
  useEffect(() => {
    setEditingSection('endpoints', editBuffer.isAnyRowEditing);
  }, [editBuffer.isAnyRowEditing, setEditingSection]);

  const showEndpoints = !!componentEndpoints?.enabled;
  const drafts = componentEndpoints?.drafts;
  const typeKeys = useMemo(
    () =>
      [
        ...new Set(
          (drafts ?? []).map(d =>
            endpointTypeKey({ kind: d.typeKind, name: d.typeName }),
          ),
        ),
      ].sort(),
    [drafts],
  );
  const schemas = useEndpointTypeSchemas(
    typeKeys,
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE] ?? '',
  );

  return (
    <>
      {componentEndpoints?.loadError && (
        <Typography variant="body2" color="error" gutterBottom>
          Could not load the component's Endpoints:{' '}
          {componentEndpoints.loadError}
        </Typography>
      )}
      <EndpointList
        endpoints={endpoints}
        disabled={disabled}
        editBuffer={editBuffer}
        onRemoveEndpoint={onRemoveEndpoint}
        onAddEndpoint={onAddEndpoint}
        renderDetails={
          showEndpoints && componentEndpoints
            ? (_name, endpoint, savedName) => (
                <ComponentEndpointExposure
                  workloadEndpoint={savedName}
                  endpoint={endpoint}
                  state={componentEndpoints}
                  schemas={schemas}
                  disabled={disabled}
                />
              )
            : undefined
        }
      />
      {showEndpoints && componentEndpoints && (
        <DetachedComponentEndpoints
          workloadEndpoints={endpoints}
          state={componentEndpoints}
          disabled={disabled}
        />
      )}
    </>
  );
};
